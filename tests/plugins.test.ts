import { afterEach, expect, test } from 'bun:test'
import { flush, runtime } from './runtime'

const sessions: ReturnType<typeof runtime>[] = []
function open(
	name = 'auto-translator',
	options: Parameters<typeof runtime>[1] = {},
) {
	const session = runtime(name, options)
	sessions.push(session)
	return session
}
afterEach(async () => {
	for (const session of sessions.splice(0)) await session.dispose()
})

test('translates a channel when Discord stores initialize after the plugin', async () => {
	const app = open('auto-translator', { lazy: true, collection: 'toArray' })
	app.add('1', 'Hello there')
	app.add('2', 'My own message', 'one', 'self')
	await app.start()
	await flush()
	expect(app.requests).toHaveLength(0)
	for (const name of ['MessageStore', 'SelectedChannelStore', 'UserStore'])
		app.publishStore(name)
	await flush()
	expect(app.content('1')).toBe('pt: Hello there')
	expect(app.content('2')).toBe('My own message')
	expect(app.requests).toHaveLength(1)
})

test('translates new messages and a different channel without restarting', async () => {
	const app = open()
	app.add('2', 'Second channel', 'two')
	await app.start()
	await app.dispatch({
		type: 'MESSAGE_CREATE',
		message: {
			id: '1',
			channel_id: 'one',
			content: 'New message',
			author: { id: 'other' },
		},
	})
	await flush()
	expect(app.content('1')).toBe('pt: New message')
	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'two' })
	await flush()
	expect(app.content('2', 'two')).toBe('pt: Second channel')
})

test('partial edits are read after Flux updates the message store', async () => {
	const app = open()
	app.add('1', 'Before edit')
	await app.start()
	await flush()
	await app.dispatch({
		type: 'MESSAGE_UPDATE',
		message: { id: '1', channel_id: 'one', content: 'After edit' },
	})
	await flush()
	expect(app.content('1')).toBe('pt: After edit')
	await app.api.jsonStorage.set({ enabled: false })
	expect(app.content('1')).toBe('After edit')
})

test('updates only local content and restores it when disabled', async () => {
	const app = open()
	app.add('1', 'Hello')
	await app.start()
	await flush()
	const updates = app.dispatched.filter(event => event.__mina_auto_translator)
	expect(Object.keys(updates[0].message).sort()).toEqual([
		'channel_id',
		'content',
		'id',
	])
	expect(app.sent).toHaveLength(0)
	await app.command('!tr off')
	expect(app.content('1')).toBe('Hello')
	await app.command('!tr on')
	await flush()
	expect(app.content('1')).toBe('pt: Hello')
})

test('preserves mentions, URLs and code including replacement metacharacters', async () => {
	const app = open()
	const original = 'Hello <@123> `a$&b` https://example.com/a$&b'
	app.add('1', original)
	app.add('2', '```Hello code```')
	await app.start()
	await flush()
	expect(app.content('1')).toBe('pt: ' + original)
	expect(app.content('2')).toBe('```Hello code```')
	expect(app.requests).toHaveLength(1)
	expect(app.requests[0].searchParams.get('q')).not.toContain('<@123>')
})

test('deduplicates identical messages and does not repeatedly dispatch cached translations', async () => {
	const app = open()
	app.add('1', 'Same message')
	app.add('2', 'Same message')
	await app.start()
	await flush()
	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'one' })
	await flush()
	expect(app.requests).toHaveLength(1)
	expect(
		app.dispatched.filter(event => event.__mina_auto_translator),
	).toHaveLength(2)
})

test('discards in-flight results after disabling even if fetch ignores abort', async () => {
	let finish!: (value: Response) => void
	const app = open('auto-translator', {
		fetch: (() =>
			new Promise(resolve => {
				finish = resolve
			})) as typeof fetch,
	})
	app.add('1', 'Hello')
	await app.start()
	await flush()
	await app.api.jsonStorage.set({ enabled: false })
	finish(new Response(JSON.stringify([[['Olá']]])))
	await flush()
	expect(app.content('1')).toBe('Hello')
	expect(
		app.dispatched.filter(event => event.__mina_auto_translator),
	).toHaveLength(0)
})

test('language changes discard old requests and translate the original text', async () => {
	let finish!: (value: Response) => void
	const app = open('auto-translator', {
		fetch: ((input: any) => {
			const url = new URL(input)
			if (url.searchParams.get('tl') === 'pt')
				return new Promise(resolve => {
					finish = resolve
				})
			return Promise.resolve(new Response(JSON.stringify([[['Hola']]])))
		}) as typeof fetch,
	})
	app.add('1', 'Hello')
	await app.start()
	await flush()
	await app.command('!tr es')
	finish(new Response(JSON.stringify([[['Olá']]])))
	await flush()
	expect(app.content('1')).toBe('Hola')
	expect(app.requests.every(url => url.searchParams.get('q') === 'Hello')).toBe(
		true,
	)
})

test('late translation cannot overwrite a server edit or resurrect a deleted message', async () => {
	const pending: Array<(value: Response) => void> = []
	const app = open('auto-translator', {
		fetch: (() =>
			new Promise(resolve => pending.push(resolve))) as typeof fetch,
	})
	app.add('1', 'Old text')
	app.add('2', 'Delete me')
	await app.start()
	await flush()
	await app.dispatch({
		type: 'MESSAGE_UPDATE',
		message: { id: '1', channel_id: 'one', content: 'New text' },
	})
	await app.dispatch({ type: 'MESSAGE_DELETE', id: '2', channelId: 'one' })
	pending[0](new Response(JSON.stringify([[['Texto antigo']]])))
	pending[1](new Response(JSON.stringify([[['Apague']]])))
	await flush()
	expect(app.content('1')).toBe('New text')
	expect(app.content('2')).toBeUndefined()
	for (const resolve of pending.slice(2))
		resolve(new Response(JSON.stringify([[['Texto novo']]])))
})

test('HTTP errors appear in status and retry recovers without spamming the provider', async () => {
	let failing = true
	const app = open('auto-translator', {
		fetch: (async () =>
			failing
				? new Response('', { status: 429 })
				: new Response(JSON.stringify([[['Olá']]]))) as typeof fetch,
	})
	app.add('1', 'Hello')
	await app.start()
	await flush()
	await app.command('!tr status')
	expect(app.alerts.at(-1)).toContain('HTTP 429')
	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'one' })
	await flush()
	expect(app.requests).toHaveLength(1)
	failing = false
	await app.command('!tr retry')
	await flush()
	expect(app.content('1')).toBe('Olá')
})

test('a stalled response body times out and releases the translation workers', async () => {
	const app = open('auto-translator', {
		fetch: (async () => ({
			ok: true,
			json: () => new Promise(() => {}),
		})) as unknown as typeof fetch,
	})
	app.add('1', 'Hello')
	await app.start()
	await flush(110)
	await app.command('!tr status')
	expect(app.alerts.at(-1)).toContain('12 segundos')
	expect(app.alerts.at(-1)).toContain('Na fila: 0')
})

test('local diagnostic commands are intercepted while ordinary messages keep their return value', async () => {
	const app = open()
	await app.start()
	await flush()
	await app.command('!tr test')
	expect(app.alerts.at(-1)).toContain('pt: Hello! How are you?')
	expect(app.sent).toHaveLength(0)
	expect(await app.command('!trade normal message')).toBe('sent')
	expect(app.sent).toHaveLength(1)
	await app.stop()
	await app.command('!tr status')
	expect(app.sent).toHaveLength(2)
})

test('translates outgoing messages to English by default', async () => {
	const app = open()
	await app.start()
	await flush()
	expect(await app.command('Olá pessoal')).toBe('sent')
	expect(app.sent).toHaveLength(1)
	expect(app.sent[0][1].content).toBe('en: Olá pessoal')
	expect(app.requests.at(-1)?.searchParams.get('tl')).toBe('en')
})

test('outgoing translation has its own language and enable switch', async () => {
	const app = open()
	await app.start()
	await flush()
	await app.command('!tr out es')
	expect(app.sent).toHaveLength(0)
	await app.command('Bom dia')
	expect(app.sent.at(-1)?.[1].content).toBe('es: Bom dia')
	await app.command('!tr out off')
	await app.command('Mensagem original')
	expect(app.sent.at(-1)?.[1].content).toBe('Mensagem original')
	await app.command('!tr out on')
	await app.command('Outra mensagem')
	expect(app.sent.at(-1)?.[1].content).toBe('es: Outra mensagem')
})

test('outgoing translation preserves Discord tokens and falls back to original on failure', async () => {
	const app = open()
	await app.start()
	await flush()
	const original = "Oi <@123> `a$&b` https://example.com/a$&b"
	await app.command(original)
	expect(app.sent.at(-1)?.[1].content).toBe('en: ' + original)
	await app.dispose()

	const failing = open('auto-translator', {
		fetch: (async () => new Response('', { status: 429 })) as typeof fetch,
	})
	await failing.start()
	await flush()
	expect(await failing.command('Não bloquear meu envio')).toBe('sent')
	expect(failing.sent.at(-1)?.[1].content).toBe('Não bloquear meu envio')
})


test('Large File Sender leaves files below the limit untouched', async () => {
	const app = open('large-file-sender', {
		nativeMethods: {
			'dev.minatanky.large-file-sender.splitFile': () => ({
				split: false,
				size: 1024,
			}),
			'dev.minatanky.large-file-sender.cleanupSession': () => true,
		},
	})
	await app.start()
	await flush()
	await app.attach([{ uri: 'content://small', filename: 'small.zip' }])
	expect(app.uploads).toHaveLength(1)
	expect(app.uploads[0].files[0].uri).toBe('content://small')
	expect(app.nativeCalls[0].args[2]).toBe(19 * 1024 * 1024)
})

test('Large File Sender replaces an oversized file with uploadable parts', async () => {
	const parts = Array.from({ length: 3 }, (_, index) => ({
		uri: 'file:///parts/p' + (index + 1),
		filename: 'archive.zip.mina.part00' + (index + 1) + '-of003',
		size: 1024,
		index: index + 1,
		count: 3,
	}))
	const app = open('large-file-sender', {
		nativeMethods: {
			'dev.minatanky.large-file-sender.splitFile': () => ({
				split: true,
				size: 50 * 1024 * 1024,
				sessionId: 'session-123456',
				parts,
			}),
			'dev.minatanky.large-file-sender.cleanupSession': () => true,
		},
	})
	await app.start()
	await flush()
	await app.attach([
		{
			id: 'original',
			uri: 'content://large',
			originalUri: 'content://large',
			filename: 'archive.zip',
			mimeType: 'application/zip',
			platform: 1,
			origin: 0,
		},
	])
	expect(app.uploads).toHaveLength(1)
	expect(app.uploads[0].files).toHaveLength(3)
	expect(app.uploads[0].files[0]).toMatchObject({
		uri: 'file:///parts/p1',
		filename: 'archive.zip.mina.part001-of003',
		mimeType: 'application/octet-stream',
	})
	expect(app.toasts.at(-1)).toContain('3 partes')

	await app.dispatch({
		type: 'MESSAGE_CREATE',
		message: {
			id: 'sent-1',
			channel_id: 'one',
			author: { id: 'self' },
			attachments: parts.map(part => ({ filename: part.filename })),
		},
	})
	await flush()
	expect(
		app.nativeCalls.some(
			call => call.name === 'dev.minatanky.large-file-sender.cleanupSession',
		),
	).toBe(true)
})

test('Large File Sender queues more than ten parts across messages', async () => {
	const parts = Array.from({ length: 12 }, (_, index) => ({
		uri: 'file:///parts/p' + (index + 1),
		filename:
			'huge.bin.mina.part' +
			String(index + 1).padStart(3, '0') +
			'-of012',
		size: 1024,
		index: index + 1,
		count: 12,
	}))
	const app = open('large-file-sender', {
		nativeMethods: {
			'dev.minatanky.large-file-sender.splitFile': () => ({
				split: true,
				size: 220 * 1024 * 1024,
				sessionId: 'session-queue-123',
				parts,
			}),
			'dev.minatanky.large-file-sender.cleanupSession': () => true,
		},
	})
	await app.start()
	await flush()
	await app.attach([{ uri: 'content://huge', filename: 'huge.bin' }])
	expect(app.uploads[0].files).toHaveLength(10)

	await app.dispatch({
		type: 'MESSAGE_CREATE',
		message: {
			id: 'batch-1',
			channel_id: 'one',
			author: { id: 'self' },
			attachments: parts
				.slice(0, 10)
				.map(part => ({ filename: part.filename })),
		},
	})
	await flush(25)
	expect(app.uploads).toHaveLength(2)
	expect(app.uploads[1].files).toHaveLength(2)
	expect(app.toasts.at(-1)).toContain('Lote 2/2')

	await app.dispatch({
		type: 'MESSAGE_CREATE',
		message: {
			id: 'batch-2',
			channel_id: 'one',
			author: { id: 'self' },
			attachments: parts
				.slice(10)
				.map(part => ({ filename: part.filename })),
		},
	})
	await flush()
	expect(app.toasts.at(-1)).toContain('Todas as partes')
})

test('Large File Sender falls back to Discord when native splitting fails', async () => {
	const app = open('large-file-sender', {
		nativeMethods: {
			'dev.minatanky.large-file-sender.splitFile': () => {
				throw new Error('cannot read content uri')
			},
			'dev.minatanky.large-file-sender.cleanupSession': () => true,
		},
	})
	await app.start()
	await flush()
	await app.attach([{ uri: 'content://broken', filename: 'broken.bin' }])
	expect(app.uploads).toHaveLength(1)
	expect(app.uploads[0].files[0].uri).toBe('content://broken')
	expect(app.toasts.at(-1)).toContain('anexo original')
})

test('Motion installs the root hook synchronously before storage finishes loading', async () => {
	const app = open('motion')
	const starting = app.start()
	app.mountSurface()
	await starting
	await flush()
	app.navigation()
	expect(app.animations).toHaveLength(1)
	expect(app.animations[0].config).toMatchObject({
		useNativeDriver: true,
		isInteraction: false,
		duration: 205,
	})
})

test('Motion preserves button identity, refs and handlers and supports independent switches', async () => {
	const app = open('motion')
	await app.start()
	await flush()
	const ref = { current: null },
		onPress = () => {}
	const button = app.design.Button
	const args = app.jsx(button, { ref, onPress }, 'key')
	expect(args[0]).toBe(button)
	expect(args[1]).toMatchObject({ ref, onPress, scaleAmountInPx: 4 })
	expect(args[2]).toBe('key')
	expect(app.design.Button).toBe(button)
	await app.api.jsonStorage.set({ controls: false })
	expect(app.jsx(button, { ref })[1]).toEqual({ ref })
})

test('Motion also wraps roots compiled with React.createElement', async () => {
	const app = open('motion')
	await app.start()
	const root = app.revenge.react.React.createElement(
		app.AppContainer,
		{ rootTag: 7 },
		'app',
	)
	expect(root.type).toBe(app.AppContainer)
	expect(root.props.rootTag).toBe(7)
	const surface = root.props.children
	expect(surface.props.children).toBe('app')
	surface.type(surface.props)
	await flush()
	app.navigation()
	expect(app.animations).toHaveLength(1)
})

test('Motion respects Android reduced motion and restores active animated values', async () => {
	const app = open('motion')
	await app.start()
	app.mountSurface()
	await flush()
	app.navigation()
	app.reduced(true)
	expect(app.animations[0].stopped).toBe(true)
	expect(app.values[0].value).toBe(1)
	expect(app.jsx(app.design.Button, {})[1]).toEqual({})
	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'two' })
	expect(app.animations).toHaveLength(1)
})

test('Motion channel and sheet switches leave unrelated actions intact', async () => {
	const app = open('motion')
	await app.start()
	app.mountSurface()
	await flush()
	await app.api.jsonStorage.set({ navigation: false, channels: false })
	app.navigation()
	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'two' })
	expect(app.animations).toHaveLength(0)
	expect(app.revenge.discord.actions.ActionSheetActionCreators.openLazy()).toBe(
		'sheet',
	)
	expect(app.animations).toHaveLength(1)
})

test('Motion fully unhooks and resets its surface when stopped', async () => {
	const app = open('motion')
	await app.start()
	app.mountSurface()
	await flush()
	app.navigation()
	await app.stop()
	expect(app.values[0].value).toBe(1)
	expect(app.jsx(app.design.Button, {})[1]).toEqual({})
	expect(app.jsx(app.AppContainer, { children: 'app' })[1].children).toBe('app')
	app.navigation()
	expect(app.animations).toHaveLength(1)
})

test('Motion requests a reload when enabled after the app root has already mounted', async () => {
	const app = open('motion')
	app.api.plugin.startedLate = true
	await app.start()
	expect(app.reloads()).toBe(1)
})
