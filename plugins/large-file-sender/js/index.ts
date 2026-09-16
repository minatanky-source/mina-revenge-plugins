import { DEFAULTS, getSettings, setStorage } from './state'
import type { LargeVideoSettings } from './state'
import { SettingsComponent } from './ui'

const TAG = '[LargeVideoSender]'
const DECIMAL_MB = 1_000_000
const CONTAINER_HEADROOM = 0.94
const AUDIO_AND_MUX_RESERVE_BPS = 160_000
const MIN_VIDEO_BITRATE = 300_000

type Cleanup = (...fns: Array<() => unknown>) => void

function finitePositive(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function durationSeconds(metadata: any) {
	const durationMs = metadata?.durationMs
	if (!finitePositive(durationMs)) return undefined
	return durationMs / 1000
}

function configuredTargetBytes(discordLimit?: unknown) {
	const configured = getSettings().targetSizeMB * DECIMAL_MB
	return finitePositive(discordLimit)
		? Math.min(configured, discordLimit * 0.97)
		: configured
}

function estimatedSourceBytes(metadata: any) {
	if (finitePositive(metadata?.fileSize)) return metadata.fileSize

	const seconds = durationSeconds(metadata)
	const bitRate = metadata?.bitRate
	if (!seconds || !finitePositive(bitRate)) return undefined

	return ((bitRate + AUDIO_AND_MUX_RESERVE_BPS) * seconds) / 8
}

function shouldForceCompression(
	metadata: any,
	explicitFileSize?: unknown,
	discordLimit?: unknown,
) {
	if (!getSettings().enabled) return false

	const target = configuredTargetBytes(discordLimit)

	const size = finitePositive(explicitFileSize)
		? explicitFileSize
		: estimatedSourceBytes(metadata)

	return finitePositive(size) && size > target
}

function bitrateCap(metadata: any, discordLimit?: unknown) {
	const seconds = durationSeconds(metadata)
	if (!seconds) return undefined

	const totalBitsBudget =
		configuredTargetBytes(discordLimit) * 8 * CONTAINER_HEADROOM
	const availableVideoBps =
		totalBitsBudget / seconds - AUDIO_AND_MUX_RESERVE_BPS

	if (!Number.isFinite(availableVideoBps) || availableVideoBps <= 0) {
		return MIN_VIDEO_BITRATE
	}

	return Math.max(MIN_VIDEO_BITRATE, Math.floor(availableVideoBps))
}

function findVideoUploadUtils(
	cleanup: Cleanup,
	onReady?: (module: any) => void,
) {
	const { getModules } = revenge.modules.finders
	const { withProps } = revenge.modules.finders.filters
	const seen = new Set<any>()
	// Keep the limit and explicit size with this upload, never in a global channel budget.
	const uploads = new WeakMap<
		object,
		{ fileSize: unknown; maxFileSize: unknown }
	>()

	const unsubscribe = getModules(
		withProps(
			'calculateOptimalBitrate',
			'canSkipVideoTranscode',
			'calculateTargetDimensions',
		),
		(mod: any) => {
			const host =
				typeof mod?.calculateOptimalBitrate === 'function'
					? mod
					: typeof mod?.default?.calculateOptimalBitrate === 'function'
						? mod.default
						: undefined

			if (!host || seen.has(host)) return
			seen.add(host)

			cleanup(
				revenge.patcher.instead(
					host,
					'canSkipVideoTranscode',
					function (args: any[], original: any) {
						const metadata = args?.[1]
						const fileSize = args?.[2]
						const maxFileSize = args?.[3]
						if (metadata && typeof metadata === 'object') {
							uploads.set(metadata, { fileSize, maxFileSize })
						}
						// Discord may calculate the bitrate inside this original method.
						const result = Reflect.apply(original, this, args)

						if (shouldForceCompression(metadata, fileSize, maxFileSize)) {
							console.log(
								TAG,
								'forcing Discord video transcode to fit upload limit',
							)
							return false
						}

						return result
					},
				),
			)

			cleanup(
				revenge.patcher.instead(
					host,
					'calculateOptimalBitrate',
					function (args: any[], original: any) {
						const originalBitrate = Reflect.apply(original, this, args)
						const metadata = args?.[0]

						if (!getSettings().enabled) return originalBitrate
						if (!finitePositive(originalBitrate)) return originalBitrate
						const upload =
							metadata && typeof metadata === 'object'
								? uploads.get(metadata)
								: undefined
						if (
							!shouldForceCompression(
								metadata,
								upload?.fileSize,
								upload?.maxFileSize,
							)
						)
							return originalBitrate

						const cap = bitrateCap(metadata, upload?.maxFileSize)
						if (!finitePositive(cap)) return originalBitrate

						const next = Math.min(originalBitrate, cap)
						console.log(TAG, 'adaptive bitrate', originalBitrate, '->', next)
						return next
					},
				),
			)

			onReady?.(host)
			console.log(TAG, 'Discord video encoder hooked')
		},
		{ max: 5 },
	)

	cleanup(unsubscribe)
}

function findKestrelExperiment(cleanup: Cleanup) {
	const { getModules } = revenge.modules.finders
	const { withProps } = revenge.modules.finders.filters
	const seen = new Set<any>()

	const unsubscribe = getModules(
		withProps(
			'getKestrelConfig',
			'getEffectiveKestrelLimit',
			'getKestrelVariantName',
		),
		(mod: any) => {
			const host =
				typeof mod?.getKestrelConfig === 'function'
					? mod
					: typeof mod?.default?.getKestrelConfig === 'function'
						? mod.default
						: undefined

			if (!host || seen.has(host)) return
			seen.add(host)

			cleanup(
				revenge.patcher.instead(
					host,
					'getKestrelConfig',
					function (args: any[], original: any) {
						const result = Reflect.apply(original, this, args)
						const location = args?.[0]?.location

						if (
							getSettings().enabled &&
							location === 'CloudUploader.native.uploadFiles' &&
							result &&
							typeof result === 'object' &&
							'enabled' in result &&
							result.enabled
						) {
							console.log(
								TAG,
								'allowing oversized video into pre-compression pipeline',
							)
							return { ...result, enabled: false }
						}

						return result
					},
				),
			)

			console.log(TAG, 'Discord pre-compression gate hooked')
		},
		{ max: 5 },
	)

	cleanup(unsubscribe)
}

export default plugin<{ jsonStorage: LargeVideoSettings }>({
	jsonStorage: {
		load: true,
		default: DEFAULTS,
	},

	async start(api) {
		setStorage(api.jsonStorage)
		await api.jsonStorage.get()

		findVideoUploadUtils(api.cleanup)
		findKestrelExperiment(api.cleanup)
		console.log(TAG, 'started; target', getSettings().targetSizeMB, 'MB')
	},

	stop() {
		setStorage(undefined)
		console.log(TAG, 'stopped')
	},

	SettingsComponent,
})
