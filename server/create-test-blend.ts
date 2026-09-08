import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const blender = process.env.BLENDER_BIN
if (!blender) throw new Error('请通过 BLENDER_BIN 指定 Blender。')
const script = path.join(root, 'server', 'blender', 'create_simple_scene.py')
const destination = path.join(root, 'test-assets', 'simple-review-scene.blend')

const child = spawn(blender, ['--background', '--python', script, '--', destination], { stdio: 'inherit' })
const exitCode = await new Promise<number>((resolve, reject) => {
  child.on('error', reject)
  child.on('exit', (code) => resolve(code ?? 1))
})
if (exitCode !== 0) process.exit(exitCode)
