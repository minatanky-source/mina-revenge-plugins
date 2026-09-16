import { DEFAULTS, getSettings, setStorage } from './state'
import type { FixLinkSettings } from './state'
import { SettingsComponent } from './ui'

const TAG = '[FixLink]'

const SOURCE_URL = /\bhttps?:\/\/[^\s<>\`|]+/gi
const MASKED_SOURCE_URL = /\[[^\]\n]*\]\((https?:\/\/[^\s)]+)\)/gi
const ANGLED_SOURCE_URL = /<(https?:\/\/[^\s<>]+)>/gi
const TRAILING_PUNCTUATION = /[),.!?;:]+$/

type PlatformKey = Exclude<keyof FixLinkSettings, 'enabled'>

function hostIs(host: string, domain: string) {
	return host === domain || host.endsWith('.' + domain)
}

function setHost(url: URL, hostname: string) {
	url.protocol = 'https:'
	url.hostname = hostname
	return url.toString()
}

function wrapFixEmbed(url: URL) {
	return 'https://fixembed.app/embed?url=' + encodeURIComponent(url.toString())
}

function rewriteUrl(
	url: URL,
	settings: FixLinkSettings,
): { platform: PlatformKey; url: string } | undefined {
	const host = url.hostname.toLowerCase()

	if (settings.youtube) {
		if (host === 'youtu.be') {
			return { platform: 'youtube', url: setHost(url, 'koutu.be') }
		}
		if (host === 'music.youtube.com') {
			return {
				platform: 'youtube',
				url: setHost(url, 'music.koutube.com'),
			}
		}
		if (hostIs(host, 'youtube.com')) {
			return { platform: 'youtube', url: setHost(url, 'koutube.com') }
		}
	}

	if (settings.twitter) {
		if (hostIs(host, 'twitter.com')) {
			return {
				platform: 'twitter',
				url: setHost(url, 'fxtwitter.com'),
			}
		}
		if (hostIs(host, 'x.com')) {
			return { platform: 'twitter', url: setHost(url, 'fixupx.com') }
		}
	}

	if (settings.instagram && hostIs(host, 'instagram.com')) {
		return {
			platform: 'instagram',
			url: setHost(url, 'oginstagram.com'),
		}
	}

	if (settings.tiktok && hostIs(host, 'tiktok.com')) {
		if (host === 'vm.tiktok.com') {
			return { platform: 'tiktok', url: setHost(url, 'vm.tnktok.com') }
		}
		if (host === 'vt.tiktok.com') {
			return { platform: 'tiktok', url: setHost(url, 'vt.tnktok.com') }
		}
		return { platform: 'tiktok', url: setHost(url, 'tnktok.com') }
	}

	if (settings.facebook && hostIs(host, 'facebook.com')) {
		return {
			platform: 'facebook',
			url: setHost(url, 'facebed.seria.moe'),
		}
	}

	if (
		settings.pinterest &&
		(hostIs(host, 'pinterest.com') || host === 'pin.it')
	) {
		return { platform: 'pinterest', url: wrapFixEmbed(url) }
	}

	if (settings.reddit) {
		if (hostIs(host, 'reddit.com')) {
			return { platform: 'reddit', url: setHost(url, 'rxddit.com') }
		}
		if (host === 'redd.it') {
			return { platform: 'reddit', url: wrapFixEmbed(url) }
		}
	}

	if (
		settings.threads &&
		(hostIs(host, 'threads.net') || hostIs(host, 'threads.com'))
	) {
		return {
			platform: 'threads',
			url: setHost(url, 'fixthreads.seria.moe'),
		}
	}

	if (settings.bluesky && host === 'bsky.app') {
		return { platform: 'bluesky', url: setHost(url, 'bskx.app') }
	}

	if (settings.pixiv && hostIs(host, 'pixiv.net')) {
		return { platform: 'pixiv', url: setHost(url, 'phixiv.net') }
	}

	if (settings.twitch) {
		if (host === 'clips.twitch.tv') {
			const path = '/clip' + url.pathname
			const suffix = url.search + url.hash
			return {
				platform: 'twitch',
				url: 'https://fxtwitch.seria.moe' + path + suffix,
			}
		}
		if (hostIs(host, 'twitch.tv')) {
			return {
				platform: 'twitch',
				url: setHost(url, 'fxtwitch.seria.moe'),
			}
		}
	}

	if (settings.tumblr && hostIs(host, 'tumblr.com')) {
		return { platform: 'tumblr', url: wrapFixEmbed(url) }
	}

	if (settings.deviantart) {
		if (hostIs(host, 'deviantart.com')) {
			return {
				platform: 'deviantart',
				url: setHost(url, 'fixdeviantart.com'),
			}
		}
		if (host === 'sta.sh') {
			return { platform: 'deviantart', url: wrapFixEmbed(url) }
		}
	}

	if (settings.bilibili) {
		if (host === 'b23.tv') {
			const path = '/b23' + url.pathname
			const suffix = url.search + url.hash
			return {
				platform: 'bilibili',
				url: 'https://fxbilibili.seria.moe' + path + suffix,
			}
		}
		if (hostIs(host, 'bilibili.com')) {
			return {
				platform: 'bilibili',
				url: setHost(url, 'fxbilibili.seria.moe'),
			}
		}
	}

	return undefined
}

function rewriteOne(raw: string) {
	const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] ?? ''
	const core = trailing ? raw.slice(0, -trailing.length) : raw

	try {
		const url = new URL(core)
		const result = rewriteUrl(url, getSettings())
		if (!result) return raw

		console.log(TAG, 'rewrote', result.platform, 'link')
		return '[.](' + result.url + ')' + trailing
	} catch {
		return raw
	}
}

function fixPlainLinks(content: string) {
	const unwrapped = content.replace(ANGLED_SOURCE_URL, (whole, url: string) => {
		const fixed = rewriteOne(url)
		return fixed === url ? whole : fixed
	})

	const masked = unwrapped.replace(MASKED_SOURCE_URL, (whole, url: string) => {
		const fixed = rewriteOne(url)
		return fixed === url ? whole : fixed
	})

	return masked.replace(SOURCE_URL, rewriteOne)
}

export function fixLinks(content: string) {
	// Preserve code examples verbatim, including unfinished fenced blocks.
	return content
		.split(/(```[\s\S]*?(?:```|$)|`[^`\n]+`)/g)
		.map((part, index) => (index % 2 ? part : fixPlainLinks(part)))
		.join('')
}

function installSendPatch(cleanup: (...fns: Array<() => unknown>) => void) {
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
