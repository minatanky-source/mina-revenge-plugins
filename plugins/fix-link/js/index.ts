import { DEFAULTS, getSettings, setStorage } from './state'
import type { FixLinkSettings } from './state'
import { SettingsComponent } from './ui'

const TAG = '[FixLink]'

const YOUTUBE_URL =
	/\b(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s<>`|]+/gi
const MASKED_YOUTUBE_URL =
	/\[[^\]\n]*\]\((https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s)]+)\)/gi
const ANGLED_YOUTUBE_URL =
	/<(https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s<>]+)>/gi
const TRAILING_PUNCTUATION = /[),.!?;:]+$/

function rewriteOne(raw: string) {
	const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] ?? ''
	const core = trailing ? raw.slice(0, -trailing.length) : raw
	const withProtocol = /^https?:\/\//i.test(core) ? core : 'https://' + core

	try {
		const url = new URL(withProtocol)
		const host = url.hostname.toLowerCase()

		if (host === 'youtu.be') {
			url.hostname = 'koutu.be'
		} else if (host === 'music.youtube.com') {
			url.hostname = 'music.koutube.com'
		} else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
			url.hostname = 'koutube.com'
		} else {
			return raw
		}

		return '[.](' + url.toString() + ')' + trailing
	} catch {
		return raw
	}
}

export function fixLinks(content: string) {
	const unwrapped = content.replace(
		ANGLED_YOUTUBE_URL,
		(_whole, url: string) => rewriteOne(url),
	)
	const masked = unwrapped.replace(
		MASKED_YOUTUBE_URL,
		(_whole, url: string) => rewriteOne(url),
	)
	return masked.replace(YOUTUBE_URL, rewriteOne)
}

function installSendPatch(
	cleanup: (...fns: Array<() => unknown>) => void,
) {
	const { getModules } = revenge.modules.finders
	const { withProps } = revenge.modules.finders.filters
	const seen = new Set<any>()

	const unsubscribe = getModules(
		withProps('sendMessage', 'editMessage'),
		(messageActions: any) => {
			const host =
				typeof messageActions?.sendMessage === 'function'
					? messageActions
					: typeof messageActions?.default?.sendMessage === 'function'
						? messageActions.default
						: undefined

			if (!host || seen.has(host)) return
			seen.add(host)

			cleanup(
				revenge.patcher.instead(
					host,
					'sendMessage',
					function (args: any[], original: any) {
						if (!getSettings().enabled) {
							return Reflect.apply(original, this, args)
						}

						const message = args?.[1]
						if (typeof message?.content !== 'string') {
							return Reflect.apply(original, this, args)
						}

						const fixed = fixLinks(message.content)
						if (fixed !== message.content) {
							args[1] = { ...message, content: fixed }
							console.log(TAG, 'rewrote YouTube link with Koutube')
						}

						return Reflect.apply(original, this, args)
					},
				),
			)

			console.log(TAG, 'sendMessage hooked')
		},
		{ max: 5 },
	)

	cleanup(unsubscribe)
}

export default plugin<{ jsonStorage: FixLinkSettings }>({
	jsonStorage: {
		load: true,
		default: DEFAULTS,
	},

	async start(api) {
		setStorage(api.jsonStorage)
		await api.jsonStorage.get()
		installSendPatch(api.cleanup)
		console.log(TAG, 'started')
	},

	stop() {
		setStorage(undefined)
		console.log(TAG, 'stopped')
	},

	SettingsComponent,
})
