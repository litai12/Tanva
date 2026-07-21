import type { CharacterObj } from '../types'

export type ResolvedTrajectoryMotion = Required<NonNullable<CharacterObj['trajectoryMotion']>>

export const DEFAULT_TRAJECTORY_MOTION: ResolvedTrajectoryMotion = {
  autoGait: true,
  walkSpeed: 1.4,
  runSpeed: 3.2,
  runThreshold: 2.2,
  minPlaybackRate: 0.25,
  maxPlaybackRate: 3,
  ikEnabled: true,
  ikWeight: 1,
  footLockEnabled: true,
  footLockDistance: 0.055,
  footReleaseDistance: 0.14,
  soleOffset: 0.01,
  rootSlopeWeight: 1,
  footSlopeWeight: 1,
}

export function resolveTrajectoryMotion(value?: CharacterObj['trajectoryMotion']): ResolvedTrajectoryMotion {
  return { ...DEFAULT_TRAJECTORY_MOTION, ...(value ?? {}) }
}

export function resolveTrajectoryGait(speedMps: number, value?: CharacterObj['trajectoryMotion']): {
  clip?: 'walk' | 'run'
  playbackRate: number
} {
  const config = resolveTrajectoryMotion(value)
  if (!config.autoGait || speedMps < 0.05) return { playbackRate: 1 }
  const clip = speedMps > config.runThreshold ? 'run' : 'walk'
  const nominalSpeed = clip === 'run' ? config.runSpeed : config.walkSpeed
  const rawRate = nominalSpeed > 1e-9 ? speedMps / nominalSpeed : 1
  return { clip, playbackRate: Math.max(config.minPlaybackRate, Math.min(config.maxPlaybackRate, rawRate)) }
}
