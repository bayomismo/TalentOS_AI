/**
 * Provision a new tenant + ADMIN user from the command line.
 *
 * Usage:
 *   npx tsx scripts/provision-tenant.ts <email> <password> <firstName> <lastName> <orgName>
 *
 * Example:
 *   npx tsx scripts/provision-tenant.ts ceo@acme.com 'Start123!!' Alex Doe 'Acme Corp'
 */
import 'dotenv/config'
import { db } from '../lib/db'
import { hashPassword } from '../lib/auth/password'
import { recordAuditLog } from '../lib/auth/audit'
import { randomUUID } from 'node:crypto'

async function main() {
  const [email, password, firstName, lastName, orgName] = process.argv.slice(2)
  if (!email || !password || !firstName || !lastName || !orgName) {
    console.error('Usage: provision-tenant <email> <password> <firstName> <lastName> <orgName>')
    process.exit(1)
  }

  // Check if user already exists
  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    console.error(`User ${email} already exists (in org ${existing.organizationId})`)
    process.exit(1)
  }

  // Create org + user in a transaction
  const orgId = randomUUID()
  const userId = randomUUID()
  const passwordHash = await hashPassword(password)
  const now = new Date()

  await db.$transaction([
    db.organization.create({
      data: {
        id: orgId,
        name: orgName,
        slug: orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) + '-' + randomUUID().slice(0, 4),
        onboardingStatus: 'PENDING',
        createdAt: now,
      },
    }),
    db.user.create({
      data: {
        id: userId,
        organizationId: orgId,
        email,
        firstName,
        lastName,
        role: 'ADMIN',
        passwordHash,
        passwordChangedAt: now,
        emailVerified: now,
        createdAt: now,
      },
    }),
  ])

  await recordAuditLog({
    organizationId: orgId,
    actorId: userId,
    action: 'TENANT_PROVISIONED' as never,
    targetType: 'organization',
    targetId: orgId,
    outcome: 'success',
    metadata: { email, orgName } as any,
  }).catch(() => null)

  console.log(`\n✅ Tenant provisioned\n`)
  console.log(`  Org ID:    ${orgId}`)
  console.log(`  Org name:  ${orgName}`)
  console.log(`  User ID:   ${userId}`)
  console.log(`  Email:     ${email}`)
  console.log(`  Role:      ADMIN`)
  console.log(`\n  Sign in at: https://talentos-ai-lime.vercel.app/login`)
  console.log(`  Then complete onboarding at: /onboarding/workspace\n`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
