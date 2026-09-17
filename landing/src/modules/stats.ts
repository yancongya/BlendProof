/**
 * Stats modules: format helpers and live platform status.
 */

import { t, ifEn } from '../i18n'

const ORIGIN = 'https://blendproof.itycon.cn'

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

  const offline = (reason: string) => {
    note.dataset.state = 'offline'
    note.textContent = reason
    setStat('health', t('未读取'), t('跨域或网络受限'))
  }

  try {
    const [healthResponse, statsResponse] = await Promise.all([
      fetch(`${ORIGIN}/api/health`, { cache: 'no-store' }),
      fetch(`${ORIGIN}/api/public/stats`, { cache: 'no-store' }),
    ])

    if (healthResponse.ok) {
      const health = (await healthResponse.json()) as { runtime?: string; d1?: boolean; r2?: boolean }
      const parts = [
        health.runtime === 'cloudflare-worker' ? 'Worker' : health.runtime,
        health.d1 ? 'D1' : null,
        health.r2 ? 'R2' : null,
      ]
      setStat('health', health.d1 && health.r2 ? t('运行中') : t('部分可用'), parts.filter(Boolean).join(' · ') || undefined)
    }

    if (!statsResponse.ok) {
      offline(ifEn(`Live API returned ${statsResponse.status}; platform data is temporarily unavailable.`, `实时接口返回 ${statsResponse.status}，暂时无法读取平台数据。`))
      return
    }

    const stats = (await statsResponse.json()) as PublicStats

    setStat('uptime', formatUptime(stats.launchedAt), t('自 2026-09-12 上线'))
    setStat('capacity', formatBytes(stats.capacityBytes), ifEn(`${formatBytes(stats.usedBytes)} used`, `已用 ${formatBytes(stats.usedBytes)}`))
    setStat('projects', String(stats.projectCount), ifEn(`${stats.activeShareCount} active shares`, `${stats.activeShareCount} 条活跃分享`))
    setStat('processed', String(stats.processedFileCount), ifEn(`${formatBytes(stats.processedBytes)} total`, `累计 ${formatBytes(stats.processedBytes)}`))
    setStat('cleaned', String(stats.cleanedFileCount), ifEn(`${formatBytes(stats.cleanedBytes)} freed`, `释放 ${formatBytes(stats.cleanedBytes)}`))

    const meter = document.querySelector<HTMLElement>('[data-stat="meter"]')
    if (meter && stats.capacityBytes > 0) {
      meter.style.width = `${Math.min(100, (stats.usedBytes / stats.capacityBytes) * 100)}%`
    }

    note.dataset.state = 'online'
    note.textContent = ifEn(
      `Live data loaded. Projects are retained up to ${stats.retentionHours} hours, ` +
      `shares default to ${stats.recommendedShareHours} hours, and cleanup runs hourly.`,
      `实时数据读取成功。项目最长保留 ${stats.retentionHours} 小时，` +
      `分享默认 ${stats.recommendedShareHours} 小时，每小时定时清理。`,
    )
  } catch {
    offline(t('无法连接生产接口（跨域或网络受限），实时数据仅在线上站点可见。'))
  }
}

export async function init(): Promise<void> {
  void initLiveStatus()
}