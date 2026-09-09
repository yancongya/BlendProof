import type { PublicProjectAsset } from './contracts.js'

export const publicProjectAssets = ['model.glb', 'manifest.json', 'thumbnail.webp'] as const

export const publicAssetContentTypes: Record<PublicProjectAsset, string> = {
  'model.glb': 'model/gltf-binary',
  'manifest.json': 'application/json; charset=utf-8',
  'thumbnail.webp': 'image/webp',
}

export function assertPublicProjectAsset(value: unknown): asserts value is PublicProjectAsset {
  if (typeof value !== 'string' || !publicProjectAssets.includes(value as PublicProjectAsset)) {
    throw new TypeError('资源名称无效。')
  }
}

export function assertPublicAssetContent(
  asset: PublicProjectAsset,
  body: Uint8Array | string,
  contentType: string,
): void {
  assertPublicProjectAsset(asset)
  const normalizedType = contentType.toLowerCase().replace(/\s+/g, '')
  const expectedType = publicAssetContentTypes[asset].toLowerCase().replace(/\s+/g, '')
  if (normalizedType !== expectedType && !(asset === 'manifest.json' && normalizedType === 'application/json')) {
    throw new TypeError('资源 Content-Type 无效。')
  }

  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  if (asset === 'model.glb') assertGlb(bytes)
  else if (asset === 'manifest.json') assertManifest(body)
  else assertWebp(bytes)
}

function assertGlb(bytes: Uint8Array): void {
  if (bytes.byteLength < 20) throw new TypeError('GLB 文件不完整。')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new TypeError('GLB 文件头无效。')
  }
  if (view.getUint32(8, true) !== bytes.byteLength) throw new TypeError('GLB 文件长度无效。')
  const firstChunkLength = view.getUint32(12, true)
  const firstChunkType = view.getUint32(16, true)
  if (firstChunkType !== 0x4e4f534a || 20 + firstChunkLength > bytes.byteLength) {
    throw new TypeError('GLB JSON chunk 无效。')
  }
}

function assertManifest(body: Uint8Array | string): void {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  if (bytes.byteLength === 0 || bytes.byteLength > 512 * 1024) throw new TypeError('Manifest 大小无效。')
  let value: unknown
  try {
    value = JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body))
  } catch {
    throw new TypeError('Manifest JSON 无效。')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Manifest 结构无效。')
  const record = value as Record<string, unknown>
  assertAllowedKeys(record, ['scene', 'camera', 'objects', 'collections', 'export'])
  if (typeof record.scene !== 'string' || record.scene.length > 256) throw new TypeError('Manifest 场景无效。')
  if (record.camera !== null && record.camera !== undefined && typeof record.camera !== 'string') throw new TypeError('Manifest 相机无效。')
  if (!Array.isArray(record.objects) || record.objects.length > 10_000) throw new TypeError('Manifest 对象列表无效。')
  for (const item of record.objects) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Manifest 对象无效。')
    const object = item as Record<string, unknown>
    assertAllowedKeys(object, ['name', 'type', 'collections'])
    if (typeof object.name !== 'string' || object.name.length > 256) throw new TypeError('Manifest 对象名称无效。')
    if (typeof object.type !== 'string' || object.type.length > 64) throw new TypeError('Manifest 对象类型无效。')
    if (!isStringArray(object.collections, 2_000)) throw new TypeError('Manifest 对象集合无效。')
  }
  if (!isStringArray(record.collections, 2_000)) throw new TypeError('Manifest 集合列表无效。')
  if (record.export !== undefined) {
    if (!record.export || typeof record.export !== 'object' || Array.isArray(record.export)) throw new TypeError('Manifest 导出信息无效。')
    const exportInfo = record.export as Record<string, unknown>
    assertAllowedKeys(exportInfo, ['sourceBytes', 'glbBytes', 'objectCount'])
    if (Object.values(exportInfo).some((item) => typeof item !== 'number' || !Number.isFinite(item) || item < 0)) {
      throw new TypeError('Manifest 导出数值无效。')
    }
  }
}

function assertAllowedKeys(record: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(record).some((key) => !allowed.includes(key))) throw new TypeError('Manifest 包含未允许字段。')
}

function isStringArray(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every((item) => typeof item === 'string' && item.length <= 256)
}

function assertWebp(bytes: Uint8Array): void {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  if (bytes.byteLength < 12 || ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WEBP') {
    throw new TypeError('WebP 文件头无效。')
  }
}
