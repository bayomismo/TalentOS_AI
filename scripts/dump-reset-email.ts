/**
 * Dump the most recent password-reset email for inspection.
 */
import 'dotenv/config'
import { db } from '../lib/db'
import { newPasswordResetToken, passwordResetTokenExpiry } from '../lib/auth/password-reset'
import { sendEmail } from '../lib/email'
import { passwordResetEmail } from '../lib/email/templates'
import { randomBytes } from 'node:crypto'

async function main() {
  const admin = await db.user.findUnique({ where: { email: 'bayomismo@gmail.com' } })
  if (!admin) { console.log('admin not found'); return }

  // Create a token manually so we can log the link
  const { token, tokenPrefix, tokenHash } = newPasswordResetToken()
  await db.passwordResetToken.create({
    data: {
      userId: admin.id,
      tokenHash,
      tokenPrefix,
      expiresAt: passwordResetTokenExpiry(),
    },
  })

  const tpl = passwordResetEmail({
    to: admin.email,
    firstName: admin.firstName,
    token,
    ttlMinutes: 60,
  })
  await sendEmail({
    kind: 'password_reset',
    to: admin.email,
    from: tpl.from,
    subject: tpl.subject,
    text: tpl.text,
    html: tpl.html,
  })

  console.log('\n=== SUBJECT ===')
  console.log(tpl.subject)
  console.log('\n=== TEXT (plain) ===')
  console.log(tpl.text)
  console.log('\n=== Reset link (extracted) ===')
  const match = tpl.text.match(/https?:\/\/[^\s]+#token=[A-Za-z0-9_-]+/)
  if (match) {
    console.log(match[0])
    console.log(`\nToken (first 12 chars): ${token.slice(0, 12)}...`)
  }
  console.log('\n=== HTML (first 2000 chars) ===')
  console.log(tpl.html.slice(0, 2000))

  // Cleanup
  await db.passwordResetToken.deleteMany({ where: { userId: admin.id, tokenHash } })
  // Find and delete the most recent outbox email
  const lastEmail = await db.emailOutbox.findFirst({
    where: { kind: 'password_reset', to: admin.email },
    orderBy: { createdAt: 'desc' },
  })
  if (lastEmail) await db.emailOutbox.delete({ where: { id: lastEmail.id } })
}
main().catch(console.error)
