/**
 * Audit Journey 1: Onboarding state.
 * Check every User in the DB — is their onboarding state consistent?
 * Are they on the right step? Is the Org they belong to consistent?
 */
import { db } from '../lib/db'

async function main() {
  console.log('=== Journey 1: Onboarding State Audit ===\n')

  // 1. All users with their onboarding state
  const users = await db.user.findMany({
    include: {
      organization: { select: { id: true, name: true, slug: true, onboardingStatus: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`Total users: ${users.length}`)
  console.log('')

  // 2. Group by status
  const byUserStatus: Record<string, number> = {}
  const byOrgStatus: Record<string, number> = {}
  for (const u of users) {
    byUserStatus[u.onboardingStatus] = (byUserStatus[u.onboardingStatus] ?? 0) + 1
    byOrgStatus[u.organization.onboardingStatus] = (byOrgStatus[u.organization.onboardingStatus] ?? 0) + 1
  }
  console.log('By user.onboardingStatus:', byUserStatus)
  console.log('By org.onboardingStatus:', byOrgStatus)
  console.log('')

  // 3. Look for inconsistencies
  const issues: string[] = []
  for (const u of users) {
    // User is COMPLETED but org isn't
    if (u.onboardingStatus === 'COMPLETED' && u.organization.onboardingStatus !== 'COMPLETED') {
      issues.push(`[MISMATCH] User ${u.email} is COMPLETED but org is ${u.organization.onboardingStatus}`)
    }
    // User is PENDING but org is COMPLETED (admin onboarded but user didn't finish)
    if (u.onboardingStatus !== 'COMPLETED' && u.organization.onboardingStatus === 'COMPLETED') {
      issues.push(`[MISMATCH] User ${u.email} is ${u.onboardingStatus} but org is COMPLETED`)
    }
    // Disabled user with COMPLETED onboarding (might be fine)
    if (u.disabledAt && u.role !== 'ADMIN') {
      // ok
    }
    // Role is CANDIDATE? (CANDIDATE is in the enum but not used)
    if (u.role === 'CANDIDATE') {
      issues.push(`[ROLE] User ${u.email} has role=CANDIDATE (not currently used)`)
    }
  }
  if (issues.length === 0) {
    console.log('✓ No onboarding state mismatches found')
  } else {
    console.log(`✗ Found ${issues.length} issues:`)
    issues.forEach(i => console.log(`  ${i}`))
  }
  console.log('')

  // 4. Last-ADMIN protection
  const adminsPerOrg = new Map<string, number>()
  for (const u of users) {
    if (u.role === 'ADMIN' && !u.disabledAt) {
      adminsPerOrg.set(u.organizationId, (adminsPerOrg.get(u.organizationId) ?? 0) + 1)
    }
  }
  console.log('Active ADMINs per org:')
  for (const [orgId, count] of adminsPerOrg) {
    if (count === 1) {
      const org = users.find(u => u.organizationId === orgId)?.organization
      console.log(`  [WARN] ${org?.name ?? orgId}: only 1 active ADMIN (last-admin protection matters here)`)
    } else {
      const org = users.find(u => u.organizationId === orgId)?.organization
      console.log(`  ✓ ${org?.name ?? orgId}: ${count} active ADMINs`)
    }
  }
  console.log('')

  // 5. Orgs without an admin
  const orgs = await db.organization.findMany()
  for (const org of orgs) {
    const adminCount = adminsPerOrg.get(org.id) ?? 0
    if (adminCount === 0) {
      console.log(`  [WARN] Org ${org.name} (${org.slug}) has 0 active ADMINs — orphan org?`)
    }
  }
}
main().catch(console.error)
