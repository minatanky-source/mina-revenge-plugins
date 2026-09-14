import { getSettings } from './state'
import { getTranslation } from './translator'

const ChangeType = {
  INSERT: 1,
  UPDATE: 2,
  DELETE: 3,
} as const

const MAX_TAGS = 8
const MAX_DEPTH = 16
const REPAINT_DELAY = 140
const RERENDER_DELAY = 80

interface TagState {
  rows: any[] | undefined
  trusted: boolean
}

const tags = new Map<number, TagState>()
const repaintTimers = new Map<number, number>()
const rerenderTimers = new Map<string, number>()

let manager: any
let replaying = false

function stateFor(tag: number): TagState {
  let state = tags.get(tag)

  if (!state) {
    state = { rows: undefined, trusted: false }
    tags.set(tag, state)

    while (tags.size > MAX_TAGS) {
      const oldest = tags.keys().next()
      if (oldest.done) break
      tags.delete(oldest.value)
    }
  }

  return state
}

function looksLikeFullSync(rows: any[]) {
  return (
    rows.length > 0 &&
    rows.every(
      (row, index) =>
        row?.changeType === ChangeType.INSERT && row?.index === index,
    )
  )
}

function isLoadingRow(row: any) {
  return row?.button != null && row?.isLoading !== undefined
}

function applyBatch(tag: number, rows: any[]) {
  const state = stateFor(tag)

  if (!state.rows) {
    state.rows = rows.slice()
    if (!state.trusted) state.trusted = looksLikeFullSync(rows)
    return
  }

  const list = state.rows

  for (const row of rows) {
    if (row?.changeType === ChangeType.INSERT) {
      list.splice(row.index, 0, row)
    }
  }

  const rest = rows
    .filter(
      row =>
        row?.changeType === ChangeType.DELETE ||
        row?.changeType === ChangeType.UPDATE,
    )
    .reverse()

  for (const row of rest) {
    if (row?.changeType === ChangeType.DELETE) {
      list.splice(row.index, 1)
      continue
    }

    const replacingSpinner =
      isLoadingRow(row) &&
      row.index === 0 &&
      row.button?.action?.type === 'LOAD_MORE_AFTER' &&
      isLoadingRow(list[0]) &&
      list[0]?.isLoading === true

    if (replacingSpinner) {
      list.splice(1, 0, row)
      list.splice(0, 1)
    } else {
      list[row.index] = row
    }
  }
}

function noteCleared(tag: number) {
  const state = stateFor(tag)
  state.rows = undefined
  state.trusted = true
}

function isProtectedNode(node: any) {
  if (node?.userId) return true

  const type = String(node?.type ?? '').toLowerCase()
  return /(mention|emoji|code|link|timestamp|command|attachment)/.test(type)
}

function translateContent(
  nodes: any,
  target: string,
  onReady: () => void,
  depth = 0,
  protectedParent = false,
) {
  if (!Array.isArray(nodes) || depth > MAX_DEPTH) return

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue

    const protectedNode = protectedParent || isProtectedNode(node)

    if (typeof node.content === 'string' && !protectedNode) {
      const original = node.content
      const translated = getTranslation(original, target, onReady)
      if (translated !== undefined) node.content = translated
    }

    if (Array.isArray(node.content)) {
      translateContent(
        node.content,
        target,
        onReady,
        depth + 1,
        protectedNode,
      )
    }

    if (Array.isArray(node.items)) {
      translateContent(
        node.items,
        target,
        onReady,
        depth + 1,
        protectedNode,
      )
    }
  }
}

function translateMessage(
  message: any,
  target: string,
  onReady: () => void,
) {
  if (!message || typeof message !== 'object') return

  const referenced = message.referencedMessage?.message
  if (referenced) translateMessage(referenced, target, onReady)

  if (message.isCurrentUserMessageAuthor === true) return
  if (typeof message.authorId !== 'string' || !message.authorId) return

  translateContent(message.content, target, onReady)
}

function translateRows(rows: any[], tag: number) {
  const settings = getSettings()
  if (!settings.enabled) return

  for (const row of rows) {
    translateMessage(row?.message, settings.targetLanguage, () =>
      scheduleRepaint(tag),
    )
  }
}

function repaintTag(tag: number, originalOnly = false) {
  const state = tags.get(tag)
  const mirror = state?.rows

  if (
    !manager ||
    !state?.trusted ||
    !mirror ||
    mirror.length === 0 ||
    typeof manager.clearRows !== 'function' ||
    typeof manager.updateRows !== 'function'
  ) {
    return
  }

  try {
    const payload: any[] = JSON.parse(JSON.stringify(mirror))

    payload.forEach((row, index) => {
      row.index = index
      row.changeType = ChangeType.INSERT
    })

    if (!originalOnly) translateRows(payload, tag)

    replaying = true
    try {
      manager.clearRows(tag)
      manager.updateRows(tag, JSON.stringify(payload), false)
    } finally {
      replaying = false
    }

    state.rows = mirror
  } catch (error) {
    console.error('[AutoTranslator] repaint failed:', error)
  }
}

function scheduleRepaint(tag: number) {
  if (repaintTimers.has(tag)) return

  const timer = setTimeout(() => {
    repaintTimers.delete(tag)
    repaintTag(tag)
  }, REPAINT_DELAY)

  repaintTimers.set(tag, timer)
}

export function repaintAll(originalOnly = false) {
  for (const tag of tags.keys()) repaintTag(tag, originalOnly)
}

function findChatManager() {
  const candidates = [
    () => (revenge.react.ReactNative as any)?.NativeModules?.DCDChatManager,
    () => (globalThis as any)?.nativeModuleProxy?.DCDChatManager,
    () => (globalThis as any)?.__turboModuleProxy?.('DCDChatManager'),
  ]

  for (const get of candidates) {
    try {
      const found = get()
      if (typeof found?.updateRows === 'function') return found
    } catch {}
  }

  return undefined
}

function installChatManager(
  found: any,
  cleanup: (...fns: Array<() => any>) => void,
) {
  if (manager === found) return
  manager = found

  cleanup(
    revenge.patcher.before(found, 'updateRows', (args: any[]) => {
      try {
        if (!replaying) {
          const tag = args?.[0]
          const json = args?.[1]

          if (typeof tag === 'number' && typeof json === 'string') {
            const rows = JSON.parse(json)

            if (Array.isArray(rows)) {
              applyBatch(tag, rows)

              if (getSettings().enabled) {
                const outgoing = JSON.parse(json)
                translateRows(outgoing, tag)
                args[1] = JSON.stringify(outgoing)
              }
            }
          }
        }
      } catch (error) {
        console.error('[AutoTranslator] updateRows hook failed:', error)
      }

      return args
    }),
  )

  if (typeof found.clearRows === 'function') {
    cleanup(
      revenge.patcher.before(found, 'clearRows', (args: any[]) => {
        try {
          if (!replaying && typeof args?.[0] === 'number') noteCleared(args[0])
        } catch (error) {
          console.error('[AutoTranslator] clearRows hook failed:', error)
        }

        return args
      }),
    )
  }

  console.log('[AutoTranslator] DCDChatManager hooked')
}

function rawMessageId(message: any) {
  try {
    return typeof message?.id === 'string' ? message.id : undefined
  } catch {
    return undefined
  }
}

function rawChannelId(message: any) {
  try {
    const value = message?.channel_id ?? message?.channelId
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

function toPlainMessage(message: any) {
  try {
    if (typeof message?.toJS === 'function') return message.toJS()
  } catch {}

  return message
}

function findCachedMessage(channelId: string, messageId: string) {
  try {
    const stores = (revenge.discord.flux as any)?.Stores
    const cache = stores?.MessageStore?.getMessages?.(channelId)

    if (!cache) return undefined

    const list: any[] = []
    if (Array.isArray(cache)) list.push(...cache)
    else if (Array.isArray(cache._array)) list.push(...cache._array)
    else if (typeof cache.forEach === 'function') {
      cache.forEach((message: any) => list.push(message))
    }

    return list.find(message => rawMessageId(message) === messageId)
  } catch {
    return undefined
  }
}

function scheduleMessageRerender(rawMessage: any) {
  const messageId = rawMessageId(rawMessage)
  if (!messageId) return

  let channelId = rawChannelId(rawMessage)

  if (!channelId) {
    try {
      const stores = (revenge.discord.flux as any)?.Stores
      const selected = stores?.SelectedChannelStore?.getChannelId?.()
      if (typeof selected === 'string') channelId = selected
    } catch {}
  }

  const key = (channelId ?? '') + ':' + messageId
  if (rerenderTimers.has(key)) return

  const timer = setTimeout(() => {
    rerenderTimers.delete(key)

    try {
      const Dispatcher = (revenge.discord.common as any)?.flux?.Dispatcher
      if (typeof Dispatcher?.dispatch !== 'function') return

      const cached = channelId
        ? findCachedMessage(channelId, messageId)
        : undefined
      const source = cached ?? rawMessage
      const plain = toPlainMessage(source)

      if (!plain || typeof plain !== 'object') return

      Dispatcher.dispatch({
        type: 'MESSAGE_UPDATE',
        message: plain,
      })
    } catch (error) {
      console.warn('[AutoTranslator] message rerender failed:', String(error))
    }
  }, RERENDER_DELAY)

  rerenderTimers.set(key, timer)
}

function patchOneRowManager(
  RowManager: any,
  cleanup: (...fns: Array<() => any>) => void,
) {
  const stack: any[] = []

  cleanup(
    revenge.patcher.before(
      RowManager.prototype,
      'generate',
      (args: any[]) => {
        if (stack.length >= 32) stack.length = 0
        stack.push(args?.[0])
        return args
      },
    ),
  )

  cleanup(
    revenge.patcher.after(
      RowManager.prototype,
      'generate',
      (ret: any) => {
        const row = stack.pop()

        try {
          if (!getSettings().enabled) return ret
          if (!row || row.rowType !== 1) return ret

          const generated = ret?.message
          if (!generated) return ret

          translateMessage(
            generated,
            getSettings().targetLanguage,
            () => scheduleMessageRerender(row?.message),
          )
        } catch (error) {
          console.error('[AutoTranslator] RowManager hook failed:', error)
        }

        return ret
      },
    ),
  )

  console.log('[AutoTranslator] RowManager hooked')
}

function installRowManagerFallback(
  cleanup: (...fns: Array<() => any>) => void,
) {
  try {
    const { getModules } = revenge.modules.finders
    const { withName } = revenge.modules.finders.filters
    const seen = new Set<any>()

    const unsubscribe = getModules(
      withName('RowManager'),
      (RowManager: any) => {
        if (!RowManager?.prototype?.generate) return
        if (seen.has(RowManager.prototype)) return

        seen.add(RowManager.prototype)

        try {
          patchOneRowManager(RowManager, cleanup)
        } catch (error) {
          console.error(
            '[AutoTranslator] failed to patch RowManager:',
            error,
          )
        }
      },
      { max: 10 },
    )

    cleanup(unsubscribe)
  } catch (error) {
    console.error(
      '[AutoTranslator] could not subscribe for RowManager:',
      error,
    )
  }
}

export function patchChatManager(
  cleanup: (...fns: Array<() => any>) => void,
) {
  installRowManagerFallback(cleanup)

  const direct = findChatManager()
  if (direct) {
    installChatManager(direct, cleanup)
    return
  }

  try {
    const unsubscribe = revenge.modules.finders.getModules(
      revenge.modules.finders.filters.withProps('DCDChatManager'),
      (mod: any) => {
        const found = mod?.DCDChatManager
        if (typeof found?.updateRows === 'function') {
          installChatManager(found, cleanup)
        }
      },
      { max: 5 },
    )

    cleanup(unsubscribe)
  } catch (error) {
    console.error('[AutoTranslator] could not find DCDChatManager:', error)
  }
}

export function resetChat() {
  for (const timer of repaintTimers.values()) clearTimeout(timer)
  for (const timer of rerenderTimers.values()) clearTimeout(timer)

  repaintTimers.clear()
  rerenderTimers.clear()
  tags.clear()
  manager = undefined
  replaying = false
}
