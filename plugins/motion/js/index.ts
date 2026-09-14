import { installMotion } from './engine'
import { DEFAULTS, setStorage, type MotionSettings } from './state'
import { SettingsComponent } from './ui'

export default plugin<{ jsonStorage: MotionSettings }>({
  jsonStorage: {
    default: DEFAULTS,
    load: true,
  },

  async start(api) {
    setStorage(api.jsonStorage)
    await api.jsonStorage.get()

    installMotion(api.cleanup)

    console.log('[Motion] started')
  },

  stop() {
    setStorage(undefined)
    console.log('[Motion] stopped')
  },

  SettingsComponent,
})
