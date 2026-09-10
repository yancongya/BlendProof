import type { ProjectStorage, PublicProjectAsset, StoredAsset } from '../server/contracts.js'
import { assertPublicAssetContent, assertPublicProjectAsset, publicAssetContentTypes } from '../server/asset-policy.js'

export class R2ProjectStorage implements ProjectStorage {
  constructor(private readonly bucket: R2Bucket) {}

  async has(projectId: string, asset: PublicProjectAsset, version = 1) {
    assertPublicProjectAsset(asset)
    return Boolean(await this.bucket.head(r2AssetKey(projectId, version, asset)))
  }

  async get(projectId: string, asset: PublicProjectAsset, version = 1): Promise<StoredAsset | null> {
    assertPublicProjectAsset(asset)
    const object = await this.bucket.get(r2AssetKey(projectId, version, asset))
    if (!object) return null
    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType ?? publicAssetContentTypes[asset],
      size: object.size,
      etag: object.httpEtag,
    }
  }

  async put(
    projectId: string,
    asset: PublicProjectAsset,
    body: Uint8Array | string,
    contentType: string,
    version = 1,
    customMetadata?: Record<string, string>,
  ) {
    assertStorageNamespace(projectId)
    assertVersion(version)
    assertPublicAssetContent(asset, body, contentType)
    await this.bucket.put(r2AssetKey(projectId, version, asset), body, {
      httpMetadata: { contentType: publicAssetContentTypes[asset] },
      customMetadata,
    })
  }

  async deleteVersion(projectId: string, version: number) {
    await this.deletePrefix(projectId, `projects/${projectId}/v${assertVersion(version)}/`)
  }

  async deleteProject(projectId: string) {
    await this.deletePrefix(projectId, `projects/${projectId}/`)
  }

  private async deletePrefix(projectId: string, prefix: string) {
    assertStorageNamespace(projectId)
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({ prefix, cursor })
      if (page.objects.length) await this.bucket.delete(page.objects.map((object) => object.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }
}

export function r2AssetKey(storageNamespace: string, version: number, asset: PublicProjectAsset) {
  assertStorageNamespace(storageNamespace)
  assertVersion(version)
  assertPublicProjectAsset(asset)
  return `projects/${storageNamespace}/v${version}/${asset}`
}

function assertVersion(version: number) {
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError('资源版本无效。')
  return version
}

function assertStorageNamespace(value: string) {
  if (!/^[a-f0-9]{32,64}$/.test(value)) throw new TypeError('存储命名空间无效。')
}
