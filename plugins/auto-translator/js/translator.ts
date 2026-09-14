const MAX_CACHE = 500
const MAX_QUEUE = 100
const CONCURRENCY = 3
const TIMEOUT = 12000
const RETRY_DELAY = 30000

interface Task {
	key: string
	text: string
	target: string
	generation: number
	callbacks: Set<() => void>
	controller?: AbortController
}

const cache = new Map<string, string>()
const tasks = new Map<string, Task>()
const failures = new Map<string, number>()
const queue: Task[] = []
let running = 0
let generation = 0
let completed = 0
let lastError = ''

function keyFor(text: string, target: string) {
	return target + '\u0000' + text
}

function trimMap<T>(map: Map<string, T>) {
	while (map.size > MAX_CACHE) map.delete(map.keys().next().value!)
}

export function shouldTranslate(text: string) {
	const value = text.trim()
	if (value.length < 2 || value.length > 3500) return false
	if (/^https?:\/\/\S+$/i.test(value)) return false
	return /[\p{L}]/u.test(value)
}

export async function testTranslation(target: string) {
	return googleTranslate('Hello! How are you?', target)
}

export async function translateNow(text: string, target: string) {
	if (!shouldTranslate(text)) return text
	const key = keyFor(text, target)
	const cached = cache.get(key)
	if (cached !== undefined) return cached
	try {
		const result = await googleTranslate(text, target)
		cache.set(key, result)
		trimMap(cache)
		failures.delete(key)
		completed++
		lastError = ''
		return result
	} catch (error) {
		lastError = String(error)
		failures.set(key, Date.now() + RETRY_DELAY)
		trimMap(failures)
		throw error
	}
}

async function googleTranslate(text: string, target: string, task?: Task) {
	const controller = new AbortController()
	if (task) task.controller = controller
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		// Include the response body in the timeout so a stalled request releases its worker.
		return await Promise.race([
			(async () => {
				const response = await fetch(
					'https://translate.googleapis.com/translate_a/single' +
						'?client=gtx&sl=auto&dt=t&tl=' +
						encodeURIComponent(target) +
						'&q=' +
						encodeURIComponent(text),
					{ signal: controller.signal },
				)
				if (!response.ok)
					throw new Error('Google Translate HTTP ' + response.status)
				const body = await response.json()
				const result = Array.isArray(body?.[0])
					? body[0]
							.map((part: unknown) =>
								Array.isArray(part) && typeof part[0] === 'string'
									? part[0]
									: '',
							)
							.join('')
					: ''
				if (!result) throw new Error('Resposta vazia do Google Translate')
				return result
			})(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					controller.abort()
					reject(new Error('Google Translate demorou mais de 12 segundos'))
				}, TIMEOUT)
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}

function pump() {
	while (running < CONCURRENCY && queue.length) {
		const task = queue.shift()!
		running++
		void googleTranslate(task.text, task.target, task)
			.then(result => {
				if (task.generation !== generation) return
				cache.set(task.key, result)
				trimMap(cache)
				failures.delete(task.key)
				completed++
				lastError = ''
				for (const callback of task.callbacks) {
					try {
						callback()
					} catch (error) {
						console.warn('[AutoTranslator] atualização do chat:', String(error))
					}
				}
			})
			.catch(error => {
				if (task.generation !== generation) return
				lastError = String(error)
				failures.set(task.key, Date.now() + RETRY_DELAY)
				trimMap(failures)
				console.warn('[AutoTranslator]', lastError)
			})
			.finally(() => {
				running--
				if (tasks.get(task.key) === task) tasks.delete(task.key)
				pump()
			})
	}
}

export function getTranslation(
	text: string,
	target: string,
	onReady: () => void,
) {
	if (!shouldTranslate(text)) return undefined
	const key = keyFor(text, target)
	const result = cache.get(key)
	if (result !== undefined) return result
	if ((failures.get(key) ?? 0) > Date.now()) return undefined
	const existing = tasks.get(key)
	if (existing) {
		existing.callbacks.add(onReady)
		return undefined
	}
	if (queue.length >= MAX_QUEUE) return undefined
	const task: Task = {
		key,
		text,
		target,
		generation,
		callbacks: new Set([onReady]),
	}
	tasks.set(key, task)
	queue.push(task)
	pump()
	return undefined
}

export function translationStatus() {
	return { pending: tasks.size, completed, lastError }
}

export function resetTranslations() {
	generation++
	for (const task of tasks.values()) {
		task.callbacks.clear()
		task.controller?.abort()
	}
	cache.clear()
	tasks.clear()
	failures.clear()
	queue.length = 0
	lastError = ''
}
