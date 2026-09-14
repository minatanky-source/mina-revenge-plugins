import { readFileSync } from 'node:fs'

export const flush = (ms = 15) =>
	new Promise(resolve => setTimeout(resolve, ms))

export function runtime(
	name: string,
	options: { lazy?: boolean; collection?: string; fetch?: typeof fetch } = {},
) {
	const cleanups: Array<() => any> = []
	const storageListeners = new Set<(value: any) => void>()
	const events = new Map<string, Set<(value: any) => any>>()
	const storesWaiting = new Map<string, Set<(value: any) => void>>()
	const available = new Set<string>()
	const timers = new Set<ReturnType<typeof setTimeout>>()
	const messages = new Map<string, any>()
	const requests: URL[] = []
	const sent: any[] = []
	const alerts: string[] = []
	const dispatched: any[] = []
	const jsxHooks = new Map<any, Set<(args: any[]) => any[]>>()
	const effects: Array<() => void> = []
	const animations: any[] = []
	const values: any[] = []
	const navigationListeners = new Set<() => void>()
	const reduceListeners = new Set<(value: boolean) => void>()
	let selected = 'one'
	let reloads = 0
	const key = (channel: string, id: string) => channel + ':' + id
	const store: any = {
		MessageStore: {
			getMessage: (channel: string, id: string) =>
				messages.get(key(channel, id)),
			getMessages(channel: string) {
				const items = [...messages.values()].filter(
					message => message.channel_id === channel,
				)
				return options.collection === 'toArray'
					? { toArray: () => items }
					: { _array: items }
			},
		},
		UserStore: { getCurrentUser: () => ({ id: 'self' }) },
		SelectedChannelStore: {
			getChannelId: () => selected,
			addChangeListener() {},
			removeChangeListener() {},
		},
	}
	const dispatcher = {
		dispatch(payload: any) {
			for (const callback of events.get(payload.type) ?? []) {
				payload = callback(payload)
				if (!payload) return Promise.resolve()
			}
			dispatched.push(payload)
			if (payload.type === 'CHANNEL_SELECT') selected = payload.channelId
			if (
				payload.type === 'MESSAGE_CREATE' ||
				payload.type === 'MESSAGE_UPDATE'
			) {
				const raw = payload.message
				const id = key(raw.channel_id, raw.id)
				messages.set(id, { ...messages.get(id), ...raw })
			}
			if (payload.type === 'MESSAGE_DELETE')
				messages.delete(key(payload.channelId, payload.id))
			return Promise.resolve()
		},
	}
	const patcher = {
		instead(target: any, property: string, callback: any) {
			const original = target[property]
			target[property] = function (...args: any[]) {
				return callback.call(this, args, original)
			}
			return () => {
				target[property] = original
			}
		},
		before(target: any, property: string, callback: any) {
			return this.instead(
				target,
				property,
				function (this: any, args: any[], original: any) {
					return original.apply(this, callback(args))
				},
			)
		},
		after(target: any, property: string, callback: any) {
			return this.instead(
				target,
				property,
				function (this: any, args: any[], original: any) {
					return callback(original.apply(this, args))
				},
			)
		},
	}
	// The real patcher exports standalone functions.
	patcher.after = patcher.after.bind(patcher)
	patcher.before = patcher.before.bind(patcher)
	function AppContainer() {}
	const action = {
		sendMessage(...args: any[]) {
			sent.push(args)
			return Promise.resolve('sent')
		},
		editMessage() {},
	}
	const modules = [action, AppContainer]
	const matches = (filter: any, value: any) =>
		filter.name
			? value.name === filter.name
			: filter.props.every((property: string) => property in value)
	const navigation = {
		addListener(_event: string, callback: () => void) {
			navigationListeners.add(callback)
			return () => navigationListeners.delete(callback)
		},
	}
	const design = Object.fromEntries(
		[
			'Button',
			'IconButton',
			'ImageButton',
			'Stack',
			'TableRadioGroup',
			'TableRadioRow',
			'TableRowGroup',
			'TableSwitchRow',
		].map(name => [name, function Component() {}]),
	)
	const React = {
		createElement: (type: any, props: any, ...children: any[]) => ({
			type,
			props: {
				...props,
				children: children.length === 1 ? children[0] : children,
			},
		}),
		useRef: (current: any) => ({ current }),
		useEffect(callback: () => () => void) {
			effects.push(callback())
		},
	}
	const native = {
		Animated: {
			View: function AnimatedView() {},
			Value: class Value {
				value: number
				constructor(value: number) {
					this.value = value
					values.push(this)
				}
				setValue(value: number) {
					this.value = value
				}
				stopAnimation() {}
				interpolate(config: any) {
					return { config }
				}
			},
			timing(value: any, config: any) {
				const animation = {
					value,
					config,
					stopped: false,
					start() {},
					stop() {
						this.stopped = true
					},
				}
				animations.push(animation)
				return animation
			},
		},
		Easing: {
			out: (value: any) => value,
			back: (value: any) => value,
			cubic: 'cubic',
		},
		AccessibilityInfo: {
			isReduceMotionEnabled: async () => false,
			addEventListener(_type: string, callback: (value: boolean) => void) {
				reduceListeners.add(callback)
				return { remove: () => reduceListeners.delete(callback) }
			},
		},
		ScrollView: function ScrollView() {},
		// Any regression to global native layout animation fails immediately.
		LayoutAnimation: {
			configureNext() {
				throw new Error('Global LayoutAnimation must not run')
			},
		},
		UIManager: {
			setLayoutAnimationEnabledExperimental() {
				throw new Error('Global layout must not change')
			},
		},
	}
	const revenge: any = {
		patcher,
		modules: {
			finders: {
				filters: {
					withName: (name: string) => ({ name }),
					withProps: (...props: string[]) => ({ props }),
				},
				*lookupModules(filter: any) {
					for (const mod of modules) if (matches(filter, mod)) yield [mod, 1]
				},
				getModules(filter: any, callback: any) {
					for (const mod of modules)
						if (matches(filter, mod)) queueMicrotask(() => callback(mod, 1))
					return () => {}
				},
			},
		},
		discord: {
			common: { flux: { Dispatcher: dispatcher } },
			flux: {
				getStore(name: string, callback: any) {
					if (!options.lazy || available.has(name)) callback(store[name])
					else {
						if (!storesWaiting.has(name)) storesWaiting.set(name, new Set())
						storesWaiting.get(name)!.add(callback)
					}
					return () => storesWaiting.get(name)?.delete(callback)
				},
				onFluxEventDispatched(type: string, callback: any) {
					if (!events.has(type)) events.set(type, new Set())
					events.get(type)!.add(callback)
					return () => events.get(type)!.delete(callback)
				},
			},
			design: { Design: design },
			modules: {
				mainTabsV2: {
					RootNavigationRef: { getRootNavigationRef: () => navigation },
				},
			},
			actions: {
				ActionSheetActionCreators: {
					openLazy: () => 'sheet',
					hideActionSheet() {},
				},
				AlertActionCreators: { openAlert: () => 'alert' },
			},
		},
		react: {
			React,
			ReactNative: native,
			ReactJSXRuntime: { jsx: React.createElement, jsxs: React.createElement },
			jsxRuntime: {
				beforeJSX(type: any, callback: any) {
					if (!jsxHooks.has(type)) jsxHooks.set(type, new Set())
					jsxHooks.get(type)!.add(callback)
					return () => jsxHooks.get(type)!.delete(callback)
				},
			},
		},
		components: { Page: function Page() {} },
	}
	const fetcher = ((input: any, init: any) => {
		const url = new URL(String(input))
		requests.push(url)
		if (options.fetch) return options.fetch(input, init)
		return Promise.resolve(
			new Response(
				JSON.stringify([
					[[url.searchParams.get('tl') + ': ' + url.searchParams.get('q')]],
				]),
			),
		)
	}) as typeof fetch
	const source = readFileSync(
		new URL('../plugins/' + name + '/build/js/index.js', import.meta.url),
		'utf8',
	)
	const plugin = new Function(
		'revenge',
		'plugin',
		'fetch',
		'alert',
		'setTimeout',
		'clearTimeout',
		'return ' + source,
	)(
		revenge,
		(value: any) => value,
		fetcher,
		(text: string) => alerts.push(text),
		(callback: () => void, ms: number) => {
			const timer = setTimeout(
				() => {
					timers.delete(timer)
					callback()
				},
				ms === 12000 ? 80 : ms,
			)
			timers.add(timer)
			return timer
		},
		(timer: ReturnType<typeof setTimeout>) => {
			timers.delete(timer)
			clearTimeout(timer)
		},
	).default
	const api = {
		cleanup: (...callbacks: Array<() => any>) => cleanups.push(...callbacks),
		plugin: {
			startedLate: false,
			requireReload() {
				reloads++
			},
		},
		jsonStorage: {
			cache: { ...plugin.jsonStorage.default },
			async get() {
				return this.cache
			},
			async set(update: any) {
				Object.assign(this.cache, update)
				for (const callback of storageListeners) callback(update)
			},
			use() {
				return this.cache
			},
			subscribe(callback: (update: any) => void) {
				storageListeners.add(callback)
				return () => storageListeners.delete(callback)
			},
		},
	}
	return {
		api,
		revenge,
		messages,
		requests,
		alerts,
		sent,
		dispatched,
		animations,
		values,
		design,
		AppContainer,
		jsx(type: any, props: any, key?: string) {
			let args = [type, props, key]
			for (const callback of jsxHooks.get(type) ?? []) args = callback(args)
			return args
		},
		mountSurface() {
			const [, props] = this.jsx(AppContainer, { children: 'app' })
			props.children.type(props.children.props)
		},
		start: () => plugin.start(api),
		async stop() {
			await plugin.stop?.(api)
			for (const cleanup of cleanups.splice(0)) await cleanup()
		},
		async dispose() {
			await this.stop()
			for (const cleanup of effects.splice(0)) cleanup()
			for (const timer of timers) clearTimeout(timer)
		},
		add(id: string, content: string, channel = 'one', author = 'other') {
			messages.set(key(channel, id), {
				id,
				content,
				channel_id: channel,
				author: { id: author },
			})
		},
		content: (id: string, channel = 'one') =>
			messages.get(key(channel, id))?.content,
		command: (text: string) => action.sendMessage('one', { content: text }),
		dispatch: dispatcher.dispatch,
		publishStore(name: string) {
			available.add(name)
			for (const callback of storesWaiting.get(name) ?? [])
				callback(store[name])
			storesWaiting.delete(name)
		},
		navigation() {
			for (const callback of navigationListeners) callback()
		},
		reduced(value: boolean) {
			for (const callback of reduceListeners) callback(value)
		},
		reloads: () => reloads,
	}
}
