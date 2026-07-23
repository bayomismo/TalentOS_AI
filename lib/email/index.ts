/**
 * Sprint 16 — Email provider factory + send helper.
 *
 * One place to pick the provider based on env. Today there is only
 * one provider (LocalOutboxProvider). When Resend (or any other
 * service) is configured, this is the only file that changes.
 *
 * Selection rules (in order):
 *   1. If `EMAIL_PROVIDER=resend` AND `RESEND_API_KEY` is set, use
 *      the Resend provider. (Sprint 18.)
 *   2. Otherwise, use the local outbox provider.
 *
 * `sendEmail()` is the only function the rest of the app should
 * call. It is intentionally tiny so call sites read like normal
 * function calls, not provider-aware code.
 */

import { LocalOutboxProvider } from './local-outbox'
import type { EmailMessage, EmailProvider, EmailSendResult } from './types'

let cached: EmailProvider | null = null

function resolveProvider(): EmailProvider {
  if (cached) return cached
  // const providerName = process.env.EMAIL_PROVIDER
  // if (providerName === 'resend' && process.env.RESEND_API_KEY) {
  //   // Lazy import so the Resend SDK is not bundled in dev/test.
  //   const { ResendProvider } = require('./resend')
  //   cached = new ResendProvider()
  //   return cached
  // }
  cached = new LocalOutboxProvider()
  return cached
}

export async function sendEmail(
  msg: Omit<EmailMessage, 'kind'> & { kind: string },
): Promise<EmailSendResult> {
  const provider = resolveProvider()
  return provider.send({ ...msg })
}

/** Test-only: force a different provider (used by vitest / tsx scripts). */
export function __setEmailProviderForTests(p: EmailProvider | null) {
  cached = p
}

export type { EmailMessage, EmailProvider, EmailSendResult }
