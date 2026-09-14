import { Dispatcher } from '@revenge-mod/discord/common/flux'
import { getSettings } from './state'
import { getTranslation, shouldTranslate } from './translator'

type Cleanup = (...fns: Array<() => unknown>) => void
type Message = Record<string, any>
interface Entry {
	id: string
	channel: string
	original: string
	applied?: string
	request?: () => void
}

const FLAG = '__mina_auto_translator'
const entries = new Map<string, Entry>()
const deferred = new Map<string, ReturnType<typeof setTimeout>>()
let messageStore: any
let userStore: any
let selectedStore: any
let active = false
let generation = 0
let lifecycle = 0
let observed = 0
let applied = 0
let lastError = ''

const TOKENS =
	/(\x60\x60\x60[\s\S]*?\x60\x60\x60|\x60[^\x60\n]+\x60|https?:\/\/\S+|<a?:[^:>\s]+:\d+>|<@!?\d+>|<@&\d+>|<#\d+>|<t:\d+(?::[A-Za-z])?>|<\/[^:>]+:\d+>)/g

export function protectText(text: string) {
	const tokens: string[] = []
	const plain = text.replace(TOKENS, '')
	const prepared = text.replace(
		TOKENS,
		token => 'ZXQMINATOKEN' + (tokens.push(token) - 1) + 'ZXQ',
	)
	return { prepared, tokens, translatable: shouldTranslate(plain) }
}

export function restoreText(text: string, tokens: string[]) {
	for (let i = 0; i < tokens.length; i++) {
		const pattern = new RegExp('ZXQ\\s*MINA\\s*TOKEN\\s*' + i + '\\s*ZXQ', 'gi')
		if (!pattern.test(text)) return undefined
		// Replacement functions preserve literal "$&" inside code and URLs.
		text = text.replace(pattern, () => tokens[i]!)
	}
	return text
}

function keyFor(channel: string, id: string) {
	return channel + ':' + id
}
function channelOf(message: Message, fallback?: string) {
	return message.channel_id ?? message.channelId ?? fallback
}

function defer(key: string, callback: () => void) {
	if (!active || deferred.has(key)) return
	deferred.set(
		key,
		setTimeout(() => {
			deferred.delete(key)
			if (!active) return
			try {
				callback()
			} catch (error) {
				recordError(error)
			}
		}, 0),
	)
}

function recordError(error: unknown) {
	lastError = String(error)
	console.warn('[AutoTranslator]', lastError)
}

function cached(entry: Entry) {
	return messageStore?.getMessage?.(entry.channel, entry.id)
}

function dispatchContent(entry: Entry, content: string) {
	const current = cached(entry)
	if (!current || current.content === content) return
	// Never replace a newer server edit with a late translation or restoration.
	if (current.content !== entry.original && current.content !== entry.applied)
		return
	const bus = Dispatcher
	entry.applied = content === entry.original ? undefined : content
	try {
		// MESSAGE_UPDATE takes a partial gateway message, not a normalized MessageRecord.
		void Promise.resolve(
			bus.dispatch({
				type: 'MESSAGE_UPDATE',
				message: { id: entry.id, channel_id: entry.channel, content },
				[FLAG]: true,
			}),
		).catch(recordError)
		applied++
	} catch (error) {
		recordError(error)
	}
}

function translate(entry: Entry) {
	const settings = getSettings()
	if (!active || !settings.enabled) return
	const { prepared, tokens, translatable } = protectText(entry.original)
	if (!translatable) return
	const target = settings.targetLanguage
	const epoch = generation
	const key = keyFor(entry.channel, entry.id)
	const ready = (entry.request ??= () => {
		if (!active || epoch !== generation || entries.get(key) !== entry) return
		const now = getSettings()
		if (!now.enabled || now.targetLanguage !== target) return
		const result = getTranslation(prepared, target, ready)
		if (result === undefined) return
		const restored = restoreText(result, tokens)
		if (restored !== undefined) dispatchContent(entry, restored)
	})
	if (getTranslation(prepared, target, ready) !== undefined) {
		defer('apply:' + key, ready)
	}
}

function observe(message: Message | undefined, fallback?: string) {
	if (!active || !message || typeof message.content !== 'string') return
	const channel = channelOf(message, fallback)
	if (typeof channel !== 'string' || typeof message.id !== 'string') return
	const key = keyFor(channel, message.id)
	const old = entries.get(key)
	if (
		old &&
		(message.content === old.original || message.content === old.applied)
	) {
		translate(old)
		return
	}
	const author = message.author?.id ?? message.authorId
	const self = userStore?.getCurrentUser?.()?.id
	// Wait for UserStore rather than translating outgoing messages during startup.
	if (!self || !author || author === self) return
	if (old) entries.delete(key)
	if (!shouldTranslate(message.content)) return
	const entry: Entry = { id: message.id, channel, original: message.content }
	entries.set(key, entry)
	observed++
	while (entries.size > 500) {
		const first = entries.keys().next().value!
		const evicted = entries.get(first)!
		if (evicted.applied) dispatchContent(evicted, evicted.original)
		entries.delete(first)
	}
	translate(entry)
}

function scan(messages: any, channel?: string) {
	if (Array.isArray(messages))
		messages.forEach(message => observe(message, channel))
	else if (Array.isArray(messages?._array)) scan(messages._array, channel)
	else if (typeof messages?.toArray === 'function')
		scan(messages.toArray(), channel)
	else if (typeof messages?.values === 'function') {
		for (const message of messages.values()) observe(message, channel)
	} else if (typeof messages?.forEach === 'function') {
		messages.forEach((message: Message) => observe(message, channel))
	}
}

function scanCurrent() {
	const channel = selectedStore?.getChannelId?.()
	if (typeof channel === 'string')
		scan(messageStore?.getMessages?.(channel), channel)
}

export function repaintAll(originalOnly = false) {
	generation++
	for (const entry of entries.values()) {
		entry.request = undefined
		if (entry.applied) dispatchContent(entry, entry.original)
		if (!originalOnly) translate(entry)
	}
	if (!originalOnly) defer('current', scanCurrent)
}

export function patchChatManager(cleanup: Cleanup) {
	active = true
	const session = ++lifecycle
	const alive = () => active && session === lifecycle
	// A one-time lookup can miss Discord stores that initialize after the plugin.
	const getStore = revenge.discord.flux.getStore
	cleanup(
		getStore('MessageStore', (store: any) => {
			if (!alive()) return
			if (
				typeof store.getMessages !== 'function' ||
				typeof store.getMessage !== 'function'
			) {
				recordError('MessageStore incompatível com esta versão do Discord')
				return
			}
			messageStore = store
			cleanup(
				revenge.patcher.instead(
					store,
					'getMessages',
					function (args: any[], original: any) {
						const result = Reflect.apply(original, this, args)
						// Scan the returned collection without calling the patched getter again.
						defer('scan:' + args[0], () => scan(result, args[0]))
						return result
					},
				),
			)
			defer('current', scanCurrent)
		}),
	)
	cleanup(
		getStore('UserStore', store => {
			if (alive()) {
				userStore = store
				defer('current', scanCurrent)
			}
		}),
	)
	cleanup(
		getStore('SelectedChannelStore', store => {
			if (!alive()) return
			selectedStore = store
			store.addChangeListener?.(onChannelChanged)
			cleanup(() => store.removeChangeListener?.(onChannelChanged))
			defer('current', scanCurrent)
		}),
	)

	const watch = revenge.discord.flux.onFluxEventDispatched
	for (const type of [
		'MESSAGE_CREATE',
		'MESSAGE_UPDATE',
		'LOAD_MESSAGES_SUCCESS',
		'CHANNEL_SELECT',
		'CONNECTION_OPEN',
	]) {
		cleanup(
			watch(type, (payload: any) => {
				if (!active || payload[FLAG]) return payload
				if (type === 'MESSAGE_CREATE' || type === 'MESSAGE_UPDATE') {
					const raw = payload.message
					const channel = raw && channelOf(raw, payload.channelId)
					// Flux hooks run BEFORE stores. Read partial edits after the dispatch.
					if (raw?.id && channel)
						defer('message:' + keyFor(channel, raw.id), () => {
							observe(
								messageStore?.getMessage?.(channel, raw.id) ?? raw,
								channel,
							)
						})
				} else if (type === 'LOAD_MESSAGES_SUCCESS') {
					defer('load:' + payload.channelId, () => {
						scan(payload.messages ?? payload.messageRecords, payload.channelId)
						scanCurrent()
					})
				} else onChannelChanged()
				return payload
			}),
		)
	}
	cleanup(
		watch('MESSAGE_DELETE', (payload: any) => {
			entries.delete(
				keyFor(payload.channelId ?? payload.channel_id, payload.id),
			)
			return payload
		}),
	)
	defer('current', scanCurrent)
}

function onChannelChanged() {
	defer('current', scanCurrent)
}

export function chatStatus() {
	return {
		ready: Boolean(messageStore && userStore && selectedStore),
		observed,
		applied,
		lastError,
	}
}

export function resetChat() {
	active = false
	lifecycle++
	generation++
	for (const timer of deferred.values()) clearTimeout(timer)
	deferred.clear()
	for (const entry of entries.values())
		if (entry.applied) dispatchContent(entry, entry.original)
	entries.clear()
	messageStore = userStore = selectedStore = undefined
}
