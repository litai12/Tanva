export const MIN_SKYBOX_PITCH_DEG = -45
export const MAX_SKYBOX_PITCH_DEG = 45

export function normalizeSkyboxPitch(pitchDeg: number): number | undefined {
  const pitch = Math.max(MIN_SKYBOX_PITCH_DEG, Math.min(MAX_SKYBOX_PITCH_DEG, Math.round(pitchDeg)))
  return pitch || undefined
}
