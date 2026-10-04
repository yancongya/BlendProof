import { AwsClient } from 'aws4fetch'
import { assertPublicAssetContent, assertPublicProjectAsset, publicAssetContentTypes } from '../server/asset-policy.js'
import type { PublicProjectAsset, StoredAsset } from '../server/contracts.js'
import type { ObjectBody, ObjectHead, ObjectStorage } from './object-storage.js'
import { assertStorageNamespace, assertVersion, projectAssetKey } from './storage-key.js'

export type S3StorageConfig = {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

/** S3-compatible adapter for AWS S3, MinIO and compatible OSS services. */
export class S3ObjectStorage implements ObjectStorage {
  readonly provider = 's3'
  private readonly client: AwsClient
  private readonly endpoint: string

  constructor(config: S3StorageConfig) {
    this.endpoint = normalizeEndpoint(config.endpoint)
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken,
      service: 's3',
      region: config.region,
      retries: 2,
    })
  }

  async has(projectId: string, asset: PublicProjectAsset, version = 1) {
    return Boolean(await this.headObject(projectAssetKey(projectId, version, asset)))
  }

  async get(projectId: string, asset: PublicProjectAsset, version = 1): Promise<StoredAsset | null> {
    assertPublicProjectAsset(asset)
    const object = await this.getObject(projectAssetKey(projectId, version, asset))
    if (!object) return null
    return { body: object.body, contentType: object.contentType ?? publicAssetContentTypes[asset], size: object.size, etag: object.etag }
  }

  async put(projectId: string, asset: PublicProjectAsset, body: Uint8Array | string, contentType: string,
    version = 1, customMetadata?: Record<string, string>) {
    assertStorageNamespace(projectId)
    assertVersion(version)
    assertPublicAssetContent(asset, body, contentType, { allowLocalSourceMetadata: false })
    const headers = new Headers({ 'content-type': publicAssetContentTypes[asset] })
    for (const [key, value] of Object.entries(customMetadata ?? {})) headers.set(`x-amz-meta-${key}`, value)
    const requestBody: BodyInit = typeof body === 'string' ? body : new Blob([body as Uint8Array<ArrayBuffer>])
    const response = await this.client.fetch(this.objectUrl(projectAssetKey(projectId, version, asset)), { method: 'PUT', headers, body: requestBody })
    await expectSuccess(response, '写入对象失败')
  }

  async headObject(key: string): Promise<ObjectHead | null> {
    const response = await this.client.fetch(this.objectUrl(key), { method: 'HEAD' })
    if (response.status === 404) return null
    await expectSuccess(response, '读取对象元数据失败')
    return responseHead(response)
  }

  async getObject(key: string): Promise<ObjectBody | null> {
    const response = await this.client.fetch(this.objectUrl(key))
    if (response.status === 404) return null
    await expectSuccess(response, '读取对象失败')
    if (!response.body) throw new Error('对象响应缺少内容。')
    return { ...responseHead(response), body: response.body }
  }

  async deleteObject(key: string | string[]) {
    for (const item of Array.isArray(key) ? key : [key]) {
      const response = await this.client.fetch(this.objectUrl(item), { method: 'DELETE' })
      await expectSuccess(response, '删除对象失败')
    }
  }

  async deleteVersion(projectId: string, version: number) {
    await this.deletePrefix(`projects/${validatedNamespace(projectId)}/v${assertVersion(version)}/`)
  }

  async deleteProject(projectId: string) {
    await this.deletePrefix(`projects/${validatedNamespace(projectId)}/`)
  }

  private async deletePrefix(prefix: string) {
    let continuation: string | undefined
    do {
      const url = new URL(this.endpoint)
      url.searchParams.set('list-type', '2')
      url.searchParams.set('prefix', prefix)
      if (continuation) url.searchParams.set('continuation-token', continuation)
      const response = await this.client.fetch(url)
      await expectSuccess(response, '列出对象失败')
      const xml = await response.text()
      const keys = [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((match) => decodeXml(match[1]))
      await this.deleteObject(keys)
      continuation = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? decodeXml(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? '') || undefined
        : undefined
    } while (continuation)
  }

  private objectUrl(key: string) {
    return `${this.endpoint}/${key.split('/').map(encodeURIComponent).join('/')}`
  }
}

function normalizeEndpoint(value: string) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash) throw new TypeError('S3 endpoint 只能包含协议、主机和 bucket 路径。')
  return url.toString().replace(/\/$/, '')
}

function responseHead(response: Response): ObjectHead {
  const size = Number(response.headers.get('content-length'))
  const etag = response.headers.get('etag')
  if (!Number.isSafeInteger(size) || size < 0 || !etag) throw new Error('对象元数据不完整。')
  const customMetadata: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    if (key.startsWith('x-amz-meta-')) customMetadata[key.slice('x-amz-meta-'.length)] = value
  })
  return { size, etag, contentType: response.headers.get('content-type'), customMetadata }
}

async function expectSuccess(response: Response, label: string) {
  if (!response.ok) throw new Error(`${label}（${response.status}）。`)
}

function validatedNamespace(value: string) {
  assertStorageNamespace(value)
  return value
}

function decodeXml(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}
