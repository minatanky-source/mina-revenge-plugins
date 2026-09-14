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

interface TagState {
  rows: any[] | undefined
  trusted: boolean
}

const tags = new Map<number, TagState>()
const repaintTimers = new Map<number, number>()

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
  tag: number,
  depth = 0,
  protectedParent = false,
) {
  if (!Array.isArray(nodes) || depth > MAX_DEPTH) return

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue

    const protectedNode = protectedParent || isProtectedNode(node)

    if (typeof node.content === 'string' && !protectedNode) {
      const original = node.content
      const translated = getTranslation(original, target, () =>
        scheduleRepaint(tag),
      )
      if (translated !== undefined) node.content = translated
    }

    if (Array.isArray(node.content)) {
      translateContent(node.content, target, tag, depth + 1, protectedNode)
    }

    if (Array.isArray(node.items)) {
      translateContent(node.items, target, tag, depth + 1, protectedNode)
    }
  }
}

function translateMessage(message: any, target: string, tag: number) {
  if (!message || typeof message !== 'object') return

  const referenced = message.referencedMessage?.message
  if (referenced) translateMessage(referenced, target, tag)

  if (message.isCurrentUserMessageAuthor === true) return
  if (typeof message.authorId !== 'string' || !message.authorId) return

  translateContent(message.content, target, tag)
}

function translateRows(rows: any[], tag: number) {
  const settings = getSettings()
  if (!settings.enabled) return

  for (const row of rows) {
    translateMessage(row?.message, settings.targetLanguage, tag)
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

export function patchChatManager(
  cleanup: (...fns: Array<() => any>) => void,
) {
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
  repaintTimers.clear()
  tags.clear()
  manager = undefined
  replaying = false
}
