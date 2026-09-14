export interface TranslatorSettings {
  enabled: boolean
  targetLanguage: string
  outgoingEnabled: boolean
  outgoingTargetLanguage: string
}

export const DEFAULTS: TranslatorSettings = {
  enabled: true,
  targetLanguage: 'pt',
  outgoingEnabled: true,
  outgoingTargetLanguage: 'en',
}

let storage: any

export function setStorage(handle: any) {
  storage = handle
}

export function getSettings(): TranslatorSettings {
  return { ...DEFAULTS, ...(storage?.cache ?? {}) }
}
