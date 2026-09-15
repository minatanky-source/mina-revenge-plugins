export interface FixLinkSettings {
	enabled: boolean
	youtube: boolean
	twitter: boolean
	instagram: boolean
	tiktok: boolean
	facebook: boolean
	pinterest: boolean
	reddit: boolean
	threads: boolean
	bluesky: boolean
	pixiv: boolean
	twitch: boolean
	tumblr: boolean
	deviantart: boolean
	bilibili: boolean
}

export const DEFAULTS: FixLinkSettings = {
	enabled: true,
	youtube: true,
	twitter: true,
	instagram: true,
	tiktok: true,
	facebook: true,
	pinterest: true,
	reddit: true,
	threads: true,
	bluesky: true,
	pixiv: true,
	twitch: true,
	tumblr: true,
	deviantart: true,
	bilibili: true,
}

let storage: any

export function setStorage(handle: any) {
	storage = handle
}

export function getSettings(): FixLinkSettings {
	return { ...DEFAULTS, ...(storage?.cache ?? {}) }
}
