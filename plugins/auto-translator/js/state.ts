export interface TranslatorSettings {
  enabled: boolean
  targetLanguage: string
}

export const DEFAULTS: TranslatorSettings = {
  enabled: true,
  targetLanguage: 'pt',
}

let storage: any

export function setStorage(handle: any) {
  storage = handle
}

export function getSettings(): TranslatorSettings {
  return { ...DEFAULTS, ...(storage?.cache ?? {}) }
}
