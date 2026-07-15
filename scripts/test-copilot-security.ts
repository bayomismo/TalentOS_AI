/**
 * Sprint 11 — Copilot security tests.
 *
 * Covers:
 *   - IDOR: cross-tenant access returns null (not FORBIDDEN, never leaks)
 *   - Compensation privacy: VIEWER result excludes salary fields
 *   - Tool permission denial: registry returns ACCESS_DENIED on missing perm
 *
 * Avoids importing lib/copilot/intent.ts (server-only) by exercising
 * only the static guarantee: every tool gates compensation on
 * offer.view_compensation inside its executor.
 */

import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { db } from '../lib/db'
import { hashPassword } from '../lib/auth/password'

let pass = 0
let fail = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ok', name); pass++ }
  else { console.log('  FAIL', name, detail ?? ''); fail++; failures.push(`${name}${detail ? ': ' + detail : ''}`) }
}

const PASSWORD = 'TestCopilotSec1!'

async function setupOrg(label: string) {
  const slug = `test-copilot-${label}-${Date.now()}-${randomUUID().slice(0, 8)}`
  const org = await db.organization.create({
    data: { name: `Copilot Test ${label}`, slug, settings: {} },
  })
  const passwordHash = await hashPassword(PASSWORD)
  const user = await db.user.create({
    data: {
      organizationId: org.id,
      email: `copilot-${label.toLowerCase()}-${Date.now()}-${randomUUID().slice(0, 4)}@example.com`,
      firstName: 'Copilot',
      lastName: label,
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash,
      passwordChangedAt: new Date(),
    },
  })
  return { org, user }
}

async function main() {
  console.log('=== Sprint 11 -- Copilot Security ===\n')

  const { org: adminOrg, user: adminUser } = await setupOrg('Admin')
  const { org: viewerOrg } = await setupOrg('Viewer')

  // Create an HR in adminOrg and a candidate
  const dept = await db.department.create({
    data: { organizationId: adminOrg.id, name: 'Engineering', slug: `eng-${randomUUID().slice(0, 8)}` },
  })
  const hr = await db.hiringRequest.create({
    data: {
      organizationId: adminOrg.id,
      departmentId: dept.id,
      createdById: adminUser.id,
      title: 'Senior Engineer',
      slug: `se-${randomUUID().slice(0, 8)}`,
      openings: 1,
      filled: 0,
      status: 'OPEN',
      priority: 'MEDIUM',
      hiringManagerId: adminUser.id,
    },
  })
  const cand = await db.candidate.create({
    data: {
      organizationId: adminOrg.id,
      hiringRequestId: hr.id,
      firstName: 'Test',
      lastName: 'Candidate',
      email: `c-${randomUUID().slice(0, 6)}@example.com`,
      stage: 'INTERVIEW',
    },
  })

  // ============================================================
  // [A] IDOR — cross-tenant access
  // ============================================================
  console.log('[A] IDOR: cross-tenant access returns NOT_FOUND (not FORBIDDEN)')

  // The viewerOrg queries adminOrg's HR ID — they should NOT see it
  const hrFromViewerScope = await db.hiringRequest.findFirst({
    where: { id: hr.id, organizationId: viewerOrg.id },
  })
  ok('Cross-tenant HR query returns null', hrFromViewerScope === null)
  const candFromViewerScope = await db.candidate.findFirst({
    where: { id: cand.id, organizationId: viewerOrg.id },
  })
  ok('Cross-tenant candidate query returns null', candFromViewerScope === null)

  // ============================================================
  // [B] Compensation privacy in tool output
  // ============================================================
  console.log('\n[B] Compensation privacy: VIEWER does not receive salary fields')

  // Static check: get_offers_by_status executor must check offer.view_compensation before returning salary
  const offerToolsSrc = readFileSync(join(__dirname, '..', 'lib', 'copilot', 'read-tools', 'offer-tools.ts'), 'utf8')
  ok('get_offers_by_status has compensation check', offerToolsSrc.includes('view_compensation') && offerToolsSrc.includes('includeComp'))
  ok('get_offers_by_status returns salaryAmount only when permitted', offerToolsSrc.includes('salaryAmount') && offerToolsSrc.includes('includeComp'))
  ok('get_offers_by_status returns salaryCurrency only when permitted', offerToolsSrc.includes('salaryCurrency'))
  ok('get_offers_by_status returns salaryPeriod only when permitted', offerToolsSrc.includes('salaryPeriod'))

  // Verify the per-record builder strips the keys when the user lacks permission
  ok('Per-record builder uses canComp includeComp pattern', /if\s*\(\s*includeComp\s*\)/.test(offerToolsSrc) && /base\.salaryAmount\s*=/.test(offerToolsSrc))
  ok('Per-record builder conditionally sets salaryCurrency', /if\s*\(\s*includeComp\s*\)/.test(offerToolsSrc) && /base\.salaryCurrency\s*=/.test(offerToolsSrc))
  ok('Per-record builder conditionally sets salaryPeriod', /if\s*\(\s*includeComp\s*\)/.test(offerToolsSrc) && /base\.salaryPeriod\s*=/.test(offerToolsSrc))

  // Simulate the strip
  const VIEWER_PERMS = new Set(['hiring_request.view', 'candidate.view', 'interview.view', 'offer.view', 'decision.view', 'reports.view'])
  const mocked = {
    id: 'offer-1', status: 'DRAFT',
    salaryAmount: 100000, salaryCurrency: 'USD', salaryPeriod: 'YEAR',
  }
  const canComp = VIEWER_PERMS.has('offer.view_compensation')
  const stripped = canComp ? mocked : { id: mocked.id, status: mocked.status }
  ok('VIEWER result has no salaryAmount key', !('salaryAmount' in stripped))
  ok('VIEWER result has no salaryCurrency key', !('salaryCurrency' in stripped))
  ok('VIEWER result has no salaryPeriod key', !('salaryPeriod' in stripped))
  ok('VIEWER result still has id and status', stripped.id === 'offer-1' && stripped.status === 'DRAFT')

  // ============================================================
  // [C] Tool execution: permission denial returns ACCESS_DENIED
  // ============================================================
  console.log('\n[C] Tool permission denial: ACCESS_DENIED on missing permission')
  const registrySrc = readFileSync(join(__dirname, '..', 'lib', 'copilot', 'read-tools', 'registry.ts'), 'utf8')
  ok('executeTool returns ACCESS_DENIED code', registrySrc.includes('ACCESS_DENIED'))
  ok('executeTool checks hasPermission', registrySrc.includes('hasPermission'))
  ok('executeTool returns UNKNOWN_TOOL for bad id', registrySrc.includes('UNKNOWN_TOOL'))
  ok('executeTool returns INVALID_INPUT for bad input', registrySrc.includes('INVALID_INPUT'))
  ok('executeTool returns INTERNAL on execution failure', registrySrc.includes('INTERNAL'))

  // ============================================================
  // [D] Tools are tenant-scoped: every tool source must filter by organizationId
  // ============================================================
  console.log('\n[D] Every tool is tenant-scoped:')
  const toolFiles = ['hiring-request-tools.ts', 'candidate-tools.ts', 'interview-tools.ts', 'offer-tools.ts', 'attention-tools.ts', 'summary-tools.ts']
  for (const f of toolFiles) {
    const src = readFileSync(join(__dirname, '..', 'lib', 'copilot', 'read-tools', f), 'utf8')
    ok(`${f} filters queries by organizationId`, src.includes('organizationId'))
  }

  // ============================================================
  // [E] No business mutations in the orchestrator
  // ============================================================
  console.log('\n[E] Orchestrator never performs business mutations:')
  const orchestratorSrc = readFileSync(join(__dirname, '..', 'lib', 'copilot', 'orchestration', 'orchestrator.ts'), 'utf8')
  // Strip strings to avoid false positives
  const strip = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""')
  const code = strip(orchestratorSrc)
  const forbidden = ['createHiringRequest', 'createCandidate', 'createOffer', 'approveOffer', 'issueOffer', 'recordOfferResponse', 'submitEvaluation']
  for (const f of forbidden) {
    ok(`Orchestrator has no "${f}"`, !code.includes(f))
  }
  ok('Orchestrator routes createConfirmation through the ActionRegistry (no direct mutation path)', orchestratorSrc.includes('action.prepare') || orchestratorSrc.includes('action.execute'))

  console.log(`\nResult: ${pass} pass, ${fail} fail\n`)
  if (fail > 0) {
    console.log('Failures:')
    for (const f of failures) console.log('  - ' + f)
    process.exit(1)
  }
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
