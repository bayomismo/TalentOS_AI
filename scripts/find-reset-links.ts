/**
 * Find the most recent password-reset links in the EmailOutbox.
 *
 * The link is in the email body — extract it with a regex.
 * Useful when a user says "I didn't get the email" and you
 * need to find the link to share manually.
 */
import 'dotenv/config'
import { db } from '../lib/db'

async function main() {
  const links = await db.emailOutbox.findMany({
    where: { kind: 'password_reset' },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      to: true,
      subject: true,
      text: true,
      createdAt: true,
    },
  })

  if (links.length === 0) {
    console.log('No password-reset emails in the outbox.')
    return
  }

  console.log(`Found ${links.length} recent password-reset email(s):\n`)
  for (const e of links) {
    const match = e.text.match(/https?:\/\/[^\s]+#token=[A-Za-z0-9_-]+/)
    console.log('─'.repeat(70))
    console.log(`To:       ${e.to}`)
    console.log(`Subject:  ${e.subject}`)
    console.log(`Sent:     ${e.createdAt.toISOString()}`)
    console.log(`Link:     ${match ? match[0] : '(not found in text)'}`)
  }
  console.log('─'.repeat(70))
}
main().catch(console.error)
