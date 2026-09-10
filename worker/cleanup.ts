import type { PublicProjectAsset } from '../server/contracts.js'
import { r2AssetKey } from './r2-storage.js'

/**
 * Bounds are deliberately small enough for a scheduled invocation to finish
 * inside a Worker, while still allowing callers to tune a local run.
 */
export type CleanupOptions = {
  now?: Date | string
  pageSize?: number
  maxIntents?: number
  maxJobs?: number
  /** Also accepted as a convenient bound for both stages. */
  limit?: number
  /** How long a claimed job may be running before another invocation reclaims it. */
  staleAfterMs?: number
}

export type ExpireReport = {
  scanned: number
  expired: number
  enqueued: number
  skippedReady: number
}

export type ProcessReport = {
  scanned: number
  claimed: number
  completed: number
  deleted: number
  skippedReady: number
  failed: number
}

export type CleanupReport = {
  expiredIntents: ExpireReport
  jobs: ProcessReport
}

type ExpiredIntentRow = {
  id: string
  project_id: string
  asset_version: number
  staging_namespace: string
  expected_assets_json: string
  expires_at: string
}

type IntentAssetRow = {
  object_key: string
  asset_name: string
  asset_version: number
  status: string
}

type CleanupJobRow = {
  id: string
  project_id: string
  object_key: string
  asset_version: number | null
  kind: string
  status: string
  attempts: number
  last_error: string | null
  updated_at: string
}

const DEFAULT_PAGE_SIZE = 50
const DEFAULT_MAX_INTENTS = 100
const DEFAULT_MAX_JOBS = 100
const DEFAULT_STALE_AFTER_MS = 15 * 60_000
const MAX_PAGE_SIZE = 100
const MAX_BATCH_ITEMS = 1_000
const MAX_STALE_AFTER_MS = 7 * 24 * 60 * 60_000
const ASSET_NAMES = new Set<PublicProjectAsset>(['model.glb', 'manifest.json', 'thumbnail.webp'])

/**
 * Mark expired, still-active upload intents and enqueue exact R2 object keys.
 *
 * This function is intentionally independent of the fetch handler so a
 * Worker scheduled callback can call it without exposing a cleanup route.
 * Expiration is CAS-protected; a concurrent finalize therefore wins or the
 * intent is simply ignored by this invocation.
 */
export async function expireUploadIntents(env: Env, options: CleanupOptions = {}): Promise<ExpireReport> {
  const now = normalizeNow(options.now)
  const pageSize = normalizeBound(options.pageSize ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
  const maxIntents = normalizeBound(options.maxIntents ?? options.limit ?? DEFAULT_MAX_INTENTS, 0, MAX_BATCH_ITEMS)
  const report: ExpireReport = { scanned: 0, expired: 0, enqueued: 0, skippedReady: 0 }
  let cursor: { expiresAt: string; id: string } | undefined

  while (report.scanned < maxIntents) {
    const take = Math.min(pageSize, maxIntents - report.scanned)
    const cursorSql = cursor
      ? ` AND (expires_at > ? OR (expires_at = ? AND id > ?))`
      : ''
    const bindings: unknown[] = [now]
    if (cursor) bindings.push(cursor.expiresAt, cursor.expiresAt, cursor.id)
    bindings.push(take)
    const page = await env.DB.prepare(`SELECT id, project_id, asset_version, staging_namespace,
      expected_assets_json, expires_at
      FROM upload_intents
      WHERE status IN ('pending', 'uploading', 'finalizing') AND expires_at <= ?${cursorSql}
      ORDER BY expires_at ASC, id ASC LIMIT ?`).bind(...bindings).all<ExpiredIntentRow>()
    if (!page.results.length) break

    report.scanned += page.results.length
    for (const intent of page.results) {
      const changed = await env.DB.prepare(`UPDATE upload_intents
        SET status = 'expired', updated_at = ?
        WHERE id = ? AND status IN ('pending', 'uploading', 'finalizing') AND expires_at <= ?`)
        .bind(now, intent.id, now).run()
      if (!changed.meta.changes) continue

      report.expired += 1
      const queued = await enqueueIntentCleanup(env, intent, now)
      report.enqueued += queued.enqueued
      report.skippedReady += queued.skippedReady
    }

    const last = page.results[page.results.length - 1]
    cursor = { expiresAt: last.expires_at, id: last.id }
    if (page.results.length < take) break
  }

  return report
}

/**
 * Process a bounded page of cleanup jobs. Only the persisted object_key is
 * passed to R2.delete; this never lists a prefix and therefore cannot sweep a
 * whole project accidentally. Ready assets are protected immediately before
 * deletion, which also makes retries safe after a concurrent finalize.
 */
export async function processCleanupJobs(env: Env, options: CleanupOptions = {}): Promise<ProcessReport> {
  const now = normalizeNow(options.now)
  const pageSize = normalizeBound(options.pageSize ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
  const maxJobs = normalizeBound(options.maxJobs ?? options.limit ?? DEFAULT_MAX_JOBS, 0, MAX_BATCH_ITEMS)
  const staleAfterMs = normalizeBound(options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS, 0, MAX_STALE_AFTER_MS)
  const staleBefore = new Date(Date.parse(now) - staleAfterMs).toISOString()
  const report: ProcessReport = { scanned: 0, claimed: 0, completed: 0, deleted: 0, skippedReady: 0, failed: 0 }
  let cursor: { updatedAt: string; id: string } | undefined
  // A failed attempt is written with `updated_at = now`, which can move it
  // ahead of the keyset cursor. Keep a per-invocation seen set so one
  // scheduled run never retries the same job repeatedly or exceeds its bound.
  const seen = new Set<string>()

  while (report.scanned < maxJobs) {
    const take = Math.min(pageSize, maxJobs - report.scanned)
    const cursorSql = cursor
      ? ` AND (updated_at > ? OR (updated_at = ? AND id > ?))`
      : ''
    const bindings: unknown[] = [staleBefore]
    if (cursor) bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.id)
    bindings.push(take)
    const page = await env.DB.prepare(`SELECT id, project_id, object_key, asset_version, kind,
      status, attempts, last_error, updated_at
      FROM cleanup_jobs
      WHERE (status IN ('pending', 'failed') OR (status = 'running' AND updated_at <= ?))${cursorSql}
      ORDER BY updated_at ASC, id ASC LIMIT ?`).bind(...bindings).all<CleanupJobRow>()
    if (!page.results.length) break

    const candidates = page.results.filter((job) => !seen.has(job.id))
    for (const job of page.results) seen.add(job.id)
    report.scanned += candidates.length
    for (const job of candidates) {
      const claim = await env.DB.prepare(`UPDATE cleanup_jobs
        SET status = 'running', attempts = attempts + 1, last_error = NULL, updated_at = ?
        WHERE id = ? AND (
          status IN ('pending', 'failed') OR
          (status = 'running' AND updated_at <= ?)
        ) AND (
          kind != 'staging' OR EXISTS (
            SELECT 1 FROM upload_intents ui
            WHERE ui.project_id = cleanup_jobs.project_id
              AND ui.asset_version = cleanup_jobs.asset_version
              AND ui.status IN ('expired', 'failed', 'finalized')
          )
          OR kind = 'staging' AND NOT EXISTS (
            SELECT 1 FROM upload_intents ui
            WHERE ui.project_id = cleanup_jobs.project_id
              AND ui.asset_version = cleanup_jobs.asset_version
          )
        )`).bind(now, job.id, staleBefore).run()
      if (!claim.meta.changes) continue
      report.claimed += 1

      try {
        const ready = await env.DB.prepare(`SELECT 1 AS present FROM project_assets
          WHERE object_key = ? AND status = 'ready' LIMIT 1`).bind(job.object_key).first<{ present: number }>()
        if (ready) {
          await markJobDone(env, job.id, now)
          report.completed += 1
          report.skippedReady += 1
          continue
        }

        // Deliberately use the exact key from cleanup_jobs, never a prefix or list.
        await env.ASSETS.delete(job.object_key)
        await markJobDone(env, job.id, now)
        report.completed += 1
        report.deleted += 1
      } catch (error) {
        const message = errorMessage(error)
        await env.DB.prepare(`UPDATE cleanup_jobs
          SET status = 'failed', last_error = ?, updated_at = ?
          WHERE id = ? AND status = 'running'`).bind(message, now, job.id).run()
        report.failed += 1
      }
    }

    const last = page.results[page.results.length - 1]
    cursor = { updatedAt: last.updated_at, id: last.id }
    if (page.results.length < take) break
  }

  return report
}

/** Run both halves in order; suitable as the body of a scheduled handler. */
export async function runCleanup(env: Env, options: CleanupOptions = {}): Promise<CleanupReport> {
  const expiredIntents = await expireUploadIntents(env, options)
  const jobs = await processCleanupJobs(env, options)
  return { expiredIntents, jobs }
}

/** Explicit scheduled-handler-friendly alias. */
export async function scheduledCleanup(env: Env, options: CleanupOptions = {}): Promise<CleanupReport> {
  return runCleanup(env, options)
}

async function enqueueIntentCleanup(env: Env, intent: ExpiredIntentRow, now: string) {
  const rows = await env.DB.prepare(`SELECT object_key, asset_name, asset_version, status
    FROM project_assets WHERE project_id = ? AND upload_intent_id = ? AND asset_version = ?`)
    .bind(intent.project_id, intent.id, intent.asset_version).all<IntentAssetRow>()

  const readyNames = new Set(rows.results.filter((row) => row.status === 'ready').map((row) => row.asset_name))
  const objectKeys = new Map<string, { assetVersion: number; ready: boolean }>()
  for (const row of rows.results) {
    if (!row.object_key) continue
    objectKeys.set(row.object_key, { assetVersion: row.asset_version, ready: row.status === 'ready' })
  }

  // Include deterministic staging keys even when a crash happened between R2
  // PUT and the project_assets insert. Invalid legacy JSON is ignored rather
  // than turning scheduled cleanup into an unbounded or unsafe operation.
  if (intent.staging_namespace) {
    for (const name of parseAssetNames(intent.expected_assets_json)) {
      if (readyNames.has(name)) continue
      try {
        const key = r2AssetKey(intent.staging_namespace, intent.asset_version, name)
        if (!objectKeys.has(key)) objectKeys.set(key, { assetVersion: intent.asset_version, ready: false })
      } catch {
        // The storage namespace is validated at creation time; ignore corrupt
        // legacy rows here and keep processing the other exact keys.
      }
    }
  }

  let enqueued = 0
  let skippedReady = 0
  for (const [objectKey, value] of objectKeys) {
    if (value.ready) {
      skippedReady += 1
      continue
    }
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO cleanup_jobs
      (id, project_id, object_key, asset_version, kind, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'staging', 'pending', 0, ?, ?)`)
      .bind(randomHex(16), intent.project_id, objectKey, value.assetVersion, now, now).run()
    enqueued += result.meta.changes
  }
  return { enqueued, skippedReady }
}

async function markJobDone(env: Env, id: string, now: string) {
  await env.DB.prepare(`UPDATE cleanup_jobs SET status = 'done', last_error = NULL, updated_at = ?
    WHERE id = ? AND status = 'running'`).bind(now, id).run()
}

function parseAssetNames(raw: string): PublicProjectAsset[] {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const name = (item as Record<string, unknown>).name
      return typeof name === 'string' && ASSET_NAMES.has(name as PublicProjectAsset)
        ? [name as PublicProjectAsset]
        : []
    })
  } catch {
    return []
  }
}

function normalizeNow(value: Date | string | undefined) {
  const date = value === undefined ? new Date() : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError('清理时间无效。')
  return date.toISOString()
}

function normalizeBound(value: number, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError('清理批次参数无效。')
  }
  return value
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 2_000) || '未知清理错误。'
}

function randomHex(bytes: number) {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return [...value].map((item) => item.toString(16).padStart(2, '0')).join('')
}
