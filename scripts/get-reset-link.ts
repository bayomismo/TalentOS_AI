import 'dotenv/config'
import { db } from '../lib/db'

async function main() {
  const recent = await db.emailOutbox.findMany({
    where: { kind: 'password_reset' },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })
  console.log(`\n=== Last ${recent.length} password_reset emails in outbox ===\n`)
  for (const e of recent) {
    const m = e.text.match(/(https?:\/\/[^\s]+)/)
    console.log(`To: ${e.to}`)
    console.log(`Subject: ${e.subject}`)
    console.log(`Created: ${e.createdAt.toISOString()}`)
    console.log(`Reset URL: ${m?.[1] ?? '(no URL found)'}`)
    console.log('---')
  }
}
main().catch(console.error)
