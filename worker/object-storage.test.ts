import { afterEach, describe, expect, it, vi } from 'vitest'
import { objectStorage, objectStorageHealth } from './object-storage.js'
import { S3ObjectStorage } from './s3-storage.js'

afterEach(() => vi.unstubAllGlobals())

describe('object storage composition', () => {
  it('reports provider-neutral health without exposing configuration', () => {
    expect(objectStorageHealth({ STORAGE_PROVIDER: 's3', S3_ENDPOINT: 'https://s3.example.test/bucket',
      S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret' } as never))
      .toEqual({ provider: 's3', bound: true })
    expect(objectStorageHealth({ STORAGE_PROVIDER: 's3' } as never))
      .toEqual({ provider: 's3', bound: false })
  })

  it('rejects an incomplete S3 deployment at the composition root', () => {
    expect(() => objectStorage({ STORAGE_PROVIDER: 's3' } as never)).toThrow('S3 对象存储配置不完整。')
  })

  it('signs exact-key S3 requests and normalizes object metadata', async () => {
    const fetchMock = vi.fn(async (request: Request) => new Response(null, {
      status: request.method === 'HEAD' ? 200 : 204,
      headers: request.method === 'HEAD' ? {
        'content-length': '42', etag: '"etag-1"', 'content-type': 'model/gltf-binary', 'x-amz-meta-sha256': 'abc',
      } : undefined,
    }))
    vi.stubGlobal('fetch', fetchMock)
    const storage = new S3ObjectStorage({ endpoint: 'https://s3.example.test/private-bucket', region: 'us-east-1',
      accessKeyId: 'test-key', secretAccessKey: 'test-secret' })

    await expect(storage.headObject('projects/abc/model.glb')).resolves.toEqual({
      size: 42, etag: '"etag-1"', contentType: 'model/gltf-binary', customMetadata: { sha256: 'abc' },
    })
    await storage.deleteObject('projects/abc/model.glb')

    const [headRequest] = fetchMock.mock.calls[0] as unknown as [Request]
    expect(headRequest.url).toBe('https://s3.example.test/private-bucket/projects/abc/model.glb')
    expect(headRequest.headers.get('authorization')).toContain('AWS4-HMAC-SHA256')
    expect((fetchMock.mock.calls[1] as unknown as [Request])[0].method).toBe('DELETE')
  })
})
