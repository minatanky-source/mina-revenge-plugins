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

    console.warn(
      '[Motion] Runtime effects are temporarily disabled in 0.1.1 for stability.',
    )
  },

  stop() {
    setStorage(undefined)
  },

  SettingsComponent,
})
