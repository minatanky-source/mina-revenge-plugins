import { getPreset } from './presets'
import type { MotionEasing, MotionTransitionSpec } from './presets'
import { getSettings } from './state'
import type { MotionPreset } from './state'

type CleanupRegistrar = (...fns: Array<() => unknown>) => void
type MotionScope = 'navigation' | 'channels' | 'guilds' | 'sheets'
type TransitionKind =
	| 'navigation-forward'
	| 'navigation-back'
	| 'channel'
	| 'guild'
	| 'sheet'
type SurfaceRole = 'layer' | 'sheet'

type SurfaceController = {
	role: SurfaceRole
	play(kind: TransitionKind): void
	reset(): void
}

type FallbackController = {
	play(scope: MotionScope): void
	reset(): void
}

type RecentTransition = {
	kind: TransitionKind
	scope: MotionScope
	at: number
}

type NavigationPoint = {
	index: number
	key?: string
}

const REPLAY_WINDOW_MS = 320
const CHANNEL_NAV_DEDUPE_MS = 60

let mountedHosts = 0
let mountedContextSurfaces = 0
let currentEngine: { dispose(): void } | undefined

export function presetDuration(preset: MotionPreset) {
	return getPreset(preset).navigation.forward.duration
}

export function canAnimate(
	scope: MotionScope | 'controls',
	reduced: boolean,
) {
	const settings = getSettings()
	return (
		settings.enabled &&
		settings[scope] &&
		!(settings.respectReduceMotion && reduced)
	)
}

export function motionStatus() {
	if (mountedHosts > 0 || mountedContextSurfaces > 0)
		return 'Animações contextuais prontas.'
	return 'Reinicie o Discord para conectar o Motion às superfícies abertas.'
}

function once(fn: () => unknown) {
	let done = false
	return () => {
		if (done) return
		done = true
		return fn()
	}
}

function navigationPath(state: any): NavigationPoint[] {
	const path: NavigationPoint[] = []
	let current = state
	let guard = 0
	while (current?.routes?.length && guard++ < 32) {
		const index =
			typeof current.index === 'number'
				? current.index
				: current.routes.length - 1
		const route = current.routes[index]
		path.push({ index, key: route?.key })
		current = route?.state
	}
	return path
}

function navigationSignature(path: NavigationPoint[]) {
	return path.map(point => `${point.index}:${point.key ?? ''}`).join('/')
}

function navigationDirection(
	previous: NavigationPoint[] | undefined,
	next: NavigationPoint[],
): 'forward' | 'back' {
	if (!previous?.length) return 'forward'
	const shared = Math.min(previous.length, next.length)
	for (let index = 0; index < shared; index++) {
		if (previous[index].index !== next[index].index)
			return next[index].index < previous[index].index ? 'back' : 'forward'
		if (previous[index].key !== next[index].key) {
			if (next.length < previous.length) return 'back'
			return 'forward'
		}
	}
	return next.length < previous.length ? 'back' : 'forward'
}

export function installMotion(cleanup: CleanupRegistrar) {
	currentEngine?.dispose()

	const { React, ReactNative: RN, jsxRuntime } = revenge.react
	const { lookupModules, getModules } = revenge.modules.finders
	const { withName } = revenge.modules.finders.filters
	const { before, after } = revenge.patcher
	const { Animated, Easing, AccessibilityInfo } = RN
	const { Design } = revenge.discord.design

	let active = true
	let reduced = true
	let reduceRevision = 0
	let recentTransition: RecentTransition | undefined
	let fallbackSurface: FallbackController | undefined
	let lastContentTransitionAt = -Infinity
	let lastContentTransitionScope: MotionScope | undefined
	let channelId: string | undefined
	let guildId: string | null | undefined
	let channelStore: any
	let navigationSnapshot: NavigationPoint[] | undefined
	let navigationSnapshotSignature = ''
	const contextSurfaces = new Set<SurfaceController>()
	const layerSurfaces: SurfaceController[] = []
	const containers = new WeakSet<object>()
	const patchedContainers = new WeakSet<object>()
	const attachedNavigation = new WeakSet<object>()
	const localCleanups: Array<() => unknown> = []

	const addCleanup = (fn: () => unknown) => {
		const safe = once(fn)
		localCleanups.push(safe)
		cleanup(safe)
		return safe
	}

	function easing(value: MotionEasing) {
		return Easing.out(
			value.kind === 'back'
				? Easing.back(value.overshoot)
				: Easing.cubic,
		)
	}

	function transitionSpec(kind: TransitionKind): MotionTransitionSpec {
		const preset = getPreset(getSettings().preset)
		switch (kind) {
			case 'navigation-back':
				return preset.navigation.back
			case 'navigation-forward':
				return preset.navigation.forward
			case 'channel':
				return preset.channel
			case 'guild':
				return preset.guild
			case 'sheet':
				return preset.sheet
		}
	}

	function resetAll() {
		fallbackSurface?.reset()
		for (const surface of contextSurfaces) surface.reset()
	}

	function acceptedBy(role: SurfaceRole, kind: TransitionKind) {
		return role === 'sheet' ? kind === 'sheet' : kind !== 'sheet'
	}

	function latestLayer() {
		return layerSurfaces[layerSurfaces.length - 1]
	}

	function trigger(scope: MotionScope, kind: TransitionKind) {
		if (!active || !canAnimate(scope, reduced)) return

		const now = Date.now()
		if (
			scope === 'navigation' &&
			(lastContentTransitionScope === 'channels' ||
				lastContentTransitionScope === 'guilds') &&
			now - lastContentTransitionAt < CHANNEL_NAV_DEDUPE_MS
		)
			return

		if (scope === 'navigation') {
			// A navigation event usually precedes mounting the destination LayerScope.
			// Do not animate the outgoing screen; let the freshly mounted destination
			// consume this transition once.
			recentTransition = { kind, scope, at: now }
			if (!Design.LayerScope) fallbackSurface?.play(scope)
			return
		}

		if (scope === 'channels' || scope === 'guilds') {
			lastContentTransitionAt = now
			lastContentTransitionScope = scope
			const layer = latestLayer()
			if (layer) {
				recentTransition = undefined
				layer.play(kind)
				return
			}
			// A channel selection can also mount the screen for the first time. Keep a
			// short replay window so that surface receives the event without a timer.
			recentTransition = { kind, scope, at: now }
			fallbackSurface?.play(scope)
			return
		}

		// Public ActionSheet/AlertModal surfaces animate themselves when they mount.
		// This path is only used by the compatibility fallback below.
		recentTransition = { kind, scope, at: now }
		fallbackSurface?.play(scope)
	}

	function ContextSurface({
		children,
		role,
	}: {
		children?: any
		role: SurfaceRole
	}) {
		const opacityRef = React.useRef<any>(null)
		const translateXRef = React.useRef<any>(null)
		const translateYRef = React.useRef<any>(null)
		const scaleRef = React.useRef<any>(null)
		const animationRef = React.useRef<any>(null)
		const controllerRef = React.useRef<SurfaceController | null>(null)

		if (!opacityRef.current) opacityRef.current = new Animated.Value(1)
		if (!translateXRef.current) translateXRef.current = new Animated.Value(0)
		if (!translateYRef.current) translateYRef.current = new Animated.Value(0)
		if (!scaleRef.current) scaleRef.current = new Animated.Value(1)

		if (!controllerRef.current) {
			const values = [
				opacityRef.current,
				translateXRef.current,
				translateYRef.current,
				scaleRef.current,
			]
			const reset = () => {
				animationRef.current?.stop()
				animationRef.current = null
				for (const value of values) value.stopAnimation()
				opacityRef.current.setValue(1)
				translateXRef.current.setValue(0)
				translateYRef.current.setValue(0)
				scaleRef.current.setValue(1)
			}
			controllerRef.current = {
				role,
				reset,
				play(kind) {
					if (!acceptedBy(role, kind)) return
					const scope: MotionScope =
						kind === 'sheet'
							? 'sheets'
							: kind === 'channel'
								? 'channels'
								: kind === 'guild'
									? 'guilds'
									: 'navigation'
					if (!active || !canAnimate(scope, reduced)) {
						reset()
						return
					}
					reset()
					const spec = transitionSpec(kind)
					opacityRef.current.setValue(spec.opacity)
					translateXRef.current.setValue(spec.translateX)
					translateYRef.current.setValue(spec.translateY)
					scaleRef.current.setValue(spec.scale)
					const config = {
						duration: spec.duration,
						easing: easing(spec.easing),
						useNativeDriver: true,
						isInteraction: false,
					}
					const animations = [
						Animated.timing(opacityRef.current, { ...config, toValue: 1 }),
					]
					if (spec.translateX !== 0)
						animations.push(
							Animated.timing(translateXRef.current, {
								...config,
								toValue: 0,
							}),
						)
					if (spec.translateY !== 0)
						animations.push(
							Animated.timing(translateYRef.current, {
								...config,
								toValue: 0,
							}),
						)
					if (spec.scale !== 1)
						animations.push(
							Animated.timing(scaleRef.current, { ...config, toValue: 1 }),
						)
					const animation =
						animations.length === 1
							? animations[0]
							: Animated.parallel(animations, { stopTogether: true })
					animationRef.current = animation
					animation.start(() => {
						if (animationRef.current === animation)
							animationRef.current = null
					})
				},
			}
		}

		React.useEffect(() => {
			const controller = controllerRef.current!
			contextSurfaces.add(controller)
			if (role === 'layer') layerSurfaces.push(controller)
			mountedContextSurfaces++

			if (role === 'sheet') {
				controller.play('sheet')
			} else if (
				recentTransition &&
				recentTransition.kind !== 'sheet' &&
				Date.now() - recentTransition.at <= REPLAY_WINDOW_MS
			) {
				const transition = recentTransition
				recentTransition = undefined
				controller.play(transition.kind)
			}

			return () => {
				controller.reset()
				contextSurfaces.delete(controller)
				if (role === 'layer') {
					const index = layerSurfaces.lastIndexOf(controller)
					if (index >= 0) layerSurfaces.splice(index, 1)
				}
				mountedContextSurfaces--
			}
		}, [])

		return React.createElement(
			Animated.View,
			{
				pointerEvents: 'box-none',
				style: [
					role === 'layer' ? { flex: 1 } : null,
					{
						opacity: opacityRef.current,
						transform: [
							{ translateX: translateXRef.current },
							{ translateY: translateYRef.current },
							{ scale: scaleRef.current },
						],
					},
				],
			},
			children,
		)
	}

	function MotionHost({ children }: { children: any }) {
		const progressRef = React.useRef<any>(null)
		const animationRef = React.useRef<any>(null)
		if (!progressRef.current) progressRef.current = new Animated.Value(1)

		React.useEffect(() => {
			const value = progressRef.current
			const reset = () => {
				animationRef.current?.stop()
				animationRef.current = null
				value.stopAnimation()
				value.setValue(1)
			}
			const controller: FallbackController = {
				reset,
				play(scope) {
					if (!active || !canAnimate(scope, reduced)) return
					reset()
					value.setValue(0)
					const preset = getPreset(getSettings().preset)
					const spec =
						scope === 'navigation'
							? preset.navigation.forward
							: scope === 'channels'
								? preset.channel
								: scope === 'guilds'
									? preset.guild
									: preset.sheet
					const animation = Animated.timing(value, {
						toValue: 1,
						duration: spec.duration,
						easing: easing(spec.easing),
						useNativeDriver: true,
						isInteraction: false,
					})
					animationRef.current = animation
					animation.start(() => {
						if (animationRef.current === animation)
							animationRef.current = null
					})
				},
			}
			fallbackSurface = controller
			mountedHosts++
			return () => {
				reset()
				if (fallbackSurface === controller) fallbackSurface = undefined
				mountedHosts--
			}
		}, [])

		return React.createElement(
			Animated.View,
			{ style: { flex: 1 }, pointerEvents: 'box-none' },
			children,
			React.createElement(Animated.View, {
				pointerEvents: 'none',
				style: {
					position: 'absolute',
					top: 0,
					right: 0,
					bottom: 0,
					width: 10,
					backgroundColor: 'rgba(88, 101, 242, 0.18)',
					opacity: progressRef.current.interpolate({
						inputRange: [0, 1],
						outputRange: [0.22, 0],
						extrapolate: 'clamp',
					}),
					transform: [
						{
							translateX: progressRef.current.interpolate({
								inputRange: [0, 1],
								outputRange: [-8, 10],
								extrapolate: 'clamp',
							}),
						},
					],
				},
			}),
		)
	}

	function wrapChildren(args: any, role: SurfaceRole): any {
		const props = args[1] ?? {}
		if (props.children?.type === ContextSurface) return args
		return [
			args[0],
			{
				...props,
				children: React.createElement(
					ContextSurface,
					{ role },
					props.children,
				),
			},
			args[2],
		]
	}

	if (Design.LayerScope) {
		addCleanup(
			jsxRuntime.beforeJSX(Design.LayerScope, args => {
				if (!active) return args
				return wrapChildren(args, 'layer')
			}),
		)
	}

	if (Design.ActionSheet) {
		addCleanup(
			jsxRuntime.beforeJSX(Design.ActionSheet, args => {
				if (!active) return args
				return wrapChildren(args, 'sheet')
			}),
		)
	}

	if (Design.AlertModal) {
		addCleanup(
			jsxRuntime.beforeJSX(Design.AlertModal, args => {
				if (!active || args[1]?.content == null) return args
				const content: any = args[1].content
				if (typeof content !== 'object' || content?.type === ContextSurface)
					return args
				return [
					args[0],
					{
						...args[1],
						content: React.createElement(
							ContextSurface,
							{ role: 'sheet' },
							content,
						),
					},
					args[2],
				] as typeof args
			}),
		)
	}

	if (!Design.LayerScope) {
		function attachContainer(component: any) {
			if (!active || !component || patchedContainers.has(component)) return
			patchedContainers.add(component)
			containers.add(component)
			addCleanup(
				jsxRuntime.beforeJSX(component, args => {
					if (!active) return args
					if (args[1]?.children?.type === MotionHost) return args
					return [
						args[0],
						{
							...args[1],
							children: React.createElement(
								MotionHost,
								null,
								args[1]?.children,
							),
						},
						args[2],
					]
				}),
			)
		}

		// AppContainer is only a lightweight fallback host now. It never applies
		// opacity/scale/translation to the app tree. Keep this synchronous so a normal
		// startup installs the fallback before React creates the root.
		const containerFilter = withName('AppContainer')
		for (const [component] of lookupModules(containerFilter, { initialize: false }))
			attachContainer(component)
		addCleanup(getModules(containerFilter, attachContainer, { max: 4 }))

		// React Native can still create AppContainer through the classic JSX runtime.
		// This global hook is deliberately restricted to the exact AppContainer
		// identities discovered above; every other createElement call is untouched.
		addCleanup(
			before(React, 'createElement', (args: any[]) => {
				if (!active || !containers.has(args[0])) return args
				const children = args.length > 2 ? args.slice(2) : [args[1]?.children]
				if (children.length === 1 && children[0]?.type === MotionHost) return args
				return [
					args[0],
					args[1],
					React.createElement(MotionHost, null, ...children),
				]
			}),
		)
	}

	const updateReduced = (value: boolean) => {
		reduceRevision++
		if (!active) return
		reduced = value
		if (value && getSettings().respectReduceMotion) resetAll()
	}
	const revision = reduceRevision
	void AccessibilityInfo.isReduceMotionEnabled()
		.then(value => {
			if (active && revision === reduceRevision) updateReduced(value)
		})
		.catch(() => {})
	const accessibility = AccessibilityInfo.addEventListener(
		'reduceMotionChanged',
		updateReduced,
	)
	addCleanup(() => accessibility.remove())

	for (const name of ['Button', 'IconButton', 'ImageButton'] as const) {
		const component = Design[name]
		if (!component) continue
		addCleanup(
			jsxRuntime.beforeJSX(component, args => {
				if (
					!active ||
					!canAnimate('controls', reduced) ||
					args[1]?.disabled ||
					args[1]?.loading ||
					args[1]?.scaleAmountInPx != null
				)
					return args
				const preset = getPreset(getSettings().preset)
				return [
					args[0],
					{
						...args[1],
						scaleAmountInPx: preset.press.scaleAmountInPx,
					},
					args[2],
				]
			}),
		)
	}

	function readNavigation(nav: any) {
		try {
			const state = nav.getRootState?.() ?? nav.getState?.()
			return state ? navigationPath(state) : undefined
		} catch {
			return undefined
		}
	}

	function attachNavigation(nav: any) {
		if (
			!active ||
			!nav ||
			typeof nav.addListener !== 'function' ||
			attachedNavigation.has(nav)
		)
			return
		attachedNavigation.add(nav)
		navigationSnapshot = readNavigation(nav)
		navigationSnapshotSignature = navigationSnapshot
			? navigationSignature(navigationSnapshot)
			: ''
		const unsubscribe = nav.addListener('state', () => {
			const next = readNavigation(nav)
			if (!next) {
				trigger('navigation', 'navigation-forward')
				return
			}
			const signature = navigationSignature(next)
			if (signature === navigationSnapshotSignature) return
			const direction = navigationDirection(navigationSnapshot, next)
			navigationSnapshot = next
			navigationSnapshotSignature = signature
			trigger(
				'navigation',
				direction === 'back'
					? 'navigation-back'
					: 'navigation-forward',
			)
		})
		if (typeof unsubscribe === 'function') addCleanup(unsubscribe)
	}

	const { RootNavigationRef } = revenge.discord.modules.mainTabsV2
	attachNavigation(RootNavigationRef.getRootNavigationRef())
	addCleanup(
		after(RootNavigationRef, 'getRootNavigationRef', (nav: any) => {
			attachNavigation(nav)
			return nav
		}),
	)

	addCleanup(
		revenge.discord.flux.getStore('ChannelStore', (store: any) => {
			channelStore = store
			if (channelId) {
				const channel = channelStore?.getChannel?.(channelId)
				guildId = channel?.guild_id ?? null
			}
		}),
	)

	addCleanup(
		revenge.discord.flux.onFluxEventDispatched(
			'CHANNEL_SELECT',
			(payload: any) => {
				const nextChannelId = payload?.channelId
				if (!nextChannelId || nextChannelId === channelId) return payload

				const channel = channelStore?.getChannel?.(nextChannelId)
				const nextGuildId =
					payload?.guildId !== undefined
						? (payload.guildId ?? null)
						: channel
							? (channel.guild_id ?? null)
							: undefined
				const guildChanged =
					guildId !== undefined &&
					nextGuildId !== undefined &&
					nextGuildId !== guildId

				channelId = nextChannelId
				if (nextGuildId !== undefined) guildId = nextGuildId

				trigger(
					guildChanged ? 'guilds' : 'channels',
					guildChanged ? 'guild' : 'channel',
				)
				return payload
			},
		),
	)

	// Older Discord builds or stripped test runtimes may not expose the public
	// surfaces. In that case only, preserve a lightweight fallback trigger.
	if (!Design.ActionSheet) {
		const actions = revenge.discord.actions.ActionSheetActionCreators
		if (typeof actions?.openLazy === 'function')
			addCleanup(
				after(actions, 'openLazy', (result: any) => {
					trigger('sheets', 'sheet')
					return result
				}),
			)
	}
	if (!Design.AlertModal) {
		const actions = revenge.discord.actions.AlertActionCreators
		if (typeof actions?.openAlert === 'function')
			addCleanup(
				after(actions, 'openAlert', (result: any) => {
					trigger('sheets', 'sheet')
					return result
				}),
			)
	}

	const dispose = once(() => {
		active = false
		resetAll()
		for (const fn of localCleanups.splice(0).reverse()) fn()
		contextSurfaces.clear()
		layerSurfaces.length = 0
		fallbackSurface = undefined
		channelStore = undefined
		recentTransition = undefined
		if (currentEngine?.dispose === dispose) currentEngine = undefined
	})
	cleanup(dispose)
	currentEngine = { dispose }

	return () => {
		if (!active) return
		resetAll()
		if (
			!getSettings().enabled ||
			(getSettings().respectReduceMotion && reduced)
		)
			return
	}
}
