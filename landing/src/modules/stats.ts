/**
 * Stats modules: format helpers and live platform status.
 */

import { t, ifEn } from '../i18n'

const ORIGIN = window.location.origin
let liveStatusStarted = false
let liveStatusObserver: IntersectionObserver | undefined

type PublicStats = {
  capacityBytes: number
  usedBytes: number
  projectCount: number
  activeShareCount: number
  retentionHours: number
  recommendedShareHours: number
  launchedAt: string
  processedFileCount: number
  processedBytes: number
  cleanedFileCount: number
  cleanedBytes: number
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

function formatUptime(launchedAt: string): string {
  const started = Date.parse(launchedAt)
  if (Number.isNaN(started)) return '—'
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return ifEn(`${days} d ${hours} h`, `${days} 天 ${hours} 小时`)
  if (hours > 0) return ifEn(`${hours} h ${minutes % 60} m`, `${hours} 小时 ${minutes % 60} 分`)
  return ifEn(`${minutes} min`, `${minutes} 分钟`)
}

function setStat(key: string, value: string, note?: string): void {
  const node = document.querySelector<HTMLElement>(`[data-stat="${key}"]`)
  if (!node) return
  const noteNode = node.querySelector('small')
  if (noteNode && note !== undefined) noteNode.textContent = note
  node.textContent = value
  if (noteNode) node.appendChild(noteNode)
}

async function initLiveStatus(): Promise<void> {
  const note = document.querySelector<HTMLElement>('[data-stat="note"]')
  if (!note) return

  const [healthResult, statsResult] = await Promise.allSettled([
    fetch(`${ORIGIN}/api/health`, { cache: 'no-store' }).then(async (response) => ({ ok: response.ok, status: response.status, data: await response.json() })),
    fetch(`${ORIGIN}/api/public/stats`, { cache: 'no-store' }).then(async (response) => ({ ok: response.ok, status: response.status, data: await response.json() })),
  ])
  // Keep the fetched snapshot; language switches only rerender text.
  const render = (): void => {
    const issues: string[] = []
    let loadedStats: PublicStats | undefined

    if (healthResult.status === 'fulfilled' && healthResult.value.ok) {
      try {
        const health = healthResult.value.data as { runtime?: string; database?: { bound?: boolean }; objectStorage?: { bound?: boolean } }
        const parts = [
          health.runtime === 'cloudflare-worker' ? 'Worker' : health.runtime,
          health.database?.bound ? 'D1' : null,
          health.objectStorage?.bound ? 'R2' : null,
        ]
        setStat('health', health.database?.bound && health.objectStorage?.bound ? t('运行中') : t('部分可用'), parts.filter(Boolean).join(' · ') || undefined)
      } catch {
        setStat('health', t('未读取'), t('健康数据格式无效'))
        issues.push(ifEn('Platform health data is unavailable.', '平台健康数据暂不可用。'))
      }
    } else {
      const status = healthResult.status === 'fulfilled' ? ` (${healthResult.value.status})` : ''
      setStat('health', t('未读取'), t('跨域或网络受限'))
      issues.push(ifEn(`Platform health status is unavailable${status}.`, `平台健康状态暂不可用${status}。`))
    }

    if (statsResult.status === 'fulfilled' && statsResult.value.ok) {
      try {
        const stats = statsResult.value.data as PublicStats
        loadedStats = stats

        setStat('uptime', formatUptime(stats.launchedAt), t('自 2026-09-12 上线'))
        setStat('capacity', formatBytes(stats.capacityBytes), ifEn(`${formatBytes(stats.usedBytes)} used`, `已用 ${formatBytes(stats.usedBytes)}`))
        setStat('projects', String(stats.projectCount), ifEn(`${stats.activeShareCount} active shares`, `${stats.activeShareCount} 条活跃分享`))
        setStat('processed', String(stats.processedFileCount), ifEn(`${formatBytes(stats.processedBytes)} total`, `累计 ${formatBytes(stats.processedBytes)}`))
        setStat('cleaned', String(stats.cleanedFileCount), ifEn(`${formatBytes(stats.cleanedBytes)} freed`, `释放 ${formatBytes(stats.cleanedBytes)}`))

        const meter = document.querySelector<HTMLElement>('[data-stat="meter"]')
        if (meter && stats.capacityBytes > 0) {
          meter.style.width = `${Math.min(100, (stats.usedBytes / stats.capacityBytes) * 100)}%`
        }
      } catch {
        issues.push(ifEn('Live statistics are unavailable.', '实时统计数据暂不可用。'))
      }
    } else {
      const status = statsResult.status === 'fulfilled' ? ` (${statsResult.value.status})` : ''
      issues.push(ifEn(`Live statistics are unavailable${status}.`, `实时统计数据暂不可用${status}。`))
    }

    if (issues.length > 0) {
      note.dataset.state = 'offline'
      note.textContent = issues.join(' ')
      return
    }

    if (!loadedStats) return
    note.dataset.state = 'online'
    note.textContent = ifEn(
      `Live data loaded. Projects are retained up to ${loadedStats.retentionHours} hours, ` +
      `shares default to ${loadedStats.recommendedShareHours} hours, and cleanup runs hourly.`,
      `实时数据读取成功。项目最长保留 ${loadedStats.retentionHours} 小时，` +
      `分享默认 ${loadedStats.recommendedShareHours} 小时，每小时定时清理。`,
    )
  }
  render()
  window.addEventListener('blendproof:language-change', render)
}

function startLiveStatusOnce(): void {
  if (liveStatusStarted) return
  liveStatusStarted = true
  liveStatusObserver?.disconnect()
  liveStatusObserver = undefined
  void initLiveStatus()
}

export function init(): void {
  if (liveStatusStarted || liveStatusObserver) return

  const target = document.querySelector<HTMLElement>('.live')
  if (!target || typeof IntersectionObserver === 'undefined') {
    startLiveStatusOnce()
    return
  }

  try {
    liveStatusObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) startLiveStatusOnce()
    }, { rootMargin: '240px 0px', threshold: 0 })
    liveStatusObserver.observe(target)
  } catch {
    startLiveStatusOnce()
  }
}
