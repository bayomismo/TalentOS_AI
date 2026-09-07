/**
 * Sprint 17 — encryption helpers for integration secrets.
 *
 * AES-256-GCM with a key derived from INTEGRATION_ENCRYPTION_KEY env
 * var. The stored format is `iv:ciphertext:tag`, all base64.
 *
 * The key must be 32 bytes. We support:
 *   - 64 hex chars (e.g. openssl rand -hex 32)
 *   - 44 base64 chars (e.g. openssl rand -base64 32)
 *
 * If unset, encrypt() throws. This is intentional — running without
 * a key would silently store plaintext tokens.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

function loadKey(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'INTEGRATION_ENCRYPTION_KEY is not set. Set it to 32 random bytes (hex or base64). ' +
      'Generate with: openssl rand -hex 32',
    )
  }
  // Accept hex (64 chars) or base64
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  try {
    const b = Buffer.from(raw, 'base64')
    if (b.length === 32) return b
  } catch {}
  // Last resort: hash it to 32 bytes
  return createHash('sha256').update(raw).digest()
}

export function encryptToken(plain: string): string {
  const key = loadKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${enc.toString('base64')}:${tag.toString('base64')}`
}

export function decryptToken(stored: string): string {
  const key = loadKey()
  const [ivB64, encB64, tagB64] = stored.split(':')
  if (!ivB64 || !encB64 || !tagB64) throw new Error('Malformed encrypted token')
  const iv = Buffer.from(ivB64, 'base64')
  const enc = Buffer.from(encB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(enc), decipher.final()])
  return dec.toString('utf8')
}
