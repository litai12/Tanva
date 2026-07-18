import * as THREE from 'three'
import type { CharacterObj, Vec3 } from '../types'
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy'

const SPLAT_BYTES = 32
const CELL_SIZE = 0.25
const SEARCH_RINGS = 4
const MAX_SAMPLES = 600_000

type HeightCell = { values: number[] }
type GaussianSurface = { cells: Map<string, HeightCell>; ready: boolean }

const surfaces = new Map<string, GaussianSurface>()
const loading = new Map<string, Promise<void>>()

const key = (x: number, z: number) => `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`

function objectMatrix(character: Pick<CharacterObj, 'position' | 'rotation' | 'scale' | 'uniformScale'>): THREE.Matrix4 {
  const scale = new THREE.Vector3(
    character.scale[0] * character.uniformScale,
    character.scale[1] * character.uniformScale,
    character.scale[2] * character.uniformScale,
  )
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...character.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...character.rotation)),
    scale,
  )
}

function buildHeightCells(buffer: ArrayBuffer, matrix: THREE.Matrix4): Map<string, HeightCell> {
  const count = Math.floor(buffer.byteLength / SPLAT_BYTES)
  if (!count) throw new Error('Gaussian ground contains no splats')
  const stride = Math.max(1, Math.ceil(count / MAX_SAMPLES))
  const view = new DataView(buffer)
  const point = new THREE.Vector3()
  const cells = new Map<string, HeightCell>()
  for (let index = 0; index < count; index += stride) {
    const offset = index * SPLAT_BYTES
    const x = view.getFloat32(offset, true)
    const y = view.getFloat32(offset + 4, true)
    const z = view.getFloat32(offset + 8, true)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    point.set(x, y, z).applyMatrix4(matrix)
    const cellKey = key(point.x, point.z)
    const cell = cells.get(cellKey) ?? { values: [] }
    if (cell.values.length < 24) cell.values.push(point.y)
    else cell.values[index % cell.values.length] = point.y
    cells.set(cellKey, cell)
  }
  for (const cell of cells.values()) cell.values.sort((a, b) => a - b)
  return cells
}

/**
 * 标准 Gaussian Splat `.splat` 每点 32 bytes，前 12 bytes 是 little-endian float32 XYZ。
 * 解析后直接应用对象 transform 并建立世界/场景坐标 XZ 高度索引；不保存原始二进制或 URL 临时态。
 */
export async function registerGaussianGround(character: CharacterObj, url: string): Promise<void> {
  const signature = `${character.id}|${url}|${character.position.join(',')}|${character.rotation.join(',')}|${character.scale.join(',')}|${character.uniformScale}`
  if (surfaces.has(signature) || loading.has(signature)) return loading.get(signature)
  const task = (async () => {
    const response = await fetch(proxifyRemoteAssetUrl(url, { forceProxy: true }))
    if (!response.ok) throw new Error(`Gaussian ground fetch failed: HTTP ${response.status}`)
    const buffer = await response.arrayBuffer()
    const matrix = objectMatrix(character)
    surfaces.set(signature, { cells: buildHeightCells(buffer, matrix), ready: true })
  })().finally(() => loading.delete(signature))
  loading.set(signature, task)
  return task
}

/** 确定性回归/内存资产入口：与网络 `.splat` 使用同一解析和索引代码。 */
export function registerGaussianGroundBuffer(character: CharacterObj, buffer: ArrayBuffer, id = 'memory'): void {
  unregisterGaussianGround(character.id)
  const signature = `${character.id}|${id}|buffer`
  surfaces.set(signature, { cells: buildHeightCells(buffer, objectMatrix(character)), ready: true })
}

export function unregisterGaussianGround(characterId: string): void {
  for (const signature of [...surfaces.keys()]) if (signature.startsWith(`${characterId}|`)) surfaces.delete(signature)
}

/** 查询最近点云格的稳健上表面高度。优先当前 Y 附近/下方，避免站在建筑旁时跳到屋顶。 */
export function sampleGaussianGroundHeight(x: number, z: number, currentY: number): number | null {
  const baseX = Math.floor(x / CELL_SIZE)
  const baseZ = Math.floor(z / CELL_SIZE)
  let bestY: number | null = null
  let bestDistance = Infinity
  for (const surface of surfaces.values()) {
    if (!surface.ready) continue
    for (let ring = 0; ring <= SEARCH_RINGS; ring++) {
      for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue
        const cell = surface.cells.get(`${baseX + dx},${baseZ + dz}`)
        if (!cell?.values.length) continue
        const allowed = cell.values.filter((value) => value <= currentY + 1.5)
        const values = allowed.length ? allowed : cell.values
        // 75% 分位比 max 更不容易被悬浮噪点抬高，同时能落在台阶/坡面上层。
        const y = values[Math.min(values.length - 1, Math.floor(values.length * .75))]
        const distance = Math.hypot(dx, dz)
        if (distance < bestDistance || (distance === bestDistance && (bestY === null || Math.abs(y - currentY) < Math.abs(bestY - currentY)))) {
          bestY = y
          bestDistance = distance
        }
      }
      if (bestY !== null && bestDistance <= ring) break
    }
  }
  return bestY
}

export function snapPositionToGround(position: Vec3, groundHeight: number, gaussianEnabled: boolean): Vec3 {
  const sampled = gaussianEnabled ? sampleGaussianGroundHeight(position[0], position[2], position[1]) : null
  return [position[0], sampled ?? groundHeight, position[2]]
}
