import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSkyboxPitch } from './panoramaCalibration.ts'

test('normalizeSkyboxPitch rounds a horizon calibration', () => {
  assert.equal(normalizeSkyboxPitch(12.6), 13)
  assert.equal(normalizeSkyboxPitch(-8.4), -8)
})

test('normalizeSkyboxPitch clamps the environment dome to the supported range', () => {
  assert.equal(normalizeSkyboxPitch(90), 45)
  assert.equal(normalizeSkyboxPitch(-90), -45)
})

test('normalizeSkyboxPitch stores the neutral horizon without redundant state', () => {
  assert.equal(normalizeSkyboxPitch(0), undefined)
})
