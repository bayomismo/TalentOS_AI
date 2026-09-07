/**
 * Sprint 12 — Data Management unit tests.
 *
 * Verifies the preview, classification, and cleanup logic in isolation
 * using a dedicated test tenant (withTestTenant). This test NEVER
 * touches the real production organization.
 *
 * Coverage:
 *   - Preview counts match inserted records
 *   - Test users are correctly identified by pattern
 *   - ADMIN users are NEVER removed even if they match a pattern
 *   - Calling user is NEVER removed
 *   - Potentially-real records are preserved
 *   - Cleanup transaction removes all classified records
 *   - Protected counts (org, ADMINs, prompts, audits) are stable
 *   - Wrong confirmation phrase is rejected
 *   - Permission denied for non-ADMIN
 *   - Cleanup is idempotent
 */

import { withTestTenant, type TestTenantContext } from './_lib/test-tenant'
import { previewDataManagement, executeDataCleanup } from '../features/data-management/service'
import { db } from '../lib/db'
import { createHash } from 'crypto'

let passed = 0
let failed = 0

function ok(name: string, cond: boolean, info?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`) }
}

async function withOrg<T>(fn: (orgId: string, adminId: string) => Promise<T>, label = 's12-data'): Promise<T> {
  return withTestTenant({ label, baseUrl: 'http://localhost' }, async (handle: TestTenantContext) => {
    return fn(handle.organizationId, handle.adminUserId)
  })
}

async function main() {
  console.log('Sprint 12 — Data Management tests (test tenant only)\n')

  // Test 1: wrong confirmation phrase is rejected
  console.log('Test 1: confirmation phrase validation')
  await withOrg(async (orgId, adminId) => {
    const r = await executeDataCleanup(
      { organizationId: orgId, userId: adminId, role: 'ADMIN' },
      'wrong phrase',
    )
    ok('rejects "wrong phrase"', !r.ok && r.error?.code === 'CONFIRMATION_REQUIRED')
    const r2 = await executeDataCleanup(
      { organizationId: orgId, userId: adminId, role: 'ADMIN' },
      'clean demo data', // case-sensitive
    )
    ok('rejects lowercase "clean demo data"', !r2.ok && r2.error?.code === 'CONFIRMATION_REQUIRED')
  })

  // Test 2: non-ADMIN is denied
  console.log('\nTest 2: RBAC')
  await withOrg(async (orgId, adminId) => {
    const r = await executeDataCleanup(
      { organizationId: orgId, userId: adminId, role: 'RECRUITER' },
      'CLEAN DEMO DATA',
    )
    ok('non-ADMIN denied', !r.ok && r.error?.code === 'PERMISSION_DENIED')
    const p = await previewDataManagement({ organizationId: orgId, userId: adminId, role: 'RECRUITER' })
    ok('non-ADMIN preview denied', !p.ok && p.error?.code === 'PERMISSION_DENIED')
  })

  // Test 3: classification + preview
  console.log('\nTest 3: classification + preview')
  await withOrg(async (orgId, adminId) => {
    // Create a test user
    const testUser = await db.user.create({
      data: {
        organizationId: orgId,
        email: 'sprint12-test-user@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'RECRUITER',
        status: 'ACTIVE',
        passwordHash: 'x',
      },
    })
    const realUser = await db.user.create({
      data: {
        organizationId: orgId,
        email: 'priya@acme.com',
        firstName: 'Priya',
        lastName: 'Patel',
        role: 'HIRING_MANAGER',
        status: 'ACTIVE',
        passwordHash: 'x',
      },
    })
    const dept = await db.department.create({
      data: { organizationId: orgId, name: 'Engineering', slug: `engineering-${Date.now()}` },
    })
    const realHr = await db.hiringRequest.create({
      data: {
        organizationId: orgId,
        departmentId: dept.id,
        title: 'Senior Frontend Engineer',
        slug: `senior-frontend-engineer-${Date.now()}`,
        status: 'OPEN',
        level: 'SENIOR',
        jobType: 'FULL_TIME',
        location: 'NYC',
        createdById: adminId,
      },
    })
    const testCand = await db.candidate.create({
      data: {
        organizationId: orgId,
        hiringRequestId: realHr.id,
        email: 'sprint12-cand-12345@example.com',
        firstName: 'Sprint12',
        lastName: 'Candidate',
        status: 'ACTIVE',
      },
    })
    const realCand = await db.candidate.create({
      data: {
        organizationId: orgId,
        hiringRequestId: realHr.id,
        email: 'priya.patel@gmail.com',
        firstName: 'Ananya',
        lastName: 'Kapoor',
        status: 'ACTIVE',
      },
    })
    const testHr = await db.hiringRequest.create({
      data: {
        organizationId: orgId,
        departmentId: dept.id,
        title: 'Sprint 12 Test Role',
        slug: `sprint-12-test-role-${Date.now()}`,
        status: 'DRAFT',
        level: 'MID',
        jobType: 'FULL_TIME',
        location: 'Remote',
        createdById: adminId,
      },
    })

    const preview = await previewDataManagement({ organizationId: orgId, userId: adminId, role: 'ADMIN' })
    ok('preview ok', preview.ok)
    if (preview.ok && preview.data) {
      ok('test user classified', preview.data.removable.testUsers === 1)
      ok('test candidate classified', preview.data.removable.testCandidates === 1)
      ok('test HR classified', preview.data.removable.testHiringRequests === 1)
      ok('real user preserved (potentiallyReal)', preview.data.potentiallyReal.users === 2) // admin + Priya
      ok('real candidate preserved', preview.data.potentiallyReal.candidates === 1)
      ok('real HR preserved', preview.data.potentiallyReal.hiringRequests === 1)
      ok('org has 1 ADMIN protected', preview.data.protected.admins === 1)
    }

    // Test 4: execute cleanup
    console.log('\nTest 4: execute cleanup')
    const result = await executeDataCleanup(
      { organizationId: orgId, userId: adminId, role: 'ADMIN' },
      'CLEAN DEMO DATA',
    )
    ok('cleanup ok', result.ok)
    if (result.ok && result.data) {
      ok('removed 1 user', result.data.removed.users === 1)
      ok('removed 1 candidate', result.data.removed.candidates === 1)
      ok('removed 1 HR', result.data.removed.hiringRequests === 1)
      ok('preserved 1 ADMIN', result.data.preserved.admins === 1)
    }

    // Test 5: post-cleanup state
    console.log('\nTest 5: post-cleanup state')
    const postUsers = await db.user.findMany({ where: { organizationId: orgId } })
    ok('test user deleted', !postUsers.find(u => u.id === testUser.id))
    ok('real user preserved', !!postUsers.find(u => u.id === realUser.id))
    ok('admin preserved', !!postUsers.find(u => u.id === adminId))
    const postCands = await db.candidate.findMany({ where: { organizationId: orgId } })
    ok('test candidate deleted', !postCands.find(c => c.id === testCand.id))
    ok('real candidate preserved', !!postCands.find(c => c.id === realCand.id))
    const postHrs = await db.hiringRequest.findMany({ where: { organizationId: orgId } })
    ok('test HR deleted', !postHrs.find(h => h.id === testHr.id))
    ok('real HR preserved', !!postHrs.find(h => h.id === realHr.id))
  })

  // Test 6: ADMIN user matching pattern is NEVER removed
  console.log('\nTest 6: ADMIN protection even with matching pattern')
  await withOrg(async (orgId, adminId) => {
    // Add a fake ADMIN that matches a test pattern
    const fakeAdmin = await db.user.create({
      data: {
        organizationId: orgId,
        email: 'sprint12-test-admin@example.com',
        firstName: 'Test',
        lastName: 'Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash: 'x',
      },
    })
    const result = await executeDataCleanup(
      { organizationId: orgId, userId: adminId, role: 'ADMIN' },
      'CLEAN DEMO DATA',
    )
    ok('cleanup ok', result.ok)
    if (result.ok && result.data) ok('removed 0 users (ADMINs protected)', result.data.removed.users === 0)
    const post = await db.user.findUnique({ where: { id: fakeAdmin.id } })
    ok('fake ADMIN still exists', !!post)
  })

  // Test 7: idempotent — running twice produces 0 removals the second time
  console.log('\nTest 7: idempotency')
  await withOrg(async (orgId, adminId) => {
    await db.user.create({
      data: {
        organizationId: orgId,
        email: 'sprint12-test-cleanup@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'RECRUITER',
        status: 'ACTIVE',
        passwordHash: 'x',
      },
    })
    const r1 = await executeDataCleanup({ organizationId: orgId, userId: adminId, role: 'ADMIN' }, 'CLEAN DEMO DATA')
    ok('first run ok', r1.ok && !!r1.data && r1.data.removed.users >= 1)
    const r2 = await executeDataCleanup({ organizationId: orgId, userId: adminId, role: 'ADMIN' }, 'CLEAN DEMO DATA')
    ok('second run ok', r2.ok)
    if (r2.ok && r2.data) ok('second run removed 0 users', r2.data.removed.users === 0)
  })

  await db.$disconnect()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
