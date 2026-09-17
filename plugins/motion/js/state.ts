export type MotionPreset = 'subtle' | 'smooth' | 'bouncy'

export interface MotionSettings {
	enabled: boolean
	preset: MotionPreset
	navigation: boolean
	channels: boolean
	guilds: boolean
	sheets: boolean
	controls: boolean
	respectReduceMotion: boolean
}

export const DEFAULTS: MotionSettings = {
	enabled: true,
	preset: 'smooth',
	navigation: true,
	channels: true,
	guilds: true,
	sheets: true,
	controls: true,
	respectReduceMotion: true,
}

let storage: any

export function setStorage(handle: any) {
	storage = handle
}

export function getSettings(): MotionSettings {
	return { ...DEFAULTS, ...(storage?.cache ?? {}) }
}
