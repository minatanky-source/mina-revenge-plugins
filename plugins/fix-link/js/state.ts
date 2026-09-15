export interface FixLinkSettings {
	enabled: boolean
}

export const DEFAULTS: FixLinkSettings = {
	enabled: true,
}

let storage: any

export function setStorage(handle: any) {
	storage = handle
}

export function getSettings(): FixLinkSettings {
	return { ...DEFAULTS, ...(storage?.cache ?? {}) }
}
