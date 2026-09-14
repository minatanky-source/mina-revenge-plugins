import { getSettings } from './state'
import { getTranslation } from './translator'

const SYNTHETIC_FLAG = '__mina_auto_translator'
const RETRY_CLEAR_MS = 15000
const MAX_TRACKED_MESSAGES = 500

interface MessageEntry {
  id: string
  channelId: string
  original: string
  translated?: string
  target?: string
}

const entries = new Map<string, MessageEntry>()
const pending = new Map<string, number>()
const deferred = new Set<number>()

function stores() {
  return (revenge.discord.flux as any)?.Stores
}

function dispatcher() {
  return (revenge.discord.common as any)?.flux?.Dispatcher
}

function keyFor(channelId: string, id: string) {
  return channelId + ':' + id
}

function messageId(message: any) {
  const value = message?.id
  return typeof value === 'string' ? value : undefined
}

function channelId(message: any, fallback?: unknown) {
  const value =
    message?.channel_id ??
    message?.channelId ??
    fallback

  return typeof value === 'string' ? value : undefined
}

function authorId(message: any) {
  const value =
    message?.author?.id ??
    message?.authorId

  return typeof value === 'string' ? value : undefined
}

function currentUserId() {
  try {
    const value = stores()?.UserStore?.getCurrentUser?.()?.id
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

function rawContent(message: any) {
  const value = message?.content
  return typeof value === 'string' ? value : undefined
}

function shouldHandle(message: any) {
  const content = rawContent(message)
  if (!content || content.trim().length < 2) return false

  const author = authorId(message)
  if (!author) return false

  const self = currentUserId()
  if (self && author === self) return false

  return true
}

function remember(entry: MessageEntry) {
  const key = keyFor(entry.channelId, entry.id)

  if (entries.has(key)) entries.delete(key)
  entries.set(key, entry)

  while (entries.size > MAX_TRACKED_MESSAGES) {
    const oldest = entries.keys().next()
    if (oldest.done) break
    entries.delete(oldest.value)
  }
}

const TOKEN_PATTERN =
  /(```[\s\S]*?```|`[^`\n]+`|https?:\/\/\S+|<a?:[^:>\s]+:\d+>|<@!?\d+>|<@&\d+>|<#\d+>|<t:\d+(?::[A-Za-z])?>|<\/[^:>]+:\d+>)/g

function protectText(text: string) {
  const tokens: string[] = []

  const prepared = text.replace(TOKEN_PATTERN, token => {
    const index = tokens.push(token) - 1
    return 'ZXQMINATOKEN' + index + 'ZXQ'
  })

  return { prepared, tokens }
}

function restoreText(text: string, tokens: string[]) {
  let restored = text

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const marker = new RegExp(
      'ZXQ\\s*MINA\\s*TOKEN\\s*' + index + '\\s*ZXQ',
      'gi',
    )
    restored = restored.replace(marker, token)
  }

  return restored
}

function toPlainMessage(message: any, channel: string, content: string) {
  let raw: any

  try {
    raw =
      typeof message?.toJS === 'function'
        ? message.toJS()
        : { ...message }
  } catch {
    raw = {}
  }

  raw = {
    ...raw,
    id: messageId(message) ?? raw?.id,
    content,
    channel_id: raw?.channel_id ?? channel,
  }

  if (raw.author == null && message?.author != null) {
    raw.author = message.author
  }

  return raw
}

function getCachedMessage(channel: string, id: string) {
  try {
    const store = stores()?.MessageStore
    const direct = store?.getMessage?.(channel, id)
    if (direct) return direct

    const cache = store?.getMessages?.(channel)
    const list: any[] = []

    if (Array.isArray(cache)) list.push(...cache)
    else if (Array.isArray(cache?._array)) list.push(...cache._array)
    else if (typeof cache?.forEach === 'function') {
      cache.forEach((item: any) => list.push(item))
    }

    return list.find(item => messageId(item) === id)
  } catch {
    return undefined
  }
}

function dispatchContent(entry: MessageEntry, content: string) {
  try {
    const bus = dispatcher()
    if (typeof bus?.dispatch !== 'function') return

    const current =
      getCachedMessage(entry.channelId, entry.id) ??
      {
        id: entry.id,
        channel_id: entry.channelId,
        content: entry.original,
      }

    const payload = toPlainMessage(
      current,
      entry.channelId,
      content,
    )

    bus.dispatch({
      type: 'MESSAGE_UPDATE',
      message: payload,
      [SYNTHETIC_FLAG]: true,
    })
  } catch (error) {
    console.warn(
      '[AutoTranslator] local message update failed:',
      String(error),
    )
  }
}

function applyTranslation(
  entry: MessageEntry,
  target: string,
  translatedProtected: string,
  tokens: string[],
) {
  const currentEntry = entries.get(
    keyFor(entry.channelId, entry.id),
  )

  if (!currentEntry) return
  if (currentEntry.original !== entry.original) return

  const translated = restoreText(
    translatedProtected,
    tokens,
  ).trim()

  currentEntry.target = target
  currentEntry.translated = translated

  if (!translated || translated === currentEntry.original) return

  dispatchContent(currentEntry, translated)
}

function queueTranslation(entry: MessageEntry) {
  const settings = getSettings()
  if (!settings.enabled) return

  const target = settings.targetLanguage
  const requestKey =
    keyFor(entry.channelId, entry.id) +
    '\u0000' +
    target +
    '\u0000' +
    entry.original

  if (pending.has(requestKey)) return

  const { prepared, tokens } = protectText(entry.original)

  const onReady = () => {
    const clearTimer = pending.get(requestKey)
    if (clearTimer !== undefined) {
      clearTimeout(clearTimer)
      pending.delete(requestKey)
    }

    const translated = getTranslation(
      prepared,
      target,
      () => {},
    )

    if (translated !== undefined) {
      applyTranslation(
        entry,
        target,
        translated,
        tokens,
      )
    }
  }

  const immediate = getTranslation(
    prepared,
    target,
    onReady,
  )

  if (immediate !== undefined) {
    const timer = setTimeout(() => {
      pending.delete(requestKey)
      applyTranslation(
        entry,
        target,
        immediate,
        tokens,
      )
    }, 0)

    pending.set(requestKey, timer as unknown as number)
    return
  }

  const timer = setTimeout(() => {
    pending.delete(requestKey)
  }, RETRY_CLEAR_MS)

  pending.set(requestKey, timer as unknown as number)
}

function observeMessage(message: any, fallbackChannel?: unknown) {
  if (!shouldHandle(message)) return

  const id = messageId(message)
  const channel = channelId(message, fallbackChannel)
  const content = rawContent(message)

  if (!id || !channel || content === undefined) return

  const key = keyFor(channel, id)
  const existing = entries.get(key)

  if (!existing) {
    const entry: MessageEntry = {
      id,
      channelId: channel,
      original: content,
    }

    remember(entry)
    queueTranslation(entry)
    return
  }

  if (content === existing.translated) {
    if (
      existing.target !==
      getSettings().targetLanguage
    ) {
      queueTranslation(existing)
    }
    return
  }

  if (content !== existing.original) {
    existing.original = content
    existing.translated = undefined
    existing.target = undefined
    remember(existing)
  }

  queueTranslation(existing)
}

function scanMessages(cache: any, fallbackChannel?: unknown) {
  const list: any[] = []

  try {
    if (Array.isArray(cache)) list.push(...cache)
    else if (Array.isArray(cache?._array)) {
      list.push(...cache._array)
    } else if (typeof cache?.forEach === 'function') {
      cache.forEach((message: any) => list.push(message))
    }
  } catch {
    return
  }

  for (const message of list) {
    observeMessage(message, fallbackChannel)
  }
}

function defer(callback: () => void) {
  const timer = setTimeout(() => {
    deferred.delete(timer as unknown as number)

    try {
      callback()
    } catch (error) {
      console.error(
        '[AutoTranslator] deferred task failed:',
        error,
      )
    }
  }, 0)

  deferred.add(timer as unknown as number)
}

function scanCurrentChannel() {
  try {
    const state = stores()
    const selected =
      state?.SelectedChannelStore?.getChannelId?.()

    if (typeof selected !== 'string' || !selected) {
      return
    }

    const cache =
      state?.MessageStore?.getMessages?.(selected)

    scanMessages(cache, selected)
  } catch (error) {
    console.warn(
      '[AutoTranslator] current channel scan failed:',
      String(error),
    )
  }
}

function restoreAll() {
  for (const entry of entries.values()) {
    if (
      entry.translated !== undefined &&
      entry.translated !== entry.original
    ) {
      dispatchContent(entry, entry.original)
    }

    entry.translated = undefined
    entry.target = undefined
  }
}

export function repaintAll(originalOnly = false) {
  if (originalOnly || !getSettings().enabled) {
    restoreAll()
    return
  }

  for (const entry of entries.values()) {
    queueTranslation(entry)
  }

  defer(scanCurrentChannel)
}

function patchMessageStore(
  cleanup: (...fns: Array<() => any>) => void,
) {
  try {
    const store = stores()?.MessageStore

    if (typeof store?.getMessages !== 'function') {
      console.warn(
        '[AutoTranslator] MessageStore.getMessages unavailable',
      )
      return
    }

    cleanup(
      revenge.patcher.after(
        store,
        'getMessages',
        (ret: any) => {
          defer(() => scanMessages(ret))
          return ret
        },
      ),
    )

    console.log(
      '[AutoTranslator] MessageStore.getMessages hooked',
    )
  } catch (error) {
    console.error(
      '[AutoTranslator] MessageStore hook failed:',
      error,
    )
  }
}

function watchFlux(
  cleanup: (...fns: Array<() => any>) => void,
) {
  try {
    const onFluxEventDispatched =
      (revenge.discord.flux as any)
        ?.onFluxEventDispatched

    if (typeof onFluxEventDispatched !== 'function') {
      console.warn(
        '[AutoTranslator] Flux event watcher unavailable',
      )
      return
    }

    cleanup(
      onFluxEventDispatched(
        'MESSAGE_CREATE',
        (payload: any) => {
          try {
            observeMessage(
              payload?.message,
              payload?.channelId,
            )
          } catch (error) {
            console.error(
              '[AutoTranslator] MESSAGE_CREATE failed:',
              error,
            )
          }

          return payload
        },
      ),
    )

    cleanup(
      onFluxEventDispatched(
        'MESSAGE_UPDATE',
        (payload: any) => {
          try {
            if (payload?.[SYNTHETIC_FLAG]) {
              return payload
            }

            observeMessage(
              payload?.message,
              payload?.channelId,
            )
          } catch (error) {
            console.error(
              '[AutoTranslator] MESSAGE_UPDATE failed:',
              error,
            )
          }

          return payload
        },
      ),
    )

    cleanup(
      onFluxEventDispatched(
        'LOAD_MESSAGES_SUCCESS',
        (payload: any) => {
          try {
            const messages =
              payload?.messages ??
              payload?.messageRecords

            defer(() =>
              scanMessages(
                messages,
                payload?.channelId,
              ),
            )
          } catch (error) {
            console.error(
              '[AutoTranslator] LOAD_MESSAGES_SUCCESS failed:',
              error,
            )
          }

          return payload
        },
      ),
    )

    console.log(
      '[AutoTranslator] Flux message watchers installed',
    )
  } catch (error) {
    console.error(
      '[AutoTranslator] Flux watcher setup failed:',
      error,
    )
  }
}

export function patchChatManager(
  cleanup: (...fns: Array<() => any>) => void,
) {
  patchMessageStore(cleanup)
  watchFlux(cleanup)
  defer(scanCurrentChannel)
}

export function resetChat() {
  restoreAll()

  for (const timer of pending.values()) {
    clearTimeout(timer)
  }

  for (const timer of deferred) {
    clearTimeout(timer)
  }

  pending.clear()
  deferred.clear()
  entries.clear()
}
