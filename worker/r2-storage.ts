import type { ProjectStorage, PublicProjectAsset, StoredAsset } from '../server/contracts.js'
import type { ObjectBody, ObjectHead, ObjectStorage } from './object-storage.js'
import { assertStorageNamespace, assertVersion, projectAssetKey } from './storage-key.js'
import { assertPublicAssetContent, assertPublicProjectAsset, publicAssetContentTypes } from '../server/asset-policy.js'

export class R2ProjectStorage implements ProjectStorage, ObjectStorage {
  readonly provider = 'r2'

  constructor(private readonly bucket: R2Bucket) {}

  async has(projectId: string, asset: PublicProjectAsset, version = 1) {
    assertPublicProjectAsset(asset)
    return Boolean(await this.bucket.head(projectAssetKey(projectId, version, asset)))
  }

  async get(projectId: string, asset: PublicProjectAsset, version = 1): Promise<StoredAsset | null> {
    assertPublicProjectAsset(asset)
    const object = await this.bucket.get(projectAssetKey(projectId, version, asset))
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
    assertPublicAssetContent(asset, body, contentType, { allowLocalSourceMetadata: false })
    await this.bucket.put(projectAssetKey(projectId, version, asset), body, {
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

  async headObject(key: string): Promise<ObjectHead | null> {
    const object = await this.bucket.head(key)
    if (!object) return null
    return {
      size: object.size,
      etag: object.httpEtag,
      contentType: object.httpMetadata?.contentType ?? null,
      customMetadata: object.customMetadata ?? {},
    }
  }

  async getObject(key: string): Promise<ObjectBody | null> {
    const object = await this.bucket.get(key)
    if (!object) return null
    return {
      body: object.body,
      size: object.size,
      etag: object.httpEtag,
      contentType: object.httpMetadata?.contentType ?? null,
      customMetadata: object.customMetadata ?? {},
    }
  }

  async deleteObject(key: string | string[]) {
    await this.bucket.delete(key)
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
  return projectAssetKey(storageNamespace, version, asset)
}
