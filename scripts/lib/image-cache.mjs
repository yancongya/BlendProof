/**
 * Content-addressed cache for the landing image optimizer.
 *
 * The optimized WebP outputs and this cache manifest are committed, so a fresh
 * checkout (local or CI) can prove the outputs already match their sources
 * instead of re-encoding 17 multi-megapixel PNGs on every gate run. Encoding
 * was 113s of a 176s gate while producing byte-identical files.
 */
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

export const CACHE_VERSION = 1;

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

/** Fingerprint every input that changes encoder output, so a param edit invalidates the cache. */
export function paramsFingerprint(params) {
  return sha256(Buffer.from(JSON.stringify(stable({ cacheVersion: CACHE_VERSION, ...params }))));
}

export async function loadCache(cachePath) {
  try {
    const parsed = JSON.parse(await readFile(cachePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
      return { params: parsed.params ?? null, entries: parsed.entries };
    }
  } catch { /* absent or corrupt cache must degrade to a full encode, never fail the gate */ }
  return { params: null, entries: {} };
}

export async function saveCache(cachePath, cache) {
  const tmp = `${cachePath}.tmp`;
  await writeFile(tmp, JSON.stringify(cache, null, 2) + '\n');
  await rename(tmp, cachePath);
}

/**
 * A hit requires identical encoder params, identical source bytes, and every
 * recorded output still present with exactly the recorded hash. Those bytes were
 * validated (format, dimensions, alpha pixels, size budget) when produced, so a
 * hash match means the validation result still holds; re-running it would only
 * repeat the expensive decode/encode work.
 */
export function cacheEntryIsFresh(entry, { paramsHash, sourceSha256, outputHashes }) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.paramsHash !== paramsHash) return false;
  if (entry.sourceSha256 !== sourceSha256) return false;
  if (!Array.isArray(entry.outputs) || entry.outputs.length === 0) return false;
  return entry.outputs.every((output) =>
    output && typeof output.path === 'string' && typeof output.sha256 === 'string' &&
    outputHashes.get(output.path) === output.sha256);
}
