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

function configuredTargetBytes() {
	return getSettings().targetSizeMB * DECIMAL_MB
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

	let target = configuredTargetBytes()
	if (finitePositive(discordLimit)) target = Math.min(target, discordLimit * 0.97)

	const size = finitePositive(explicitFileSize)
		? explicitFileSize
		: estimatedSourceBytes(metadata)

	return finitePositive(size) && size > target
}

function bitrateCap(metadata: any) {
	const seconds = durationSeconds(metadata)
	if (!seconds) return undefined

	const totalBitsBudget = configuredTargetBytes() * 8 * CONTAINER_HEADROOM
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
						const result = Reflect.apply(original, this, args)
						const metadata = args?.[1]
						const fileSize = args?.[2]
						const maxFileSize = args?.[3]

						if (
							shouldForceCompression(
								metadata,
								fileSize,
								maxFileSize,
							)
						) {
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
						if (!shouldForceCompression(metadata)) return originalBitrate

						const cap = bitrateCap(metadata)
						if (!finitePositive(cap)) return originalBitrate

						const next = Math.min(originalBitrate, cap)
						console.log(
							TAG,
							'adaptive bitrate',
							originalBitrate,
							'->',
							next,
						)
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

export default plugin<{ jsonStorage: LargeVideoSettings }>({
	jsonStorage: {
		load: true,
		default: DEFAULTS,
	},

	async start(api) {
		setStorage(api.jsonStorage)
		await api.jsonStorage.get()

		findVideoUploadUtils(api.cleanup)
		console.log(
			TAG,
			'started; target',
			getSettings().targetSizeMB,
			'MB',
		)
	},

	stop() {
		setStorage(undefined)
		console.log(TAG, 'stopped')
	},

	SettingsComponent,
})
