/**
 * Sprint 12 — Production blocker fix tests.
 *
 * Verifies:
 *   1. Canonical URL helper refuses preview hostnames in production
 *   2. Canonical URL helper falls back to localhost in dev
 *   3. Invitation URL builder uses canonical APP_URL
 *   4. Business reset preview shows correct counts
 *   5. Business reset deletes all operational data
 *   6. Business reset preserves organization, users, departments,
 *      prompt templates, and audit logs
 *   7. Wrong confirmation phrase is rejected
 *   8. Cross-tenant reset is impossible (ctx.organizationId only)
 */

import { withTestTenant, type TestTenantContext } from './_lib/test-tenant'
import {
  previewBusinessReset,
  executeBusinessReset,
} from '../features/data-management/service'
import {
  buildAcceptInviteUrl,
  getAppUrl,
} from '../lib/url/canonical'
import { db } from '../lib/db'
import { hashPassword } from '../lib/auth/password'

let passed = 0
let failed = 0

function ok(name: string, cond: boolean, info?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`) }
}

async function main() {
  console.log('Sprint 12 — Production blocker fix tests\n')

  // ===========================================================================
  // Block 1: Canonical URL behaviour
  // ===========================================================================
  console.log('A. Canonical URL behaviour')

  // Save and clear NODE_ENV / APP_URL to test
  const origNodeEnv = process.env.NODE_ENV
  const origAppUrl = process.env.APP_URL

  ;(process.env as any).NODE_ENV = 'production'
  delete process.env.APP_URL
  let threw = false
  try { getAppUrl() } catch (e) { threw = true }
  ok('throws when APP_URL is unset in production', threw)
  process.env.APP_URL = 'https://talentos-j90knwufr-bayomismo.vercel.app'
  threw = false
  try { getAppUrl() } catch (e) { threw = true; console.log('  expected error:', (e as Error).message.slice(0, 80)) }
  ok('throws when APP_URL is a Vercel preview hostname', threw)
  process.env.APP_URL = 'https://talentos-ai-lime.vercel.app'
  const u = getAppUrl()
  ok('returns canonical URL when APP_URL is correct', u === 'https://talentos-ai-lime.vercel.app')
  // Build invitation URL
  const link = buildAcceptInviteUrl('abc123')
  ok('buildAcceptInviteUrl uses canonical host', link.startsWith('https://talentos-ai-lime.vercel.app/accept-invite#token='))
  ok('buildAcceptInviteUrl contains encoded token', link.includes('token=abc123'))

  // Dev fallback
  ;(process.env as any).NODE_ENV = 'development'
  delete process.env.APP_URL
  const devUrl = getAppUrl()
  ok('dev fallback returns localhost', devUrl === 'http://localhost:3000')

  // Restore
  if (origNodeEnv) (process.env as any).NODE_ENV = origNodeEnv
  if (origAppUrl) process.env.APP_URL = origAppUrl

  // ===========================================================================
  // Block 2: Business reset
  // ===========================================================================
  console.log('\nB. Business reset')

  await withTestTenant({ label: 's12-reset', baseUrl: 'http://localhost' }, async (ctx: TestTenantContext) => {
    // Set up org with operational data
    const passwordHash = await hashPassword(ctx.adminPassword)
    await db.user.update({ where: { id: ctx.adminUserId }, data: { passwordHash } })
    const dept = await db.department.create({
      data: { organizationId: ctx.organizationId, name: 'Eng', slug: `eng-${Date.now()}` },
    })
    const hr = await db.hiringRequest.create({
      data: {
        organizationId: ctx.organizationId, departmentId: dept.id,
        title: 'Reset Test HR', slug: `reset-test-${Date.now()}`,
        status: 'OPEN', level: 'MID', jobType: 'FULL_TIME',
        location: 'Remote', createdById: ctx.adminUserId,
      },
    })
    const cand = await db.candidate.create({
      data: {
        organizationId: ctx.organizationId, hiringRequestId: hr.id,
        email: `reset-cand-${Date.now()}@example.com`,
        firstName: 'R', lastName: 'C', status: 'ACTIVE',
      },
    })
    const intv = await db.interview.create({
      data: {
        organizationId: ctx.organizationId, hiringRequestId: hr.id, candidateId: cand.id,
        type: 'PHONE_SCREEN', title: 'Test Interview',
        scheduledAt: new Date(), durationMinutes: 60, status: 'SCHEDULED',
      },
    })
    const offer = await db.offer.create({
      data: {
        organizationId: ctx.organizationId, hiringRequestId: hr.id, candidateId: cand.id,
        status: 'DRAFT', title: 'Test Offer', salaryAmount: 100000, salaryCurrency: 'USD',
      },
    })
    const act = await db.activity.create({
      data: {
        organizationId: ctx.organizationId,
        type: 'CANDIDATE_ADDED', title: 'Reset test activity',
      },
    })
    const pt = await db.promptTemplate.create({
      data: {
        organization: { connect: { id: ctx.organizationId } },
        name: 'Reset Test PT', category: 'JOB_DESCRIPTION', body: 'x', variables: '{}',
      },
    })
    const al = await db.auditLog.create({
      data: {
        organization: { connect: { id: ctx.organizationId } },
        actor: { connect: { id: ctx.adminUserId } },
        action: 'TEST_LOG' as any, outcome: 'success',
      },
    })

    // B.1: Preview counts match reality
    const preview = await previewBusinessReset({
      organizationId: ctx.organizationId, userId: ctx.adminUserId, role: 'ADMIN',
    })
    ok('preview ok', preview.ok)
    if (preview.ok && preview.data) {
      ok('preview shows 1 HR', preview.data.toDelete.hiringRequests === 1)
      ok('preview shows 1 candidate', preview.data.toDelete.candidates === 1)
      ok('preview shows 1 interview', preview.data.toDelete.interviews === 1)
      ok('preview shows 1 offer', preview.data.toDelete.offers === 1)
      ok('preview shows 1 activity', preview.data.toDelete.activities === 1)
      ok('preview shows 1 prompt template (preserved)', preview.data.preserved.promptTemplates === 1)
      ok('preview shows 1 audit log (preserved)', preview.data.preserved.auditLogs === 1)
      ok('preview shows 1 department (preserved)', preview.data.preserved.departments === 1)
      ok('preview shows 1 user (preserved)', preview.data.preserved.totalUsers === 1)
    }

    // B.2: Wrong phrase rejected
    const wrong = await executeBusinessReset({
      organizationId: ctx.organizationId, userId: ctx.adminUserId, role: 'ADMIN',
    }, 'wrong')
    ok('wrong phrase rejected', !wrong.ok && wrong.error?.code === 'CONFIRMATION_REQUIRED')

    // B.3: Non-ADMIN rejected
    const deny = await executeBusinessReset({
      organizationId: ctx.organizationId, userId: ctx.adminUserId, role: 'RECRUITER',
    }, 'RESET TALENT DATA')
    ok('non-ADMIN rejected', !deny.ok && deny.error?.code === 'PERMISSION_DENIED')

    // B.4: Execute reset
    const result = await executeBusinessReset({
      organizationId: ctx.organizationId, userId: ctx.adminUserId, role: 'ADMIN',
    }, 'RESET TALENT DATA')
    ok('execute ok', result.ok)
    if (result.ok && result.data) {
      ok('deleted 1 HR', result.data.deleted.hiringRequests === 1)
      ok('deleted 1 candidate', result.data.deleted.candidates === 1)
      ok('deleted 1 interview', result.data.deleted.interviews === 1)
      ok('deleted 1 offer', result.data.deleted.offers === 1)
      ok('deleted 1 activity', result.data.deleted.activities === 1)
      ok('preserved 1 prompt template', result.data.preserved.promptTemplates === 1)
      ok('preserved 1 audit log', result.data.preserved.auditLogs === 1)
    }

    // B.5: Verify actual DB state
    const postHrs = await db.hiringRequest.count({ where: { organizationId: ctx.organizationId } })
    const postCands = await db.candidate.count({ where: { organizationId: ctx.organizationId } })
    const postIntvs = await db.interview.count({ where: { organizationId: ctx.organizationId } })
    const postOffers = await db.offer.count({ where: { organizationId: ctx.organizationId } })
    const postActs = await db.activity.count({ where: { organizationId: ctx.organizationId } })
    ok('DB: 0 HRs', postHrs === 0)
    ok('DB: 0 candidates', postCands === 0)
    ok('DB: 0 interviews', postIntvs === 0)
    ok('DB: 0 offers', postOffers === 0)
    ok('DB: 0 activities', postActs === 0)
    const postOrg = await db.organization.findUnique({ where: { id: ctx.organizationId } })
    ok('Organization preserved', !!postOrg)
    const postUser = await db.user.findUnique({ where: { id: ctx.adminUserId } })
    ok('Admin preserved', !!postUser && postUser.role === 'ADMIN')
    const postDept = await db.department.findUnique({ where: { id: dept.id } })
    ok('Department preserved', !!postDept)
    const postPt = await db.promptTemplate.findUnique({ where: { id: pt.id } })
    ok('PromptTemplate preserved', !!postPt)
    const postAl = await db.auditLog.findUnique({ where: { id: al.id } })
    ok('AuditLog preserved', !!postAl)
    // Plus the new DATA_RESET_EXECUTED log
    const resetLogs = await db.auditLog.count({
      where: { organizationId: ctx.organizationId, action: 'DATA_RESET_EXECUTED' as any },
    })
    ok('DATA_RESET_EXECUTED audit log created', resetLogs === 1)

    // B.6: After reset, second reset is a no-op
    const result2 = await executeBusinessReset({
      organizationId: ctx.organizationId, userId: ctx.adminUserId, role: 'ADMIN',
    }, 'RESET TALENT DATA')
    ok('idempotent: second reset ok', result2.ok)
    if (result2.ok && result2.data) {
      ok('idempotent: 0 records deleted second time',
        result2.data.deleted.hiringRequests === 0 &&
        result2.data.deleted.candidates === 0 &&
        result2.data.deleted.interviews === 0 &&
        result2.data.deleted.offers === 0 &&
        result2.data.deleted.activities === 0)
    }
  })

  // ===========================================================================
  // Block 3: Cross-tenant isolation
  // ===========================================================================
  console.log('\nC. Cross-tenant isolation')
  await withTestTenant({ label: 's12-iso', baseUrl: 'http://localhost' }, async (ctx: TestTenantContext) => {
    // Create another org with data
    const other = await withTestTenant({ label: 's12-iso-other', baseUrl: 'http://localhost' }, async (o) => o)
    // Try to reset THIS org using OTHER org's admin
    const wrong = await executeBusinessReset({
      organizationId: other.organizationId, userId: ctx.adminUserId, role: 'ADMIN',
    }, 'RESET TALENT DATA')
    ok('cross-tenant denied (other org admin not in this org)', !wrong.ok)
  })

  await db.$disconnect()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
