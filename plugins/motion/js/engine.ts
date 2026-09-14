import { getSettings } from './state'
import type { MotionPreset } from './state'

type Cleanup = (...fns: Array<() => unknown>) => void
type Scope = 'navigation' | 'channels' | 'sheets'

export function presetDuration(preset: MotionPreset) {
	return preset === 'subtle' ? 135 : preset === 'bouncy' ? 280 : 205
}

export function canAnimate(scope: Scope | 'controls', reduced: boolean) {
	const settings = getSettings()
	return (
		settings.enabled &&
		settings[scope] &&
		!(settings.respectReduceMotion && reduced)
	)
}

let mountedSurfaces = 0
export function motionStatus() {
	return mountedSurfaces > 0
		? 'Transições prontas. Troque de canal para experimentar.'
		: 'Reinicie o Discord para aplicar as transições à tela principal.'
}

export function installMotion(cleanup: Cleanup) {
	const { React, ReactNative: RN, jsxRuntime } = revenge.react
	const { lookupModules, getModules } = revenge.modules.finders
	const { withName } = revenge.modules.finders.filters
	const { before, after } = revenge.patcher
	const { Animated, Easing, AccessibilityInfo } = RN
	let active = true
	let reduced = true
	let reduceRevision = 0
	let lastAnimation = -Infinity
	const surfaces = new Set<{ play(): void; reset(): void }>()
	const patched = new WeakSet<object>()
	const containers = new WeakSet<object>()
	const methods = new WeakMap<object, Set<string>>()

	function reset() {
		for (const surface of surfaces) surface.reset()
	}

	function animate(scope: Scope) {
		if (!active || !canAnimate(scope, reduced)) return
		const now = Date.now()
		if (now - lastAnimation < 80) return
		lastAnimation = now
		for (const surface of surfaces) surface.play()
	}

	// Animate only opacity and transform. Do not schedule global native layout changes.
	function MotionSurface({ children }: { children: any }) {
		const progress = React.useRef<any>(null)
		if (!progress.current) progress.current = new Animated.Value(1)
		React.useEffect(() => {
			const value = progress.current
			let animation: ReturnType<typeof Animated.timing> | undefined
			const resetSurface = () => {
				animation?.stop()
				animation = undefined
				value.stopAnimation()
				value.setValue(1)
			}
			const surface = {
				reset: resetSurface,
				play() {
					resetSurface()
					value.setValue(0)
					const preset = getSettings().preset
					animation = Animated.timing(value, {
						toValue: 1,
						duration: presetDuration(preset),
						easing:
							preset === 'bouncy'
								? Easing.out(Easing.back(1.1))
								: Easing.out(Easing.cubic),
						useNativeDriver: true,
						isInteraction: false,
					})
					animation.start()
				},
			}
			surfaces.add(surface)
			mountedSurfaces++
			return () => {
				resetSurface()
				surfaces.delete(surface)
				mountedSurfaces--
			}
		}, [])
		return React.createElement(
			Animated.View,
			{
				style: {
					flex: 1,
					opacity: progress.current.interpolate({
						inputRange: [0, 1],
						outputRange: [0.88, 1],
						extrapolate: 'clamp',
					}),
					transform: [
						{
							scale: progress.current.interpolate({
								inputRange: [0, 1],
								outputRange: [0.995, 1],
							}),
						},
					],
				},
				pointerEvents: 'box-none',
			},
			children,
		)
	}

	function attachContainer(component: any) {
		if (!active || !component || patched.has(component)) return
		patched.add(component)
		containers.add(component)
		cleanup(
			jsxRuntime.beforeJSX(component, args => {
				if (!active) return args
				return [
					args[0],
					{
						...args[1],
						children: React.createElement(
							MotionSurface,
							null,
							args[1].children,
						),
					},
					args[2],
				]
			}),
		)
	}

	// start() runs before AppRegistry renders. Install this synchronously, before awaiting storage.
	const containerFilter = withName('AppContainer')
	for (const [component] of lookupModules(containerFilter, {
		initialize: false,
	})) {
		attachContainer(component)
	}
	cleanup(getModules(containerFilter, attachContainer, { max: 4 }))

	// React Native can compile its own root with the classic JSX runtime.
	cleanup(
		before(React, 'createElement', (args: any[]) => {
			if (!active || !containers.has(args[0])) return args
			const children = args.length > 2 ? args.slice(2) : [args[1]?.children]
			if (children.length === 1 && children[0]?.type === MotionSurface)
				return args
			return [
				args[0],
				args[1],
				React.createElement(MotionSurface, null, ...children),
			]
		}),
	)

	function patchMethod(target: any, method: string, scope: Scope) {
		if (!target || typeof target[method] !== 'function') return
		let seen = methods.get(target)
		if (!seen) methods.set(target, (seen = new Set()))
		if (seen.has(method)) return
		seen.add(method)
		cleanup(
			after(target, method, (result: any) => {
				animate(scope)
				return result
			}),
		)
	}

	const updateReduced = (value: boolean) => {
		reduceRevision++
		if (!active) return
		reduced = value
		if (value && getSettings().respectReduceMotion) reset()
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
	cleanup(() => accessibility.remove())

	const { Design } = revenge.discord.design
	for (const name of ['Button', 'IconButton', 'ImageButton'] as const) {
		const component = Design[name]
		if (!component) continue
		// JSX hooks preserve component identity, refs, getters, and other plugins' patches.
		cleanup(
			jsxRuntime.beforeJSX(component, args => {
				if (
					!active ||
					!canAnimate('controls', reduced) ||
					args[1].disabled ||
					args[1].loading
				)
					return args
				const preset = getSettings().preset
				return [
					args[0],
					{
						...args[1],
						scaleAmountInPx:
							preset === 'subtle' ? 2 : preset === 'bouncy' ? 6 : 4,
					},
					args[2],
				]
			}),
		)
	}

	const { ActionSheetActionCreators, AlertActionCreators } =
		revenge.discord.actions
	for (const name of ['openLazy', 'hideActionSheet', 'hideAllActionSheets']) {
		patchMethod(ActionSheetActionCreators, name, 'sheets')
	}
	for (const name of ['openAlert', 'dismissAlert', 'dismissAlerts']) {
		patchMethod(AlertActionCreators, name, 'sheets')
	}

	function attachNavigation(nav: any) {
		if (!active || !nav) return
		if (typeof nav.addListener !== 'function' || patched.has(nav)) return
		patched.add(nav)
		const unsubscribe = nav.addListener('state', () => animate('navigation'))
		if (typeof unsubscribe === 'function') cleanup(unsubscribe)
	}
	const { RootNavigationRef } = revenge.discord.modules.mainTabsV2
	attachNavigation(RootNavigationRef.getRootNavigationRef())
	// Also handle a navigation ref created after this plugin starts.
	cleanup(
		after(RootNavigationRef, 'getRootNavigationRef', (nav: any) => {
			attachNavigation(nav)
			return nav
		}),
	)
	let channel: string | undefined
	cleanup(
		revenge.discord.flux.onFluxEventDispatched(
			'CHANNEL_SELECT',
			(payload: any) => {
				if (payload.channelId !== channel) {
					channel = payload.channelId
					animate('channels')
				}
				return payload
			},
		),
	)
	cleanup(() => {
		active = false
		reset()
		surfaces.clear()
	})
	return reset
}
