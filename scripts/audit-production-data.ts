/**
 * Sprint: Production Readiness & Go-Live
 * PART 1 — Production data audit + classification.
 *
 * Inspect the current production database and classify all existing data
 * into:
 *   A. SYSTEM / CONFIGURATION DATA (organization, ADMIN, auth, etc.)
 *   B. DEMO / SEED DATA
 *   C. AUTOMATED TEST / E2E DATA
 *   D. POTENTIALLY REAL USER DATA
 *
 * Read-only: never mutates production.
 */

import 'dotenv/config'
import { db } from '../lib/db'

let pass = 0
let fail = 0
const failures: string[] = []

async function main() {
  console.log('=== Production Data Audit (Sprint 12 PART 1) ===\n')

  // ----- A. SYSTEM / CONFIGURATION DATA -----
  console.log('[A] SYSTEM / CONFIGURATION DATA')
  const orgs = await db.organization.findMany({ orderBy: { createdAt: 'asc' } })
  console.log(`  Organizations: ${orgs.length}`)
  for (const org of orgs) {
    console.log(`    - ${org.id}  ${org.name}  (${org.slug})`)
  }

  const allUsers = await db.user.findMany({ orderBy: { createdAt: 'asc' } })
  console.log(`\n  Users: ${allUsers.length}`)
  for (const u of allUsers) {
    const org = orgs.find(o => o.id === u.organizationId)
    console.log(`    - ${u.email}  role=${u.role}  status=${u.status}  org=${org?.name ?? '???'}  disabledAt=${u.disabledAt?.toISOString() ?? '-'}  lastLogin=${u.lastLoginAt?.toISOString() ?? '-'}`)
  }

  const authSessions = await db.authSession.count()
  console.log(`\n  AuthSessions: ${authSessions}`)

  const invitations = await db.invitation.findMany({ orderBy: { createdAt: 'asc' } })
  console.log(`\n  Invitations: ${invitations.length}`)
  for (const inv of invitations) {
    console.log(`    - ${inv.email}  role=${inv.role}  status=${inv.status}  org=${orgs.find(o => o.id === inv.organizationId)?.name ?? '???'}`)
  }

  // ----- B/C/D. BUSINESS DATA CLASSIFICATION -----
  console.log('\n[B/C/D] BUSINESS DATA')
  // We classify the FIRST organization as the "real" production org.
  // All other orgs are test/demo.
  const realOrg = orgs[0]
  const realOrgId = realOrg?.id

  const realOrgUsers = allUsers.filter(u => u.organizationId === realOrgId)
  const otherOrgUsers = allUsers.filter(u => u.organizationId !== realOrgId)
  console.log(`  Users in real org: ${realOrgUsers.length}`)
  console.log(`  Users in other orgs: ${otherOrgUsers.length}`)

  // Departments
  const departments = await db.department.findMany({})
  const realDepts = departments.filter(d => d.organizationId === realOrgId)
  console.log(`\n  Departments: ${departments.length} (real org: ${realDepts.length})`)
  for (const d of realDepts) {
    console.log(`    - ${d.name}  (${d.slug})`)
  }

  // Job Descriptions
  const jds = await db.jobDescription.findMany({})
  const realJds = jds.filter(j => j.organizationId === realOrgId)
  console.log(`\n  JobDescriptions: ${jds.length} (real org: ${realJds.length})`)
  for (const j of realJds.slice(0, 5)) {
    console.log(`    - ${j.title}  template=${j.isTemplate}  level=${j.level}`)
  }
  if (realJds.length > 5) console.log(`    ... and ${realJds.length - 5} more`)

  // Hiring Requests
  const hrs = await db.hiringRequest.findMany({})
  const realHrs = hrs.filter(h => h.organizationId === realOrgId)
  console.log(`\n  HiringRequests: ${hrs.length} (real org: ${realHrs.length})`)
  for (const h of realHrs.slice(0, 20)) {
    console.log(`    - ${h.title}  status=${h.status}  createdAt=${h.createdAt.toISOString()}`)
  }
  if (realHrs.length > 20) console.log(`    ... and ${realHrs.length - 20} more`)

  // Candidates
  const cands = await db.candidate.findMany({})
  const realCands = cands.filter(c => c.organizationId === realOrgId)
  console.log(`\n  Candidates: ${cands.length} (real org: ${realCands.length})`)
  for (const c of realCands.slice(0, 30)) {
    console.log(`    - ${c.firstName} ${c.lastName}  email=${c.email}  stage=${c.stage}`)
  }
  if (realCands.length > 30) console.log(`    ... and ${realCands.length - 30} more`)

  // Interviews
  const interviews = await db.interview.findMany({})
  const realInterviews = interviews.filter(i => i.organizationId === realOrgId)
  console.log(`\n  Interviews: ${interviews.length} (real org: ${realInterviews.length})`)

  // Decisions
  const decisions = await db.candidateDecision.findMany({})
  const realDecisions = decisions.filter(d => d.organizationId === realOrgId)
  console.log(`\n  Decisions: ${decisions.length} (real org: ${realDecisions.length})`)

  // Offers
  const offers = await db.offer.findMany({})
  const realOffers = offers.filter(o => o.organizationId === realOrgId)
  console.log(`\n  Offers: ${offers.length} (real org: ${realOffers.length})`)
  for (const o of realOffers.slice(0, 20)) {
    console.log(`    - ${o.title}  status=${o.status}  salary=${o.salaryAmount} ${o.salaryCurrency}`)
  }

  // Activities
  const activities = await db.activity.count()
  console.log(`\n  Activities: ${activities}`)

  // AI Tasks
  const aiTasks = await db.aITask.count()
  console.log(`  AITasks: ${aiTasks}`)

  // Copilot Action Confirmations
  const confirmations = await db.copilotActionConfirmation.count()
  console.log(`  CopilotActionConfirmations: ${confirmations}`)

  // Audit logs
  const auditLogs = await db.auditLog.count()
  console.log(`  AuditLogs: ${auditLogs}`)

  // Prompt templates
  const prompts = await db.promptTemplate.count()
  console.log(`  PromptTemplates: ${prompts}`)

  // ----- TEST DATA INDICATORS -----
  console.log('\n[TEST INDICATORS] Looking for E2E-generated data in the real org:')
  const TEST_PATTERNS = [
    /^sprint\d+[-_]?/i,
    /sprint\d+[-_]?/i,
    /sprint-?\d+/i,
    /^test[-_]/i,
    /test-user/i,
    /acme[-_]?company/i,
    /^sprint-?(11|10|9|8|7|6|5)/i,
    /@example\.com$/i,
    /@acmecompany\.com$/i,
  ]
  const matchedUsers = realOrgUsers.filter(u => TEST_PATTERNS.some(p => p.test(u.email) || p.test(u.firstName + ' ' + u.lastName)))
  console.log(`  Test-pattern users in real org: ${matchedUsers.length}`)
  for (const u of matchedUsers) {
    console.log(`    - ${u.email}  name="${u.firstName} ${u.lastName}"`)
  }

  const matchedCands = realCands.filter(c => TEST_PATTERNS.some(p => p.test(c.email) || p.test(c.firstName) || p.test(c.firstName + ' ' + c.lastName)))
  console.log(`\n  Test-pattern candidates in real org: ${matchedCands.length}`)
  for (const c of matchedCands.slice(0, 30)) {
    console.log(`    - ${c.email}  name="${c.firstName} ${c.lastName}"`)
  }
  if (matchedCands.length > 30) console.log(`    ... and ${matchedCands.length - 30} more`)

  // Hired-by emails that look like tests
  const actorIds = realOrgUsers.filter(u => TEST_PATTERNS.some(p => p.test(u.email))).map(u => u.id)
  if (actorIds.length > 0) {
    const actorHrs = realHrs.filter(h => actorIds.includes(h.createdById)).length
    const actorCands = realCands.filter(c => actorIds.includes(/* createdById is not on Candidate directly */ '00000000-0000-0000-0000-000000000000')).length
    console.log(`\n  HRs created by test-pattern users: ${actorHrs}`)
  }

  // ----- SUMMARY -----
  console.log('\n[SUMMARY]')
  console.log(`  Real org: ${realOrg?.name ?? '???'} (${realOrgId})`)
  console.log(`  Other orgs (test/demo tenants): ${orgs.length - 1}`)
  console.log(`  Real-org users: ${realOrgUsers.length}`)
  console.log(`    - ADMINs: ${realOrgUsers.filter(u => u.role === 'ADMIN').length}`)
  console.log(`    - TA_LEAD: ${realOrgUsers.filter(u => u.role === 'TA_LEAD').length}`)
  console.log(`    - RECRUITER: ${realOrgUsers.filter(u => u.role === 'RECRUITER').length}`)
  console.log(`    - HIRING_MANAGER: ${realOrgUsers.filter(u => u.role === 'HIRING_MANAGER').length}`)
  console.log(`    - INTERVIEWER: ${realOrgUsers.filter(u => u.role === 'INTERVIEWER').length}`)
  console.log(`    - VIEWER: ${realOrgUsers.filter(u => u.role === 'VIEWER').length}`)
  console.log(`  Real-org HRs: ${realHrs.length}`)
  console.log(`  Real-org candidates: ${realCands.length}`)
  console.log(`  Test-pattern users in real org: ${matchedUsers.length}`)
  console.log(`  Test-pattern candidates in real org: ${matchedCands.length}`)

  await db.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
