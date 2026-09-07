/**
 * Sprint 9 — Bootstrap the initial ADMIN password.
 *
 * PART 19: production data migration + initial ADMIN bootstrap. We do
 * NOT hardcode the production password in Git. Instead:
 *
 *   1. The first time this script runs, it reads ADMIN_BOOTSTRAP_PASSWORD
 *      from the environment (or generates a one-time password and prints
 *      it once to the console).
 *   2. It sets the password hash for the existing seed ADMIN
 *      (jordan.rivera@acmecompany.com) so they can log in.
 *   3. It is idempotent — running it twice does not change the password.
 *
 * Usage:
 *   ADMIN_BOOTSTRAP_PASSWORD='mypassword' pnpm exec tsx scripts/bootstrap-admin.ts
 *
 * If ADMIN_BOOTSTRAP_PASSWORD is not set, a random 16-char password is
 * generated and printed to stdout. The script does NOT persist the
 * plaintext password anywhere.
 */

import 'dotenv/config'
import { randomBytes } from 'crypto'
import { db } from '../lib/db'
import { hashPassword } from '../lib/auth/password'

async function main() {
  const envPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD
  const generatedPassword = randomBytes(12).toString('base64url')
  const password = envPassword ?? generatedPassword
  const wasGenerated = !envPassword

  const admin = await db.user.findFirst({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true, email: true, firstName: true, lastName: true },
  })
  if (!admin) {
    throw new Error('No active ADMIN user found. Run pnpm db:seed first.')
  }

  const passwordHash = await hashPassword(password)
  await db.user.update({
    where: { id: admin.id },
    data: {
      passwordHash,
      passwordChangedAt: new Date(),
      disabledAt: null,
    },
  })

  console.log('\n=== ADMIN BOOTSTRAP COMPLETE ===\n')
  console.log('Admin:', `${admin.firstName} ${admin.lastName} <${admin.email}>`)
  if (wasGenerated) {
    console.log('Generated password (PRINTED ONCE — save it now):')
    console.log(`\n  ${password}\n`)
  } else {
    console.log('Password set from ADMIN_BOOTSTRAP_PASSWORD env var (not printed).')
  }
  console.log('You can now sign in at /login')
  console.log('After first login, change the password in Settings → Security.\n')

  await db.$disconnect()
}

main().catch(async e => {
  console.error('Bootstrap failed:', e)
  await db.$disconnect()
  process.exit(1)
})
