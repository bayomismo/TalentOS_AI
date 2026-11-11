/**
 * Sprint 16 — Email provider factory + send helper.
 *
 * One place to pick the provider based on env. When Resend (or any other
 * service) is configured, this is the only file that changes.
 *
 * Selection rules (in order):
 *   1. If `EMAIL_PROVIDER=resend` AND `RESEND_API_KEY` is set, use
 *      the Resend provider.
 *   2. Otherwise, use the local outbox provider.
 *
 * `sendEmail()` is the only function the rest of the app should
 * call. It is intentionally tiny so call sites read like normal
 * function calls, not provider-aware code.
 *
 * Sprint 19 (audit P0-03): the Resend branch used to be commented out,
 * so the provider was unconditionally `LocalOutboxProvider` and every
 * email in the product was queued and never sent. The branch is live
 * again: set `EMAIL_PROVIDER=resend` and `RESEND_API_KEY` and mail
 * goes out through Resend. Without them the app degrades to the local
 * outbox — and `isEmailDeliveryConfigured()` reports that honestly, so
 * the UI can say "email is not being delivered" instead of pretending.
 */

import { LocalOutboxProvider } from './local-outbox'
import type { EmailMessage, EmailProvider, EmailSendResult } from './types'

/**
 * Where a message ended up.
 *   'delivered' — a real provider accepted it for delivery
 *   'queued'    — written to the local outbox; nothing was sent
 *   'failed'    — the provider rejected it (see `error`)
 */
export type EmailDeliveryState = 'delivered' | 'queued' | 'failed'

export interface EmailDeliveryResult extends EmailSendResult {
  delivery: EmailDeliveryState
  /** Failure detail: provider status code + provider error body. */
  error?: string
}

/**
 * A provider that reports where the message ended up. Both shipped
 * providers implement it.
 */
interface DeliveryProvider {
  readonly name: string
  send(msg: EmailMessage): Promise<EmailDeliveryResult>
}

let cached: DeliveryProvider | null = null
let testOverride: EmailProvider | null = null

/**
 * True ONLY when a real delivery provider is active. Use it to keep the
 * UI honest: when this is false, emails are queued in the outbox and
 * nobody receives them.
 */
export function isEmailDeliveryConfigured(): boolean {
  return (
    process.env.EMAIL_PROVIDER === 'resend' && Boolean(process.env.RESEND_API_KEY)
  )
}

/**
 * The name of the provider that will handle a send right now.
 */
export function getEmailProviderName(): 'resend' | 'local-outbox' {
  return isEmailDeliveryConfigured() ? 'resend' : 'local-outbox'
}

async function resolveProvider(): Promise<DeliveryProvider> {
  if (cached) return cached
  if (testOverride) {
    cached = adaptProvider(testOverride)
    return cached
  }
  const apiKey = process.env.RESEND_API_KEY
  if (process.env.EMAIL_PROVIDER === 'resend' && apiKey) {
    // Lazy dynamic import so the Resend provider is not bundled in
    // dev/test, and so a missing API key never loads it at all.
    const { ResendProvider } = await import('./resend')
    cached = new ResendProvider(apiKey, process.env.EMAIL_FROM)
    return cached
  }
  cached = new LocalOutboxProvider()
  return cached
}

/**
 * Wraps a provider that predates the `delivery` discriminator so the
 * result shape stays uniform. A provider that already reports a
 * delivery state keeps it.
 */
function adaptProvider(provider: EmailProvider): DeliveryProvider {
  return {
    name: provider.name,
    async send(msg: EmailMessage): Promise<EmailDeliveryResult> {
      const result = await provider.send(msg)
      const reported = result as Partial<EmailDeliveryResult>
      if (typeof reported.delivery === 'string') {
        return {
          id: result.id,
          accepted: result.accepted,
          delivery: reported.delivery,
          error: reported.error,
        }
      }
      return {
        id: result.id,
        accepted: result.accepted,
        delivery: result.accepted ? 'delivered' : 'failed',
      }
    },
  }
}

export async function sendEmail(
  msg: Omit<EmailMessage, 'kind'> & { kind: string },
): Promise<EmailDeliveryResult> {
  const provider = await resolveProvider()
  const result = await provider.send({ ...msg })
  if (result.delivery === 'failed') {
    // A provider failure must never be invisible. The message kind, the
    // recipient and the provider error are safe to log; the body is not.
    // eslint-disable-next-line no-console
    console.error(
      `[email] provider "${provider.name}" failed to deliver "${msg.kind}" to ${msg.to}: ${
        result.error ?? 'unknown error'
      }`,
    )
  }
  return result
}

/** Test-only: force a different provider (used by vitest / tsx scripts). */
export function __setEmailProviderForTests(p: EmailProvider | null) {
  testOverride = p
  cached = null
}

export type { EmailMessage, EmailProvider, EmailSendResult }
