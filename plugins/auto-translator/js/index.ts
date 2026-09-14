import {
	chatStatus,
	patchChatManager,
	protectText,
	repaintAll,
	resetChat,
	restoreText,
} from './chat'
import { DEFAULTS, setStorage } from './state'
import {
	resetTranslations,
	testTranslation,
	translateNow,
	translationStatus,
} from './translator'
import type { TranslatorSettings } from './state'

const LANGUAGE_ALIASES: Record<string, string> = {
	'pt-br': 'pt',
	portugues: 'pt',
	portuguese: 'pt',
	english: 'en',
	ingles: 'en',
	spanish: 'es',
	espanhol: 'es',
	french: 'fr',
	frances: 'fr',
	german: 'de',
	alemao: 'de',
	italian: 'it',
	italiano: 'it',
	japanese: 'ja',
	japones: 'ja',
	korean: 'ko',
	coreano: 'ko',
	chinese: 'zh-CN',
	chines: 'zh-CN',
}

function normalizeLanguage(value: string) {
	const raw = value.trim()
	const lowered = raw.toLowerCase()
	return LANGUAGE_ALIASES[lowered] ?? raw
}

let commandsActive = false

function showLocalMessage(message: string) {
	try {
		alert('Auto Translator\n\n' + message)
	} catch {
		console.log('[AutoTranslator]', message)
	}
}

function installLocalCommands(
	api: any,
	cleanup: (...fns: Array<() => any>) => void,
) {
	const unsubscribe = revenge.modules.finders.getModules(
		revenge.modules.finders.filters.withProps('sendMessage', 'editMessage'),
		(messageActions: any) => {
			if (!commandsActive || typeof messageActions?.sendMessage !== 'function')
				return

			cleanup(
				revenge.patcher.instead(
					messageActions,
					'sendMessage',
					async function (args: any[], original: any) {
						const message = args?.[1]
						const text =
							typeof message?.content === 'string' ? message.content.trim() : ''

						if (!commandsActive) {
							return original.apply(this, args)
						}

						if (!text.startsWith('!tr')) {
							const current = {
								...DEFAULTS,
								...(api.jsonStorage.cache ?? {}),
							}

							if (
								!current.outgoingEnabled ||
								typeof message?.content !== 'string'
							) {
								return original.apply(this, args)
							}

							const { prepared, tokens, translatable } = protectText(message.content)
							if (!translatable) return original.apply(this, args)

							try {
								const translated = await translateNow(
									prepared,
									current.outgoingTargetLanguage,
								)
								const restored = restoreText(translated, tokens)

								if (restored && restored !== message.content) {
									args[1] = { ...message, content: restored }
								}
							} catch (error) {
								console.warn(
									'[AutoTranslator] tradução de saída falhou:',
									String(error),
								)
							}

							return original.apply(this, args)
						}

						const parts = text.split(/\s+/)
						if (parts[0] !== '!tr') {
							return original.apply(this, args)
						}

						const action = (parts[1] ?? 'help').toLowerCase()

						if (action === 'on') {
							await api.jsonStorage.set({ enabled: true })
							showLocalMessage('Traducao automatica ativada.')
							return undefined
						}

						if (action === 'off') {
							await api.jsonStorage.set({ enabled: false })
							showLocalMessage('Traducao automatica desativada.')
							return undefined
						}

						if (action === 'out') {
							const sub = (parts[2] ?? 'status').toLowerCase()

							if (sub === 'on') {
								await api.jsonStorage.set({ outgoingEnabled: true })
								showLocalMessage('Tradução automática de saída ativada.')
								return undefined
							}

							if (sub === 'off') {
								await api.jsonStorage.set({ outgoingEnabled: false })
								showLocalMessage('Tradução automática de saída desativada.')
								return undefined
							}

							if (/^[A-Za-z-]{2,20}$/.test(parts[2] ?? '')) {
								const outgoingTargetLanguage = normalizeLanguage(parts[2])
								await api.jsonStorage.set({
									outgoingTargetLanguage,
									outgoingEnabled: true,
								})
								showLocalMessage(
									'Idioma de saída alterado para: ' + outgoingTargetLanguage,
								)
								return undefined
							}

							const current = {
								...DEFAULTS,
								...(api.jsonStorage.cache ?? {}),
							}
							showLocalMessage(
								'Saída: ' +
									(current.outgoingEnabled ? 'ativada' : 'desativada') +
									'\nIdioma de saída: ' +
									current.outgoingTargetLanguage,
							)
							return undefined
						}

						if (action === 'test') {
							try {
								const result = await testTranslation(
									api.jsonStorage.cache?.targetLanguage ?? 'pt',
								)
								showLocalMessage(
									'Teste do serviço:\nHello! How are you?\n\n' + result,
								)
							} catch (error) {
								showLocalMessage(
									'Falha no serviço de tradução:\n' + String(error),
								)
							}
							return undefined
						}

						if (action === 'retry') {
							resetTranslations()
							repaintAll()
							showLocalMessage(
								'Traduções reiniciadas. Aguarde alguns segundos.',
							)
							return undefined
						}

						if (action === 'status') {
							const current = {
								...DEFAULTS,
								...(api.jsonStorage.cache ?? {}),
							}
							showLocalMessage(
								'Status: ' +
									(current.enabled ? 'ativado' : 'desativado') +
									'\nIdioma de entrada: ' +
									current.targetLanguage +
									'\nSaída automática: ' +
									(current.outgoingEnabled ? 'ativada' : 'desativada') +
									'\nIdioma de saída: ' +
									current.outgoingTargetLanguage +
									'\nChat: ' +
									(chatStatus().ready
										? 'conectado'
										: 'aguardando componentes do Discord') +
									'\nMensagens encontradas: ' +
									chatStatus().observed +
									'\nAtualizações locais: ' +
									chatStatus().applied +
									'\nTraduções concluídas: ' +
									translationStatus().completed +
									'\nNa fila: ' +
									translationStatus().pending +
									'\nÚltimo erro: ' +
									(translationStatus().lastError ||
										chatStatus().lastError ||
										'nenhum'),
							)
							return undefined
						}

						if (action === 'help') {
							showLocalMessage(
								'!tr pt      - traduz para portugues\n' +
									'!tr en      - traduz para ingles\n' +
									'!tr es      - traduz para espanhol\n' +
									'!tr on      - ativa tradução recebida\n' +
									'!tr off     - desativa tradução recebida\n' +
									'!tr out en  - traduz suas mensagens para inglês\n' +
									'!tr out on  - ativa tradução das suas mensagens\n' +
									'!tr out off - desativa tradução das suas mensagens\n' +
									'!tr status  - mostra o diagnóstico\n' +
									'!tr test    - testa o serviço de tradução\n' +
									'!tr retry   - tenta traduzir novamente',
							)
							return undefined
						}

						if (parts.length === 2 && /^[A-Za-z-]{2,20}$/.test(parts[1])) {
							const targetLanguage = normalizeLanguage(parts[1])
							await api.jsonStorage.set({ targetLanguage })
							showLocalMessage('Idioma alterado para: ' + targetLanguage)
							return undefined
						}

						showLocalMessage(
							'Comando invalido. Use !tr help para ver os comandos.',
						)
						return undefined
					},
				),
			)
		},
		{ max: 5 },
	)

	cleanup(unsubscribe)
}

export default plugin<{ jsonStorage: TranslatorSettings }>({
	jsonStorage: {
		default: DEFAULTS,
		load: true,
	},

	async start(api) {
		setStorage(api.jsonStorage)
		commandsActive = true
		api.cleanup(() => {
			commandsActive = false
		})
		await api.jsonStorage.get()

		patchChatManager(api.cleanup)
		installLocalCommands(api, api.cleanup)

		api.cleanup(
			api.jsonStorage.subscribe(update => {
				if (update.targetLanguage !== undefined || update.enabled !== undefined)
					resetTranslations()

				if (
					update.targetLanguage !== undefined ||
					update.enabled !== undefined
				) {
					repaintAll()
				}
			}),
		)

		console.log('[AutoTranslator] started')
	},

	stop() {
		commandsActive = false
		repaintAll(true)
		resetChat()
		resetTranslations()
		setStorage(undefined)
		console.log('[AutoTranslator] stopped')
	},
})
