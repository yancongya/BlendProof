import { randomBytes, timingSafeEqual } from 'node:crypto'

export const BRIDGE_NONCE_HEADER = 'x-blendproof-session-nonce'
export const DEFAULT_BRIDGE_SESSION_TTL_SECONDS = 300

export type BridgePairingSession = {
  nonce: string
  expiresAt: number
}

/**
 * A process-local pairing gate for the localhost bridge.
 *
 * The pairing code bootstraps short-lived sessions. Sessions are bound to the
 * exact browser origin so a nonce cannot be replayed by another allowed app.
 */
export class LocalBridgePairing {
  private readonly pairingCode: string
  private readonly ttlMs: number
  private readonly sessions = new Map<string, { expiresAt: number; origin: string }>()

  constructor(options: { pairingCode?: string; ttlSeconds?: number } = {}) {
    this.pairingCode = options.pairingCode ?? process.env.BLENDPROOF_PAIRING_CODE ?? randomBytes(24).toString('base64url')
    const configuredTtl = options.ttlSeconds ?? Number(process.env.BLENDPROOF_SESSION_TTL_SECONDS)
    this.ttlMs = Math.max(1, Math.floor((Number.isFinite(configuredTtl) && configuredTtl > 0 ? configuredTtl : DEFAULT_BRIDGE_SESSION_TTL_SECONDS) * 1_000))
  }

  pair(candidate: unknown, origin: string): BridgePairingSession | null {
    if (typeof candidate !== 'string' || !this.matches(candidate, this.pairingCode)) return null
    this.prune()
    const nonce = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + this.ttlMs
    this.sessions.set(nonce, { expiresAt, origin })
    while (this.sessions.size > 128) this.sessions.delete(this.sessions.keys().next().value!)
    return { nonce, expiresAt }
  }

  isValid(nonce: string | undefined, origin: string): boolean {
    if (!nonce || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) return false
    const session = this.sessions.get(nonce)
    if (!session) return false
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(nonce)
      return false
    }
    return session.origin === origin
  }

  private prune() {
    const now = Date.now()
    for (const [nonce, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(nonce)
  }

  private matches(left: string, right: string) {
    const leftBytes = Buffer.from(left)
    const rightBytes = Buffer.from(right)
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
  }
}
