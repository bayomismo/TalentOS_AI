/**
 * Sprint 16 — AI quota test.
 *
 * Tests:
 *  1. checkAiQuota: under limit → allowed, no warning
 *  2. checkAiQuota: at 80% → allowed with APPROACHING_LIMIT warning
 *  3. checkAiQuota: at 100% → denied with LIMIT_REACHED
 *  4. recordAiUsage: increments the count
 *  5. recordAiUsage: success=false rows don't count toward quota
 *  6. enforceAiQuota: a denied call still logs a usage row (success=false)
 *  7. getAiUsageSummary: returns correct by-feature breakdown
 *  8. Unlimited org (quota=-1): never denied
 *  9. Tenant isolation: another org's usage doesn't affect this org
 * 10. New month boundary: usage from before the 1st doesn't count
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { randomUUID } from 'node:crypto'
import {
  checkAiQuota,
  enforceAiQuota,
  recordAiUsage,
  recordAiFailure,
  getAiUsageSummary,
} from '../lib/ai/quota'

let pass = 0, fail = 0
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}

async function main() {
  console.log('AI quota test\n')

  // Create a clean test org
  const orgId = randomUUID()
  const email = `quota-test-${randomUUID().slice(0, 6)}@test.local`
  const passwordHash = '$2a$12$placeholder'
  await db.organization.create({
    data: { id: orgId, name: 'Quota Test Org', slug: `quota-test-${randomUUID().slice(0, 4)}`, onboardingStatus: 'COMPLETED' },
  })
  await db.user.create({
    data: {
      organizationId: orgId, email, firstName: 'Q', lastName: 'Test',
      role: 'ADMIN', passwordHash, emailVerified: new Date(), onboardingStatus: 'COMPLETED',
    },
  })

  // 1. Under limit
  const r1 = await checkAiQuota(orgId)
  ok('under limit: allowed', r1.allowed && r1.quota === 5000 && r1.used === 0)
  ok('under limit: no warning', r1.warning === null)

  // 4. recordAiUsage increments
  await recordAiUsage({ organizationId: orgId, feature: 'job_description' })
  await recordAiUsage({ organizationId: orgId, feature: 'job_description' })
  await recordAiUsage({ organizationId: orgId, feature: 'cv_analysis' })
  const r2 = await checkAiQuota(orgId)
  ok('after 3 records: used=3', r2.used === 3)
  ok('after 3 records: still under limit', r2.allowed)

  // 5. success=false doesn't count
  await recordAiFailure({ organizationId: orgId, feature: 'job_description' })
  await recordAiFailure({ organizationId: orgId, feature: 'job_description' })
  const r3 = await checkAiQuota(orgId)
  ok('failures not counted: still used=3', r3.used === 3)

  // 2. At 80% → warning
  await recordAiUsage({ organizationId: orgId, feature: 'job_description' }) // 4/5 = 80%
  await db.organization.update({ where: { id: orgId }, data: { aiMonthlyQuota: 5 } })
  const r4 = await checkAiQuota(orgId)
  ok('at 80% (4/5): allowed', r4.allowed)
  ok('at 80% (4/5): warning APPROACHING_LIMIT', r4.warning === 'APPROACHING_LIMIT')

  // 3. At 100% → denied
  await recordAiUsage({ organizationId: orgId, feature: 'job_description' })
  const r5 = await checkAiQuota(orgId)
  ok('at 100% (5/5): denied', !r5.allowed)
  ok('at 100% (5/5): reason LIMIT_REACHED', r5.reason === 'LIMIT_REACHED')
  ok('at 100% (5/5): has resetAt', r5.resetAt > new Date())

  // 6. enforceAiQuota on denied org: still logs the attempt
  const beforeCount = await db.aIUsage.count({ where: { organizationId: orgId, success: false, feature: 'copilot' } })
  const r6 = await enforceAiQuota(orgId, 'copilot')
  const afterCount = await db.aIUsage.count({ where: { organizationId: orgId, success: false, feature: 'copilot' } })
  ok('enforceAiQuota: refused when over limit', !r6.allowed)
  ok('enforceAiQuota: logged the denied attempt', afterCount === beforeCount + 1)

  // 7. getAiUsageSummary
  const r7 = await getAiUsageSummary(orgId)
  ok('summary: used=5', r7.used === 5)
  ok('summary: byFeature has job_description and cv_analysis',
    r7.byFeature.some(b => b.feature === 'job_description' && b.count === 4) &&
    r7.byFeature.some(b => b.feature === 'cv_analysis' && b.count === 1))
  ok('summary: has resetAt', !!r7.resetAt)

  // 8. Unlimited (quota=-1)
  await db.organization.update({ where: { id: orgId }, data: { aiMonthlyQuota: -1 } })
  const r8 = await checkAiQuota(orgId)
  ok('unlimited: allowed even with 5 used', r8.allowed && r8.quota === -1)

  // 9. Tenant isolation: create another org, verify its count is 0
  const otherOrgId = randomUUID()
  await db.organization.create({
    data: { id: otherOrgId, name: 'Other Org', slug: `other-${randomUUID().slice(0, 4)}`, onboardingStatus: 'COMPLETED' },
  })
  const r9 = await checkAiQuota(otherOrgId)
  ok('isolation: new org has used=0', r9.used === 0)

  // 10. Monthly boundary: insert an old-dated usage row, verify it's not counted
  await db.organization.update({ where: { id: orgId }, data: { aiMonthlyQuota: 5000 } })
  const oldDate = new Date()
  oldDate.setMonth(oldDate.getMonth() - 2)
  await db.aIUsage.create({
    data: { organizationId: orgId, feature: 'job_description', success: true, createdAt: oldDate },
  })
  const r10 = await checkAiQuota(orgId)
  ok('monthly boundary: old usage not counted', r10.used === 5)

  // Cleanup
  await db.aIUsage.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } })
  await db.user.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } })
  await db.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } })

  console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error('FATAL:', e); process.exit(1) })
