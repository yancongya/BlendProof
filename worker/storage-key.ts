import { assertPublicProjectAsset } from '../server/asset-policy.js'
import type { PublicProjectAsset } from '../server/contracts.js'

/** Provider-neutral key layout persisted in D1 and used by exact-key cleanup. */
export function projectAssetKey(storageNamespace: string, version: number, asset: PublicProjectAsset) {
  assertStorageNamespace(storageNamespace)
  assertVersion(version)
  assertPublicProjectAsset(asset)
  return `projects/${storageNamespace}/v${version}/${asset}`
}

export function assertVersion(version: number) {
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError('资源版本无效。')
  return version
}

export function assertStorageNamespace(value: string) {
  if (!/^[a-f0-9]{32,64}$/.test(value)) throw new TypeError('存储命名空间无效。')
}
