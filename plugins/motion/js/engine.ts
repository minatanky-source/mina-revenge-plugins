import {
  ActionSheetActionCreators,
  AlertActionCreators,
} from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import { RootNavigationRef } from '@revenge-mod/discord/modules/main_tabs_v2'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { before } from '@revenge-mod/patcher'
import { AccessibilityInfo, LayoutAnimation, UIManager } from 'react-native'
import { getSettings, type MotionPreset } from './state'

type Cleanup = (...fns: Array<() => any>) => void
type Scope = 'navigation' | 'channels' | 'sheets'

let systemReduceMotion = false
let lastAnimation = 0

const patchedMethods = new WeakMap<object, Set<string>>()

function presetDuration(preset: MotionPreset) {
  if (preset === 'subtle') return 135
  if (preset === 'bouncy') return 280
  return 205
}

function layoutConfig(preset: MotionPreset): any {
  const duration = presetDuration(preset)

  return {
    duration,
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
      duration: Math.round(duration * 0.72),
    },
    update:
      preset === 'bouncy'
        ? {
            type: LayoutAnimation.Types.spring,
            springDamping: 0.74,
            duration,
          }
        : {
            type: LayoutAnimation.Types.easeInEaseOut,
            duration,
          },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
      duration: Math.round(duration * 0.58),
    },
  }
}

function scopeEnabled(scope: Scope) {
  const settings = getSettings()

  if (!settings.enabled) return false
  if (settings.respectReduceMotion && systemReduceMotion) return false

  return settings[scope]
}

export function animateNext(scope: Scope) {
  if (!scopeEnabled(scope)) return

  const now = Date.now()
  if (now - lastAnimation < 34) return
  lastAnimation = now

  try {
    LayoutAnimation.configureNext(layoutConfig(getSettings().preset))
  } catch (error) {
    console.warn('[Motion] LayoutAnimation failed:', String(error))
  }
}

function patchMethod(
  target: any,
  method: string,
  scope: Scope,
  cleanup: Cleanup,
) {
  if (!target || typeof target[method] !== 'function') return

  let methods = patchedMethods.get(target)
  if (!methods) {
    methods = new Set()
    patchedMethods.set(target, methods)
  }
  if (methods.has(method)) return
  methods.add(method)

  const unpatch = before(target, method as never, () => {
    animateNext(scope)
  })

  cleanup(() => {
    methods?.delete(method)
    unpatch()
  })
}

function patchNavigation(cleanup: Cleanup) {
  const install = () => {
    let navigation: any

    try {
      navigation = RootNavigationRef.getRootNavigationRef()
    } catch {
      return
    }

    for (const method of [
      'navigate',
      'goBack',
      'dispatch',
      'reset',
      'resetRoot',
    ]) {
      patchMethod(navigation, method, 'navigation', cleanup)
    }
  }

  install()

  try {
    const navigation: any = RootNavigationRef.getRootNavigationRef()
    if (!navigation?.isReady?.()) {
      const unsubscribe = navigation?.addListener?.('ready', install)
      if (typeof unsubscribe === 'function') cleanup(unsubscribe)
    }
  } catch {}
}

function patchSheets(cleanup: Cleanup) {
  for (const method of [
    'openLazy',
    'hideActionSheet',
    'hideAllActionSheets',
  ]) {
    patchMethod(ActionSheetActionCreators, method, 'sheets', cleanup)
  }

  for (const method of ['openAlert', 'dismissAlert', 'dismissAlerts']) {
    patchMethod(AlertActionCreators, method, 'sheets', cleanup)
  }
}

function patchChannelActions(cleanup: Cleanup) {
  const names = [
    'transitionToGuild',
    'transitionTo',
    'selectPrivateChannel',
    'selectChannel',
  ]

  for (const name of names) {
    const unsubscribe = getModules(
      withProps(name),
      (exports: any) => {
        patchMethod(exports, name, 'channels', cleanup)
      },
      { max: 24, returnNamespace: true },
    )

    cleanup(unsubscribe)
  }
}

function controlScale(preset: MotionPreset) {
  if (preset === 'subtle') return 2
  if (preset === 'bouncy') return 6
  return 4
}

function patchControl(
  name: 'Button' | 'IconButton' | 'ImageButton',
  cleanup: Cleanup,
) {
  const design: any = Design
  const original = design[name]
  if (!original) return

  const React = revenge.react.React

  function MotionControl(props: any) {
    const settings = getSettings()
    const reduced = settings.respectReduceMotion && systemReduceMotion

    const scaleAmountInPx =
      settings.enabled && settings.controls && !reduced
        ? (props.scaleAmountInPx ?? controlScale(settings.preset))
        : props.scaleAmountInPx

    return React.createElement(original, {
      ...props,
      scaleAmountInPx,
    })
  }

  ;(MotionControl as any).displayName = `Motion${name}`

  try {
    design[name] = MotionControl
    cleanup(() => {
      if (design[name] === MotionControl) design[name] = original
    })
  } catch {}

  const unsubscribe = getModules(
    withProps(name),
    (exports: any) => {
      if (!exports || exports[name] !== original) return

      try {
        exports[name] = MotionControl
        cleanup(() => {
          if (exports[name] === MotionControl) exports[name] = original
        })
      } catch {}
    },
    { max: 100, returnNamespace: true },
  )

  cleanup(unsubscribe)
}

function patchControls(cleanup: Cleanup) {
  patchControl('Button', cleanup)
  patchControl('IconButton', cleanup)
  patchControl('ImageButton', cleanup)
}

function watchReduceMotion(cleanup: Cleanup) {
  try {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        systemReduceMotion = value
      })
      .catch(() => {})

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      value => {
        systemReduceMotion = value
      },
    )

    cleanup(() => subscription.remove())
  } catch {}

  try {
    ;(UIManager as any).setLayoutAnimationEnabledExperimental?.(true)
  } catch {}
}

export function installMotion(cleanup: Cleanup) {
  watchReduceMotion(cleanup)
  patchNavigation(cleanup)
  patchSheets(cleanup)
  patchChannelActions(cleanup)
  patchControls(cleanup)
}
