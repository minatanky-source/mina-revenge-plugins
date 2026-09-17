import { installMotion } from './engine'
import { DEFAULTS, setStorage } from './state'
import { SettingsComponent } from './ui'
import type { MotionSettings } from './state'

let activeStorageUnsubscribe: (() => unknown) | undefined

export default plugin<{ jsonStorage: MotionSettings }>({
	jsonStorage: { default: DEFAULTS, load: true },
	start(api) {
		activeStorageUnsubscribe?.()
		setStorage(api.jsonStorage)

		const settingsChanged = installMotion(api.cleanup)
		const unsubscribe = api.jsonStorage.subscribe(settingsChanged)
		activeStorageUnsubscribe = unsubscribe
		api.cleanup(() => {
			if (activeStorageUnsubscribe === unsubscribe)
				activeStorageUnsubscribe = undefined
			unsubscribe()
		})

		if (api.plugin.startedLate) api.plugin.requireReload()
		return api.jsonStorage.get()
	},
	stop() {
		activeStorageUnsubscribe?.()
		activeStorageUnsubscribe = undefined
		setStorage(undefined)
	},
	SettingsComponent,
})
