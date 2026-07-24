import { db } from '../lib/db'

async function main() {
  const tokens = await db.passwordResetToken.findMany({
    where: { usedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  console.log(`Found ${tokens.length} unused password-reset tokens:\n`)
  if (tokens.length === 0) {
    console.log('(none)')
    return
  }
  for (const t of tokens) {
    const user = await db.user.findUnique({ where: { id: t.userId }, select: { email: true } })
    const expired = t.expiresAt < new Date()
    console.log(`  email:    ${user?.email}`)
    console.log(`  created:  ${t.createdAt.toISOString()}`)
    console.log(`  expires:  ${t.expiresAt.toISOString()}`)
    console.log(`  status:   ${expired ? 'EXPIRED' : 'VALID'}`)
    console.log('')
  }
}
main().catch(console.error)
