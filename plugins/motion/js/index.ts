import { installMotion } from './engine'
import { DEFAULTS, setStorage } from './state'
import { SettingsComponent } from './ui'
import type { MotionSettings } from './state'

export default plugin<{ jsonStorage: MotionSettings }>({
	jsonStorage: { default: DEFAULTS, load: true },
	start(api) {
		setStorage(api.jsonStorage)
		const reset = installMotion(api.cleanup)
		api.cleanup(api.jsonStorage.subscribe(reset))
		if (api.plugin.startedLate) api.plugin.requireReload()
		return api.jsonStorage.get()
	},
	stop() {
		setStorage(undefined)
	},
	SettingsComponent,
})
