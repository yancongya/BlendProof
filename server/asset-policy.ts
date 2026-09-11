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
  options: { allowLocalSourceMetadata?: boolean } = {},
): void {
  assertPublicProjectAsset(asset)
  const normalizedType = contentType.toLowerCase().replace(/\s+/g, '')
  const expectedType = publicAssetContentTypes[asset].toLowerCase().replace(/\s+/g, '')
  if (normalizedType !== expectedType && !(asset === 'manifest.json' && normalizedType === 'application/json')) {
    throw new TypeError('资源 Content-Type 无效。')
  }

  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  if (asset === 'model.glb') assertGlb(bytes)
  else if (asset === 'manifest.json') assertManifest(body, options.allowLocalSourceMetadata ?? true)
  else assertWebp(bytes)
}

function assertGlb(bytes: Uint8Array): void {
  if (bytes.byteLength < 20) throw new TypeError('GLB 文件不完整。')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new TypeError('GLB 文件头无效。')
  }
  if (view.getUint32(8, true) !== bytes.byteLength) throw new TypeError('GLB 文件长度无效。')
  if (containsBlenderHeader(bytes)) throw new TypeError('GLB 包含 Blender 源文件标记。')
  let offset = 12
  let chunkIndex = 0
  let json: Record<string, unknown> | null = null
  let binaryLength: number | null = null
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new TypeError('GLB chunk 头不完整。')
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    const chunkEnd = offset + 8 + chunkLength
    if (chunkEnd > bytes.byteLength || chunkLength % 4 !== 0) throw new TypeError('GLB chunk 长度无效。')
    if (chunkIndex === 0) {
      if (chunkType !== 0x4e4f534a) throw new TypeError('GLB JSON chunk 无效。')
      try {
        const text = new TextDecoder().decode(bytes.slice(offset + 8, chunkEnd)).trim()
        json = JSON.parse(text) as Record<string, unknown>
      } catch {
        throw new TypeError('GLB JSON chunk 无效。')
      }
    } else if (chunkIndex === 1 && chunkType === 0x004e4942) {
      binaryLength = chunkLength
    } else {
      throw new TypeError('GLB 包含未允许的额外 chunk。')
    }
    offset = chunkEnd
    chunkIndex += 1
  }
  if (offset !== bytes.byteLength || !json || chunkIndex < 1) throw new TypeError('GLB chunk 边界无效。')
  const asset = json.asset as Record<string, unknown> | undefined
  if (!asset || asset.version !== '2.0') throw new TypeError('GLB glTF 版本无效。')
  const buffers = json.buffers
  for (const collection of [json.buffers, json.images]) {
    if (Array.isArray(collection) && collection.some((item) => {
      if (!item || typeof item !== 'object') return true
      const uri = (item as Record<string, unknown>).uri
      return typeof uri === 'string' && !uri.startsWith('data:')
    })) throw new TypeError('GLB 不允许外部资源 URI。')
  }
  if (buffers !== undefined && !Array.isArray(buffers)) throw new TypeError('GLB buffer 声明无效。')
  if (Array.isArray(buffers) && buffers.some((item) => {
    if (!item || typeof item !== 'object') return true
    const declared = (item as Record<string, unknown>).byteLength
    return typeof declared !== 'number' || !Number.isSafeInteger(declared) || declared < 0
  })) throw new TypeError('GLB buffer 声明无效。')
  if (binaryLength !== null) {
    if (!Array.isArray(buffers) || buffers.length !== 1 || !buffers[0] || typeof buffers[0] !== 'object') {
      throw new TypeError('GLB buffer 声明无效。')
    }
    const buffer = buffers[0] as Record<string, unknown>
    const declared = buffer.byteLength as number
    if (buffer.uri !== undefined || declared > binaryLength || binaryLength - declared > 3) {
      throw new TypeError('GLB BIN chunk 长度无效。')
    }
  } else if (Array.isArray(buffers) && buffers.some((item) => (item as Record<string, unknown>).uri === undefined)) {
    throw new TypeError('GLB 缺少 BIN chunk。')
  }
}

function assertManifest(body: Uint8Array | string, allowLocalSourceMetadata: boolean): void {
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
  assertAllowedKeys(record, ['scene', 'camera', 'cameras', 'materials', 'objects', 'collections', 'export'])
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
  if (record.cameras !== undefined) {
    if (!Array.isArray(record.cameras) || record.cameras.length > 256) throw new TypeError('Manifest 相机列表无效。')
    for (const item of record.cameras) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Manifest 相机信息无效。')
      const camera = item as Record<string, unknown>
      assertAllowedKeys(camera, ['name', 'projection'])
      if (typeof camera.name !== 'string' || camera.name.length > 256 ||
        typeof camera.projection !== 'string' || camera.projection.length > 32) throw new TypeError('Manifest 相机信息无效。')
    }
  }
  if (record.materials !== undefined && !isStringArray(record.materials, 2_000)) {
    throw new TypeError('Manifest 材质列表无效。')
  }
  if (record.export !== undefined) {
    if (!record.export || typeof record.export !== 'object' || Array.isArray(record.export)) throw new TypeError('Manifest 导出信息无效。')
    const exportInfo = record.export as Record<string, unknown>
    assertAllowedKeys(exportInfo, allowLocalSourceMetadata ? ['sourceBytes', 'glbBytes', 'objectCount'] : ['glbBytes', 'objectCount'])
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
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(4, true) + 8 !== bytes.byteLength) throw new TypeError('WebP 文件长度无效。')
  let offset = 12
  let hasImageChunk = false
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new TypeError('WebP chunk 头不完整。')
    const chunkLength = view.getUint32(offset + 4, true)
    const chunkType = ascii(offset, offset + 4)
    const payload = offset + 8
    if (chunkType === 'VP8 ' && chunkLength > 10 && bytes[payload + 3] === 0x9d && bytes[payload + 4] === 0x01 && bytes[payload + 5] === 0x2a) {
      const width = view.getUint16(payload + 6, true) & 0x3fff
      const height = view.getUint16(payload + 8, true) & 0x3fff
      if (width > 0 && height > 0) hasImageChunk = true
    }
    if (chunkType === 'VP8L' && chunkLength > 5 && bytes[payload] === 0x2f) {
      const bits = view.getUint32(payload + 1, true)
      const version = (bits >>> 29) & 0x07
      if (version === 0) hasImageChunk = true
    }
    // VP8X only describes extended canvas/features. It is not image payload.
    offset += 8 + chunkLength + (chunkLength % 2)
    if (offset > bytes.byteLength) throw new TypeError('WebP chunk 长度无效。')
  }
  if (offset !== bytes.byteLength || !hasImageChunk) throw new TypeError('WebP 图像 chunk 无效。')
}

function containsBlenderHeader(bytes: Uint8Array): boolean {
  const markers = ['BLENDER-v', 'BLENDER_V'].map((value) => new TextEncoder().encode(value))
  for (const marker of markers) {
    outer: for (let index = 0; index <= bytes.byteLength - marker.byteLength; index += 1) {
      for (let offset = 0; offset < marker.byteLength; offset += 1) {
        if (bytes[index + offset] !== marker[offset]) continue outer
      }
      return true
    }
  }
  return false
}
