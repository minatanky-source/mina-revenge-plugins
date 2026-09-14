export interface LargeFileSettings {
	enabled: boolean
	partSizeMiB: 9 | 19
	autoQueueBatches: boolean
}

export const DEFAULTS: LargeFileSettings = {
	enabled: true,
	partSizeMiB: 19,
	autoQueueBatches: true,
}

let storage: any

export function setStorage(handle: any) {
	storage = handle
}

export function getSettings(): LargeFileSettings {
	return { ...DEFAULTS, ...(storage?.cache ?? {}) }
}
