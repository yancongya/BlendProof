export type UniversalProfileSource = { email?: unknown; name?: unknown; preferred_username?: unknown }
export type UniversalProfile = { email: string | null; displayName: string | null }

export function universalProfile(source: UniversalProfileSource): UniversalProfile {
  const rawEmail = typeof source.email === 'string' ? source.email.trim().toLowerCase() : ''
  const email = rawEmail.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null
  const rawName = typeof source.name === 'string' ? source.name.trim()
    : typeof source.preferred_username === 'string' ? source.preferred_username.trim() : ''
  const displayName = rawName && rawName.length <= 100 && !/[\u0000-\u001f\u007f]/.test(rawName) ? rawName : null
  return { email, displayName }
}
