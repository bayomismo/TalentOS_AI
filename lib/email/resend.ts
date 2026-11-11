/**
 * Sprint 19 — ResendProvider.
 *
 * Delivers email through the Resend HTTP API. Implemented with the
 * platform `fetch` — no SDK dependency is added to the project.
 *
 * Endpoint: POST https://api.resend.com/emails
 * Auth:     Authorization: Bearer <RESEND_API_KEY>
 *
 * Audit P0-03: the Resend branch of `lib/email/index.ts` was entirely
 * commented out, so every email in the product — public-application
 * alerts, team invitations, password resets, offer letters, interview
 * reminders — landed in a `PENDING` outbox row that nothing ever sent.
 * This provider is the real delivery path.
 *
 * FAILURE POLICY: a provider-level failure (non-2xx response, network
 * error) is RETURNED as a failed result, never thrown, so a single bad
 * address can never crash the request that triggered the send. The
 * failure carries the provider status code and Resend's error body so
 * it is actionable instead of silent.
 *
 * The API key is read from the environment and is never logged, never
 * persisted and never included in an error message.
 */

import type { EmailMessage, EmailProvider, EmailSendResult } from './types'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export interface ResendSendResult extends EmailSendResult {
  /**
   * 'delivered' — Resend accepted the message for delivery.
   * 'failed'    — Resend rejected it (see `error`).
   */
  delivery: 'delivered' | 'failed'
  /** Failure detail: the provider status code and Resend's error body. */
  error?: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export class ResendProvider implements EmailProvider {
  readonly name = 'resend'

  private readonly apiKey: string
  /** Sender used when the message itself does not carry one. */
  private readonly defaultFrom?: string

  constructor(apiKey: string, defaultFrom?: string) {
    this.apiKey = apiKey
    this.defaultFrom = defaultFrom
  }

  async send(msg: EmailMessage): Promise<ResendSendResult> {
    if (!msg.to) throw new Error('EmailMessage.to is required')
    if (!msg.subject) throw new Error('EmailMessage.subject is required')
    if (!msg.text) throw new Error('EmailMessage.text is required')

    const from = msg.from ?? this.defaultFrom
    if (!from) {
      return {
        id: '',
        accepted: false,
        delivery: 'failed',
        error:
          'Resend requires a sender address. Set EMAIL_FROM (e.g. "TalentOS <noreply@yourdomain.com>") or pass `from` on the message.',
      }
    }

    const payload = {
      from,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html ?? `<pre>${escapeHtml(msg.text)}</pre>`,
      text: msg.text,
    }

    let response: Response
    try {
      response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      // Network / DNS / TLS failure — a failed result, not an exception.
      return {
        id: '',
        accepted: false,
        delivery: 'failed',
        error: `Resend request failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return {
        id: '',
        accepted: false,
        delivery: 'failed',
        error: `Resend API returned ${response.status}: ${body}`,
      }
    }

    let payloadId = ''
    try {
      const data = (await response.json()) as { id?: string }
      payloadId = data.id ?? ''
    } catch {
      // A 2xx with an unreadable body is still a delivery.
    }

    return { id: payloadId, accepted: true, delivery: 'delivered' }
  }
}
