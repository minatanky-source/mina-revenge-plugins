import { cleanupSession, splitFile } from './native'
import { DEFAULTS, getSettings, setStorage } from './state'
import type { LargeFileSettings } from './state'
import { SettingsComponent } from './ui'

const TAG = '[LargeFileSender]'
const MAX_ATTACHMENTS = 10
const MIB = 1024 * 1024

type Cleanup = (...fns: Array<() => unknown>) => void
type FileLike = Record<string, any>

interface QueueJob {
	channelId: string
	draftType: any
	remaining: FileLike[]
	currentNames: string[]
	sessionIds: string[]
	totalFiles: number
	batch: number
	batches: number
}

const jobs = new Map<string, QueueJob>()
const processing = new Set<string>()
let uploadHost: any
let rawAddFiles: ((payload: any) => any) | undefined
let userStore: any

function showNotice(message: string) {
	try {
		revenge.discord.actions.ToastActionCreators.open({
			key: `large-file-sender:${Date.now()}`,
			content: message,
		})
	} catch {
		try {
			alert('Large File Sender\n\n' + message)
		} catch {
			console.log(TAG, message)
		}
	}
}

function filenameOf(file: FileLike) {
	if (typeof file?.filename === 'string' && file.filename) return file.filename
	const uri = String(file?.uri ?? file?.originalUri ?? '')
	const raw = uri.split(/[\\/]/).pop()
	return raw || 'arquivo.bin'
}

function uriOf(file: FileLike) {
	const uri = file?.uri ?? file?.originalUri
	return typeof uri === 'string' && uri ? uri : undefined
}

function makePartFile(
	original: FileLike,
	channelId: string,
	sessionId: string,
	part: {
		uri: string
		filename: string
		index: number
		count: number
	},
) {
	return {
		...original,
		id: `mina-large:${sessionId}:${part.index}`,
		uri: part.uri,
		originalUri: part.uri,
		filename: part.filename,
		mimeType: 'application/octet-stream',
		channelId,
		width: undefined,
		height: undefined,
		playableDuration: undefined,
		durationSecs: undefined,
		__minaLargeFilePart: true,
		__minaLargeFileSession: sessionId,
	}
}

async function cleanSessions(ids: string[]) {
	await Promise.all(
		ids.map(id =>
			cleanupSession(id).catch(error =>
				console.warn(TAG, 'cleanup failed:', id, String(error)),
			),
		),
	)
}

function currentNames(files: FileLike[]) {
	return files
		.map(filenameOf)
		.filter((name): name is string => Boolean(name))
}

function addRawFiles(channelId: string, draftType: any, files: FileLike[]) {
	if (!rawAddFiles || !uploadHost || files.length === 0) return
	return Reflect.apply(rawAddFiles, uploadHost, [
		{ channelId, draftType, files },
	])
}

function installJob(
	channelId: string,
	draftType: any,
	files: FileLike[],
	sessionIds: string[],
) {
	const settings = getSettings()
	const first = files.slice(0, MAX_ATTACHMENTS)
	const remaining = files.slice(MAX_ATTACHMENTS)

	if (remaining.length > 0 && !settings.autoQueueBatches) {
		void cleanSessions(sessionIds)
		showNotice(
			`O arquivo virou ${files.length} partes. Ative “Carregar próximos lotes” para arquivos com mais de 10 partes.`,
		)
		return
	}

	const batches = Math.ceil(files.length / MAX_ATTACHMENTS)
	const job: QueueJob = {
		channelId,
		draftType,
		remaining,
		currentNames: currentNames(first),
		sessionIds,
		totalFiles: files.length,
		batch: 1,
		batches,
	}

	jobs.set(channelId, job)
	addRawFiles(channelId, draftType, first)

	if (batches > 1) {
		showNotice(
			`Arquivo dividido em ${files.length} partes. Lote 1/${batches} pronto; depois de enviar, o próximo será carregado.`,
		)
	} else {
		showNotice(
			`Arquivo dividido em ${files.length} parte${files.length === 1 ? '' : 's'} e pronto para enviar.`,
		)
	}
}

async function prepareSelection(payload: any, original: any, self: any) {
	const settings = getSettings()
	const files: FileLike[] = Array.isArray(payload?.files) ? payload.files : []
	const channelId = payload?.channelId

	if (
		!settings.enabled ||
		typeof channelId !== 'string' ||
		files.length === 0 ||
		files.some(file => file?.__minaLargeFilePart)
	) {
		return Reflect.apply(original, self, [payload])
	}

	if (jobs.has(channelId) || processing.has(channelId)) {
		showNotice(
			'Termine de enviar os lotes do arquivo atual antes de anexar outro arquivo.',
		)
		return
	}

	processing.add(channelId)
	const sessions: string[] = []
	const chunked: FileLike[] = []
	const normal: FileLike[] = []
	let didSplit = false

	try {
		for (const file of files) {
			const uri = uriOf(file)
			if (!uri) {
				normal.push(file)
				continue
			}

			const result = await splitFile(
				uri,
				filenameOf(file),
				settings.partSizeMiB * MIB,
			)

			if (!result?.split || !result.sessionId || !Array.isArray(result.parts)) {
				normal.push(file)
				continue
			}

			didSplit = true
			sessions.push(result.sessionId)

			for (const part of result.parts) {
				chunked.push(
					makePartFile(file, channelId, result.sessionId, part),
				)
			}
		}

		if (!didSplit) {
			return Reflect.apply(original, self, [payload])
		}

		// Put generated parts first so every queued batch contains an identifiable
		// filename even when the original selection also contained small files.
		installJob(
			channelId,
			payload.draftType,
			[...chunked, ...normal],
			sessions,
		)
		return
	} catch (error) {
		console.error(TAG, 'failed to prepare file:', error)
		void cleanSessions(sessions)
		showNotice(
			'Não consegui dividir esse arquivo. O Discord vai tentar o anexo original.',
		)
		return Reflect.apply(original, self, [payload])
	} finally {
		processing.delete(channelId)
	}
}

function messageMatchesCurrentBatch(message: any, job: QueueJob) {
	const attachments = Array.isArray(message?.attachments)
		? message.attachments
		: []

	const names = new Set(
		attachments
			.map((attachment: any) => attachment?.filename ?? attachment?.name)
			.filter((name: unknown): name is string => typeof name === 'string'),
	)

	return (
		job.currentNames.length > 0 &&
		job.currentNames.every(name => names.has(name))
	)
}

function advanceJob(message: any) {
	const channelId = message?.channel_id ?? message?.channelId
	if (typeof channelId !== 'string') return

	const job = jobs.get(channelId)
	if (!job) return

	const selfId = userStore?.getCurrentUser?.()?.id
	if (!selfId || message?.author?.id !== selfId) return
	if (!messageMatchesCurrentBatch(message, job)) return

	if (job.remaining.length === 0) {
		jobs.delete(channelId)
		void cleanSessions(job.sessionIds)
		showNotice('Todas as partes do arquivo foram enviadas.')
		return
	}

	const next = job.remaining.splice(0, MAX_ATTACHMENTS)
	job.batch++
	job.currentNames = currentNames(next)

	// Give Discord a moment to clear the just-sent attachments from the composer.
	setTimeout(() => {
		if (jobs.get(channelId) !== job) return
		addRawFiles(channelId, job.draftType, next)
		showNotice(`Lote ${job.batch}/${job.batches} carregado. Pode enviar.`)
	}, 500)
}

function patchUploads(cleanup: Cleanup) {
	const { getModules } = revenge.modules.finders
	const { withProps } = revenge.modules.finders.filters
	const seen = new Set<any>()

	const unsubscribe = getModules(
		withProps('addFiles', 'addFile', 'clearAll'),
		(mod: any) => {
			const host =
				typeof mod?.addFiles === 'function'
					? mod
					: typeof mod?.default?.addFiles === 'function'
						? mod.default
						: undefined

			if (!host || seen.has(host) || typeof host.addFiles !== 'function') return
			seen.add(host)

			uploadHost = host
			rawAddFiles = host.addFiles

			cleanup(
				revenge.patcher.instead(
					host,
					'addFiles',
					async function ([payload]: any[], original: any) {
						return prepareSelection(payload, original, this)
					},
				),
			)

			console.log(TAG, 'UploadAttachmentActionCreators hooked')
		},
		{ max: 5 },
	)

	cleanup(unsubscribe)
}

function watchMessages(cleanup: Cleanup) {
	try {
		cleanup(
			revenge.discord.flux.getStore('UserStore', store => {
				userStore = store
			}),
		)

		cleanup(
			revenge.discord.flux.onFluxEventDispatched(
				'MESSAGE_CREATE',
				(payload: any) => {
					try {
						advanceJob(payload?.message)
					} catch (error) {
						console.error(TAG, 'batch advance failed:', error)
					}
					return payload
				},
			),
		)
	} catch (error) {
		console.error(TAG, 'Flux setup failed:', error)
	}
}

export default plugin<{ jsonStorage: LargeFileSettings }>({
	jsonStorage: {
		load: true,
		default: DEFAULTS,
	},

	async start(api) {
		setStorage(api.jsonStorage)
		await api.jsonStorage.get()

		patchUploads(api.cleanup)
		watchMessages(api.cleanup)

		api.cleanup(() => {
			jobs.clear()
			processing.clear()
			uploadHost = undefined
			rawAddFiles = undefined
			userStore = undefined
		})

		console.log(TAG, 'started')
	},

	stop() {
		setStorage(undefined)
		console.log(TAG, 'stopped')
	},

	SettingsComponent,
})
