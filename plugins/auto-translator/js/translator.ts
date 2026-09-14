const MAX_CACHE = 1000
const MAX_QUEUE = 120
const CONCURRENCY = 3

interface TranslationTask {
  key: string
  text: string
  target: string
}

const cache = new Map<string, string>()
const queued = new Set<string>()
const listeners = new Map<string, Set<() => void>>()
const queue: TranslationTask[] = []
let running = 0

function keyFor(text: string, target: string) {
  return target + '\u0000' + text
}

function cacheSet(key: string, value: string) {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)

  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

function shouldTranslate(text: string) {
  const value = text.trim()
  if (value.length < 2 || value.length > 3500) return false
  if (/^https?:\/\/\S+$/i.test(value)) return false
  return /[A-Za-zÀ-ÿ\u0100-\uFFFF]/.test(value)
}

async function googleTranslate(text: string, target: string) {
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    '?client=gtx&sl=auto&dt=t&tl=' +
    encodeURIComponent(target) +
    '&q=' +
    encodeURIComponent(text)

  const response = await fetch(url)
  if (!response.ok) throw new Error('Google Translate HTTP ' + response.status)

  const body = await response.json()
  const translated = Array.isArray(body?.[0])
    ? body[0].map((part: any) => part?.[0] ?? '').join('')
    : ''

  if (!translated) throw new Error('Google Translate returned an empty result')
  return translated
}

function notify(key: string) {
  const callbacks = listeners.get(key)
  listeners.delete(key)

  if (!callbacks) return
  for (const callback of callbacks) {
    try {
      callback()
    } catch {}
  }
}

function pump() {
  while (running < CONCURRENCY && queue.length > 0) {
    const task = queue.shift()
    if (!task) break

    running++

    googleTranslate(task.text, task.target)
      .then(result => {
        cacheSet(task.key, result)
        notify(task.key)
      })
      .catch(error => {
        console.warn('[AutoTranslator] translation failed:', String(error))
        listeners.delete(task.key)
      })
      .finally(() => {
        running--
        queued.delete(task.key)
        pump()
      })
  }
}

export function getTranslation(
  text: string,
  target: string,
  onReady: () => void,
): string | undefined {
  if (!shouldTranslate(text)) return undefined

  const key = keyFor(text, target)
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  let callbacks = listeners.get(key)
  if (!callbacks) {
    callbacks = new Set()
    listeners.set(key, callbacks)
  }
  callbacks.add(onReady)

  if (!queued.has(key) && queue.length < MAX_QUEUE) {
    queued.add(key)
    queue.push({ key, text, target })
    pump()
  }

  return undefined
}

export function resetTranslations() {
  cache.clear()
  queued.clear()
  listeners.clear()
  queue.length = 0
}
