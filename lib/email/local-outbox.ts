/**
 * Sprint 16 — LocalOutboxProvider.
 *
 * Writes every outgoing message to the `EmailOutbox` table. This is the
 * default provider for dev, test, and any environment that hasn't
 * configured a real email service.
 *
 * Why an outbox instead of a console.log?
 *  - Tests can assert on it.
 *  - You can inspect what would have been sent in production (until a
 *    real provider is wired) via a SQL query or a Settings → Outbox
 *    page in a future sprint.
 *  - It survives across restarts so a misconfigured production deploy
 *    doesn't lose pending messages.
 *
 * To deliver outbox rows, the future `lib/email/deliver-outbox.ts` cron
 * job (Sprint 18) will sweep them and hand each one to the configured
 * real provider. Until then, rows just accumulate.
 */

import { db } from '@/lib/db'
import type { EmailMessage, EmailProvider, EmailSendResult } from './types'

export class LocalOutboxProvider implements EmailProvider {
  readonly name = 'local-outbox'

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    if (!msg.to) throw new Error('EmailMessage.to is required')
    if (!msg.subject) throw new Error('EmailMessage.subject is required')
    if (!msg.text) throw new Error('EmailMessage.text is required')

    const row = await db.emailOutbox.create({
      data: {
        kind: msg.kind,
        to: msg.to,
        fromAddr: msg.from ?? null,
        subject: msg.subject,
        text: msg.text,
        html: msg.html ?? null,
        metadata: msg.metadata ?? undefined,
        status: 'PENDING',
      },
      select: { id: true },
    })

    return { id: row.id, accepted: true }
  }
}
