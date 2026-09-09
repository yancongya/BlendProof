import { createReadStream, existsSync } from 'node:fs'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ProjectStorage, PublicProjectAsset, StoredAsset } from './contracts.js'

const contentTypes: Record<PublicProjectAsset, string> = {
  'model.glb': 'model/gltf-binary',
  'manifest.json': 'application/json; charset=utf-8',
  'thumbnail.webp': 'image/webp',
}

export class LocalProjectStorage implements ProjectStorage {
  constructor(readonly root: string) {}

  async has(projectId: string, asset: PublicProjectAsset): Promise<boolean> {
    return existsSync(this.assetPath(projectId, asset))
  }

  async get(projectId: string, asset: PublicProjectAsset): Promise<StoredAsset | null> {
    const target = this.assetPath(projectId, asset)
    try {
      const handle = await open(target, 'r')
      const stat = await handle.stat()
      await handle.close()
      return {
        body: Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>,
        contentType: contentTypes[asset],
        size: stat.size,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async put(
    projectId: string,
    asset: PublicProjectAsset,
    body: ReadableStream<Uint8Array> | Uint8Array | string,
    _contentType: string,
  ): Promise<void> {
    const directory = this.projectPath(projectId)
    await mkdir(directory, { recursive: true })
    const target = this.assetPath(projectId, asset)
    const temporary = path.join(directory, `.${asset}-${randomUUID()}.tmp`)
    const value = typeof body === 'string' || body instanceof Uint8Array
      ? body
      : new Uint8Array(await new Response(body).arrayBuffer())
    await writeFile(temporary, value)
    await rename(temporary, target)
  }

  async deleteProject(projectId: string): Promise<void> {
    await rm(this.projectPath(projectId), { recursive: true, force: true })
  }

  projectPath(projectId: string): string {
    assertProjectId(projectId)
    return path.join(this.root, projectId)
  }

  assetPath(projectId: string, asset: PublicProjectAsset): string {
    return path.join(this.projectPath(projectId), asset)
  }
}

export function isPublicProjectAsset(value: string): value is PublicProjectAsset {
  return value === 'model.glb' || value === 'manifest.json' || value === 'thumbnail.webp'
}

function assertProjectId(projectId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(projectId)) throw new TypeError('项目标识无效。')
}
