import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ReviewDatabase, ShareAccess, ShareAccessDecision } from './contracts.js'
import { isShareExpired } from './local-database.js'

export class LocalShareAccess implements ShareAccess {
  constructor(
    private readonly database: ReviewDatabase,
    private readonly secret: string,
  ) {}

  async resolve(token: string, cookieHeader?: string, enforcePassword = true): Promise<ShareAccessDecision> {
    if (!/^[a-f0-9]{32}$/.test(token)) return { status: 'missing' }
    const share = await this.database.findShare(token)
    if (!share) return { status: 'missing' }
    if (share.revokedAt) return { status: 'revoked' }
    if (isShareExpired(share.expiresAt)) return { status: 'expired' }
    if (enforcePassword && share.passwordProtected && !this.hasCookie(token, cookieHeader)) {
      return { status: 'password_required' }
    }
    return { status: 'allowed', share }
  }

  verifyPassword(token: string, password: string): Promise<boolean> {
    return this.database.verifySharePassword(token, password)
  }

  async createCookie(token: string, maxAgeSeconds = 86_400): Promise<string> {
    return `${this.cookieName(token)}=${this.cookieValue(token)}; HttpOnly; SameSite=Lax; Path=/api/shares/${token}; Max-Age=${maxAgeSeconds}`
  }

  hasCookie(token: string, cookieHeader?: string): boolean {
    const expected = this.cookieValue(token)
    const raw = cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${this.cookieName(token)}=`))
    const actual = raw?.slice(raw.indexOf('=') + 1) ?? ''
    if (!/^[a-f0-9]{64}$/.test(actual)) return false
    return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
  }

  private cookieName(token: string) {
    return `bp_access_${token.slice(0, 12)}`
  }

  private cookieValue(token: string) {
    return createHmac('sha256', this.secret).update(token).digest('hex')
  }
}
