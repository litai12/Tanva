import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Deterministic, project-authored CC0 terrain for Director Console regression.
// antimatter15/Drei .splat layout: xyz f32, scale f32, rgba u8, quaternion u8.
const sourceDirectory = process.env.DIRECTOR_ASSET_SOURCE_DIR?.trim()
if (!sourceDirectory) {
  throw new Error('Set DIRECTOR_ASSET_SOURCE_DIR to an external staging directory')
}
const output = resolve(process.cwd(), sourceDirectory, 'open-source/cc0-terrain/rolling-ground.splat')
const side = 65
const spacing = 0.125
const count = side * side
const buffer = new ArrayBuffer(count * 32)
const view = new DataView(buffer)

let index = 0
for (let iz = 0; iz < side; iz += 1) {
  for (let ix = 0; ix < side; ix += 1) {
    const x = (ix - (side - 1) / 2) * spacing
    const z = (iz - (side - 1) / 2) * spacing
    const y = 0.28 + 0.055 * x + 0.08 * Math.sin(x * 0.9) * Math.cos(z * 0.7)
    const offset = index * 32
    view.setFloat32(offset, x, true)
    view.setFloat32(offset + 4, y, true)
    view.setFloat32(offset + 8, z, true)
    view.setFloat32(offset + 12, 0.105, true)
    view.setFloat32(offset + 16, 0.025, true)
    view.setFloat32(offset + 20, 0.105, true)
    view.setUint8(offset + 24, 74 + Math.round((x + 4) * 4))
    view.setUint8(offset + 25, 118 + Math.round((y - 0.1) * 35))
    view.setUint8(offset + 26, 72 + Math.round((z + 4) * 2))
    view.setUint8(offset + 27, 235)
    view.setUint8(offset + 28, 128)
    view.setUint8(offset + 29, 128)
    view.setUint8(offset + 30, 128)
    view.setUint8(offset + 31, 255)
    index += 1
  }
}

await mkdir(dirname(output), { recursive: true })
await writeFile(output, new Uint8Array(buffer))
console.log(`wrote ${count} splats (${buffer.byteLength} bytes) to ${output}`)
