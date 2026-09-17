import type { MotionPreset } from './state'

export type MotionEasing =
	| { kind: 'cubic' }
	| { kind: 'back'; overshoot: number }

export interface MotionTransitionSpec {
	duration: number
	opacity: number
	translateX: number
	translateY: number
	scale: number
	easing: MotionEasing
}

export interface MotionPresetConfig {
	navigation: {
		forward: MotionTransitionSpec
		back: MotionTransitionSpec
	}
	channel: MotionTransitionSpec
	guild: MotionTransitionSpec
	sheet: MotionTransitionSpec
	fallback: {
		duration: number
		easing: MotionEasing
	}
	press: {
		scaleAmountInPx: number
	}
}

const cubic = { kind: 'cubic' } as const
const back = (overshoot: number) => ({ kind: 'back', overshoot }) as const

export const PRESETS: Record<MotionPreset, MotionPresetConfig> = {
	subtle: {
		navigation: {
			forward: {
				duration: 135,
				opacity: 0.98,
				translateX: 5,
				translateY: 0,
				scale: 1,
				easing: cubic,
			},
			back: {
				duration: 125,
				opacity: 0.98,
				translateX: -4,
				translateY: 0,
				scale: 1,
				easing: cubic,
			},
		},
		channel: {
			duration: 105,
			opacity: 0.985,
			translateX: 0,
			translateY: 3,
			scale: 1,
			easing: cubic,
		},
		guild: {
			duration: 140,
			opacity: 0.975,
			translateX: 6,
			translateY: 0,
			scale: 0.998,
			easing: cubic,
		},
		sheet: {
			duration: 145,
			opacity: 0.97,
			translateX: 0,
			translateY: 10,
			scale: 0.995,
			easing: cubic,
		},
		fallback: { duration: 135, easing: cubic },
		press: { scaleAmountInPx: 2 },
	},
	smooth: {
		navigation: {
			forward: {
				duration: 205,
				opacity: 0.955,
				translateX: 14,
				translateY: 0,
				scale: 0.998,
				easing: cubic,
			},
			back: {
				duration: 185,
				opacity: 0.96,
				translateX: -10,
				translateY: 0,
				scale: 0.999,
				easing: cubic,
			},
		},
		channel: {
			duration: 145,
			opacity: 0.97,
			translateX: 0,
			translateY: 5,
			scale: 1,
			easing: cubic,
		},
		guild: {
			duration: 185,
			opacity: 0.95,
			translateX: 10,
			translateY: 0,
			scale: 0.996,
			easing: cubic,
		},
		sheet: {
			duration: 190,
			opacity: 0.94,
			translateX: 0,
			translateY: 16,
			scale: 0.985,
			easing: cubic,
		},
		fallback: { duration: 205, easing: cubic },
		press: { scaleAmountInPx: 4 },
	},
	bouncy: {
		navigation: {
			forward: {
				duration: 280,
				opacity: 0.94,
				translateX: 16,
				translateY: 0,
				scale: 0.995,
				easing: back(1.06),
			},
			back: {
				duration: 250,
				opacity: 0.95,
				translateX: -13,
				translateY: 0,
				scale: 0.996,
				easing: back(1.04),
			},
		},
		channel: {
			duration: 175,
			opacity: 0.965,
			translateX: 0,
			translateY: 6,
			scale: 0.998,
			easing: back(1.025),
		},
		guild: {
			duration: 235,
			opacity: 0.94,
			translateX: 13,
			translateY: 0,
			scale: 0.992,
			easing: back(1.08),
		},
		sheet: {
			duration: 245,
			opacity: 0.93,
			translateX: 0,
			translateY: 18,
			scale: 0.98,
			easing: back(1.08),
		},
		fallback: { duration: 280, easing: back(1.05) },
		press: { scaleAmountInPx: 6 },
	},
}

export function getPreset(preset: MotionPreset) {
	return PRESETS[preset]
}
