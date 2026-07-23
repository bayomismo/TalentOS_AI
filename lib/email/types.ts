/**
 * Sprint 16 — Email types.
 *
 * The `EmailProvider` interface is the seam between the rest of the
 * app and the underlying delivery mechanism. Two implementations:
 *   - `LocalOutboxProvider` writes to the `EmailOutbox` table. Always
 *     available, no external dependency, used in dev / test / any
 *     environment without a real email service configured.
 *   - `ResendProvider` (Sprint 18) will deliver via the Resend API.
 *
 * The interface is intentionally tiny so a third provider (SES, Postmark,
 * SendGrid) can be added by writing one file.
 */

export type EmailAddress = string

export interface EmailMessage {
  /** Logical id for the message type — used by the outbox to dedupe and
   *  by analytics to group. Examples: 'team_invitation',
   *  'password_reset', 'offer_letter', 'interview_reminder'. */
  kind: string
  to: EmailAddress
  /** Optional override for "From". Defaults come from the provider. */
  from?: EmailAddress
  subject: string
  /** Plain-text body. Always required. */
  text: string
  /** Optional HTML body. When provided, providers that can send
   *  multipart will use it; providers that can't will fall back to text. */
  html?: string
  /** Free-form metadata for the outbox (e.g. the invitation id, the
   *  reset-request id). Never logged with the body. */
  metadata?: Record<string, string>
}

export interface EmailSendResult {
  /** Provider-specific message id (e.g. Resend id, or our outbox uuid). */
  id: string
  /** True when the provider accepted the message for delivery.
   *  Local outbox returns `true` after a successful insert. */
  accepted: boolean
}

export interface EmailProvider {
  readonly name: string
  send(msg: EmailMessage): Promise<EmailSendResult>
}
