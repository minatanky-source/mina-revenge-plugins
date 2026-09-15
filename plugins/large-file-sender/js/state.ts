export interface LargeVideoSettings {
	enabled: boolean
	targetSizeMB: 9 | 19
}

export const DEFAULTS: LargeVideoSettings = {
	enabled: true,
	targetSizeMB: 19,
}

let storage: any

export function setStorage(handle: any) {
	storage = handle
}

export function getSettings(): LargeVideoSettings {
	return { ...DEFAULTS, ...(storage?.cache ?? {}) }
}
