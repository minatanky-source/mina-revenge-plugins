import { afterEach, expect, test } from 'bun:test'
import { flush, runtime } from './runtime'

const sessions: ReturnType<typeof runtime>[] = []

function openMotion() {
	const app = runtime('motion')
	sessions.push(app)
	return app
}

afterEach(async () => {
	for (const session of sessions.splice(0)) await session.dispose()
})

function exposeContextSurfaces(app: ReturnType<typeof runtime>) {
	const LayerScope = function LayerScope() {}
	const ActionSheet = function ActionSheet() {}
	const AlertModal = function AlertModal() {}
	Object.assign(app.design, { LayerScope, ActionSheet, AlertModal })

	const Animated = app.revenge.react.ReactNative.Animated
	Animated.parallel = (animations: any[]) => ({
		start(_callback?: () => void) {
			for (const animation of animations) animation.start()
		},
		stop() {
			for (const animation of animations) animation.stop()
		},
	})

	return { LayerScope, ActionSheet, AlertModal }
}

function mountWrappedChildren(
	app: ReturnType<typeof runtime>,
	component: any,
	children: any = 'content',
) {
	const [, props] = app.jsx(component, { children })
	const surface = props.children
	expect(surface.props.children).toBe(children)
	surface.type(surface.props)
	return surface
}

test('Motion uses public contextual surfaces without patching the app root when LayerScope exists', async () => {
	const app = openMotion()
	const { LayerScope } = exposeContextSurfaces(app)
	const originalCreateElement = app.revenge.react.React.createElement
	await app.start()
	await flush()

	expect(app.revenge.react.React.createElement).toBe(originalCreateElement)
	expect(app.jsx(app.AppContainer, { children: 'app' })[1].children).toBe('app')

	const [, layerProps] = app.jsx(LayerScope, { children: 'screen' })
	expect(layerProps.children.type).not.toBe(LayerScope)
	expect(layerProps.children.props.children).toBe('screen')
})

test('Motion animates the destination LayerScope after navigation with native-driver timings', async () => {
	const app = openMotion()
	const { LayerScope } = exposeContextSurfaces(app)
	await app.start()
	await flush()

	app.navigation()
	expect(app.animations).toHaveLength(0)
	mountWrappedChildren(app, LayerScope, 'settings')

	expect(app.animations).toHaveLength(3)
	for (const animation of app.animations) {
		expect(animation.config).toMatchObject({
			useNativeDriver: true,
			isInteraction: false,
			duration: 205,
		})
	}
})

test('Motion interrupts a channel transition before starting the next one', async () => {
	const app = openMotion()
	const { LayerScope } = exposeContextSurfaces(app)
	await app.start()
	await flush()
	mountWrappedChildren(app, LayerScope, 'chat')
	app.animations.length = 0

	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'two', guildId: 'guild-a' })
	expect(app.animations).toHaveLength(2)
	const first = app.animations.slice()

	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'three', guildId: 'guild-a' })
	expect(app.animations).toHaveLength(4)
	expect(first.every(animation => animation.stopped)).toBe(true)
	expect(app.animations.slice(2).every(animation => !animation.stopped)).toBe(true)
})

test('Motion ignores duplicate channel selections and keeps channel/server switches independent', async () => {
	const app = openMotion()
	const { LayerScope } = exposeContextSurfaces(app)
	await app.start()
	await flush()
	mountWrappedChildren(app, LayerScope, 'chat')
	app.animations.length = 0

	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'two', guildId: 'guild-a' })
	expect(app.animations.at(-1)?.config.duration).toBe(145)
	const afterChannel = app.animations.length
	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'two', guildId: 'guild-a' })
	expect(app.animations).toHaveLength(afterChannel)

	await app.api.jsonStorage.set({ channels: false, guilds: true })
	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'three', guildId: 'guild-a' })
	expect(app.animations).toHaveLength(afterChannel)
	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'four', guildId: 'guild-b' })
	expect(app.animations.at(-1)?.config.duration).toBe(185)
	const afterGuild = app.animations.length

	await app.api.jsonStorage.set({ guilds: false })
	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'five', guildId: 'guild-c' })
	expect(app.animations).toHaveLength(afterGuild)
})

test('Motion animates ActionSheet content locally instead of action-creator calls', async () => {
	const app = openMotion()
	const { ActionSheet } = exposeContextSurfaces(app)
	await app.start()
	await flush()

	expect(app.revenge.discord.actions.ActionSheetActionCreators.openLazy()).toBe('sheet')
	expect(app.animations).toHaveLength(0)
	mountWrappedChildren(app, ActionSheet, 'menu')

	expect(app.animations).toHaveLength(3)
	for (const animation of app.animations)
		expect(animation.config.duration).toBe(190)
})

test('Motion Reduce Motion stops active contextual animations and restores every value', async () => {
	const app = openMotion()
	const { LayerScope } = exposeContextSurfaces(app)
	await app.start()
	await flush()
	mountWrappedChildren(app, LayerScope, 'chat')
	app.animations.length = 0

	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'two', guildId: 'guild-a' })
	const activeAnimations = app.animations.slice()
	app.reduced(true)

	expect(activeAnimations.every(animation => animation.stopped)).toBe(true)
	expect(app.values.slice(-4).map(value => value.value)).toEqual([1, 0, 0, 1])
	expect(app.jsx(app.design.Button, {})[1]).toEqual({})
	const count = app.animations.length
	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'three', guildId: 'guild-a' })
	expect(app.animations).toHaveLength(count)
})

test('Motion reinitialization replaces hooks and listeners instead of multiplying them', async () => {
	const app = openMotion()
	const { LayerScope } = exposeContextSurfaces(app)
	await app.start()
	await flush()
	await app.start()
	await flush()

	const [, props] = app.jsx(LayerScope, { children: 'screen' })
	expect(props.children.props.children).toBe('screen')
	expect(props.children.props.children?.type).toBeUndefined()
	props.children.type(props.children.props)
	app.animations.length = 0

	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'two', guildId: 'guild-a' })
	expect(app.animations).toHaveLength(2)
})

test('Motion stop resets contextual values and removes every active public hook', async () => {
	const app = openMotion()
	const { LayerScope, ActionSheet } = exposeContextSurfaces(app)
	await app.start()
	await flush()
	mountWrappedChildren(app, LayerScope, 'chat')
	app.animations.length = 0
	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'two', guildId: 'guild-a' })

	await app.stop()
	expect(app.values.slice(-4).map(value => value.value)).toEqual([1, 0, 0, 1])
	expect(app.jsx(LayerScope, { children: 'screen' })[1].children).toBe('screen')
	expect(app.jsx(ActionSheet, { children: 'menu' })[1].children).toBe('menu')
	expect(app.jsx(app.design.Button, {})[1]).toEqual({})
	const count = app.animations.length
	app.navigation()
	await app.dispatch({ type: 'CHANNEL_SELECT', channelId: 'three', guildId: 'guild-a' })
	expect(app.animations).toHaveLength(count)
})
