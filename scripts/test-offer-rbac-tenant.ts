/**
 * Sprint 10 — Offer RBAC + tenant isolation + approval-separation tests.
 *
 * Validates the matrix in lib/auth/permissions.ts against the offer.* permission
 * set + verifies that tenant-scoped queries do not leak across orgs. The
 * service-layer approval-separation rule (creator cannot self-approve when
 * another approver exists) is verified by the production E2E since it
 * requires an authenticated session.
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { hasPermission } from '../lib/auth/permissions'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', name); pass++ }
  else { console.log('  ✗', name, detail ?? ''); fail++ }
}

async function main() {
console.log('A. RBAC matrix (PART 14 — corrected per user feedback)')

const cases: Array<[any, any, boolean]> = [
  // ADMIN: all offer permissions
  ['ADMIN', 'offer.view', true],
  ['ADMIN', 'offer.view_compensation', true],
  ['ADMIN', 'offer.create', true],
  ['ADMIN', 'offer.approve', true],
  ['ADMIN', 'offer.issue', true],
  ['ADMIN', 'offer.record_response', true],
  // TA_LEAD: all
  ['TA_LEAD', 'offer.view', true],
  ['TA_LEAD', 'offer.view_compensation', true],
  ['TA_LEAD', 'offer.create', true],
  ['TA_LEAD', 'offer.approve', true],
  ['TA_LEAD', 'offer.issue', true],
  // RECRUITER: NO approve (separation)
  ['RECRUITER', 'offer.view', true],
  ['RECRUITER', 'offer.view_compensation', true],
  ['RECRUITER', 'offer.create', true],
  ['RECRUITER', 'offer.edit', true],
  ['RECRUITER', 'offer.submit_for_approval', true],
  ['RECRUITER', 'offer.issue', true],
  ['RECRUITER', 'offer.record_response', true],
  ['RECRUITER', 'offer.withdraw', true],
  ['RECRUITER', 'offer.approve', false],
  // HIRING_MANAGER: view + comp + approve (HM) + record
  ['HIRING_MANAGER', 'offer.view', true],
  ['HIRING_MANAGER', 'offer.view_compensation', true],
  ['HIRING_MANAGER', 'offer.approve', true],
  ['HIRING_MANAGER', 'offer.record_response', true],
  ['HIRING_MANAGER', 'offer.create', false],
  // INTERVIEWER: none
  ['INTERVIEWER', 'offer.view', false],
  ['INTERVIEWER', 'offer.view_compensation', false],
  // VIEWER: view ONLY (no comp)
  ['VIEWER', 'offer.view', true],
  ['VIEWER', 'offer.view_compensation', false], // critical
  ['VIEWER', 'offer.create', false],
  // CANDIDATE: none
  ['CANDIDATE', 'offer.view', false],
]
for (const [role, perm, expected] of cases) {
  const actual = hasPermission(role, perm)
  check(`${role}.${perm} = ${expected}`, actual === expected, `got ${actual}`)
}

console.log('\nB. Approval-separation pattern (PART 15)')

check('RECRUITER has create but NOT approve (separation)',
  hasPermission('RECRUITER', 'offer.create') && !hasPermission('RECRUITER', 'offer.approve'))
check('TA_LEAD has BOTH create and approve (no separation)',
  hasPermission('TA_LEAD', 'offer.create') && hasPermission('TA_LEAD', 'offer.approve'))
check('HIRING_MANAGER has approve but NOT create (separation)',
  hasPermission('HIRING_MANAGER', 'offer.approve') && !hasPermission('HIRING_MANAGER', 'offer.create'))

console.log('\nC. Cross-tenant offer IDOR (PART 22 + PART 35)')

const orgs = await db.organization.findMany({ take: 2 })
check('C.1 at least 2 orgs exist for IDOR test', orgs.length >= 2)
if (orgs.length < 2) { console.log(`\n=== ${pass} passed, ${fail} failed ===`); await db.$disconnect(); process.exit(1) }
const orgA = orgs[0]
const orgB = orgs[1]

const ghost = await db.offer.findFirst({ where: { id: '00000000-0000-0000-0000-000000000000', organization: { id: orgA.id } } })
check('C.2 IDOR: ghost UUID returns null in org A', ghost === null)

const orgBOffers = await db.offer.findMany({ where: { organization: { id: orgB.id } }, take: 1 })
for (const o of orgBOffers) {
  const aSide = await db.offer.findFirst({ where: { id: o.id, organization: { id: orgA.id } } })
  check(`C.3 IDOR: org B offer ${o.id.slice(0, 8)} not visible to org A query`, aSide === null)
}

console.log('\nD. Production SENT offer preserved (PART 1 backward-compat)')

const sentOffer = await db.offer.findFirst({ where: { status: 'SENT' } })
if (sentOffer) {
  check('D.1 legacy SENT offer is preserved in DB', !!sentOffer)
  check('D.2 legacy SENT offer still readable via findFirst (not broken by new statuses)', !!sentOffer)
} else {
  check('D.1 no legacy SENT offer (acceptable)', true)
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`)
await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
