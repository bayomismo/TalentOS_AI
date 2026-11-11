/**
 * Sprint 19 — Business-flow regression gate.
 *
 * The existing audit suite (`audit-1` … `audit-5`, `e2e-hiring-flow`)
 * asserts that the happy path returns `ok`. It does NOT assert that the
 * business state advanced. This suite is the counter-measure: every
 * assertion here checks a BUSINESS OUTCOME, and most of them read the
 * resulting database state back.
 *
 * Source of truth: reports/audit/business-flow-audit-2026-11.md
 *   A01-A10  candidate stage transitions
 *   A11-A20  decision flow
 *   A21-A30  offer lifecycle and hire
 *   A31-A36  public apply
 *   A37-A42  onboarding and invitations
 *   A43-A50  reporting and metrics
 *   A51-A56  email and CV readability
 *
 * Every assertion has a stable ID so a sibling track can target it.
 * Assertions that cannot be reached without a permission or a fixture are
 * STATIC checks (source inspection) and are labelled as such — the fix
 * pass must either make the behaviour real or make the limitation
 * explicit in the code.
 *
 * Run:
 *   npx tsx --env-file=.env scripts/audit-6-business-flow.ts
 *
 * Exit code is non-zero when any assertion fails.
 *
 * FIXTURES: everything this script creates lives in two throwaway
 * organizations (`audit6-org-*`) and is deleted in a `finally` block.
 * The acting identity is a throwaway ADMIN whose `createdAt` is pinned
 * to 2000-01-01, so `lib/auth/authorize.ts`'s dev fallback (used when a
 * server action runs outside a Next request context) resolves to the
 * fixture admin instead of a production user.
 */
import 'dotenv/config'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { db } from '../lib/db'
import { requireAuth } from '../lib/auth'
import { ApplicationStage, OfferStatus, Prisma } from '@prisma/client'
import {
  moveCandidateStageAction,
  bulkMoveCandidatesAction,
} from '../app/(app)/hiring-requests/[id]/candidates/actions'
import {
  getDecisionHubAction,
  recordDecisionAction,
} from '../features/decisions/actions/get-decision-hub'
import {
  getOffer,
  recordOfferResponse,
  setOfferDraftContent,
} from '../features/offers/services/offer-service'
import { getOfferDetailAction } from '../features/offers/actions/offer-actions'
import { submitPublicApplicationAction } from '../app/(public)/jobs/[slug]/apply-action'
import { listInvitations } from '../features/user-management/service'
import { acceptInvitation, createInvitation } from '../lib/auth/invitation'
import {
  sendEmail,
  isEmailDeliveryConfigured,
  getEmailProviderName,
} from '../lib/email'
import { getDashboardDataAction } from '../app/(app)/dashboard/actions'
import { getAnalyticsDataAction } from '../app/(app)/analytics/actions'
import { getCandidatesAction } from '../app/(app)/candidates/actions'
import { completeOnboardingAction } from '../lib/onboarding/actions'
import { startInterviewAction } from '../features/interviews/actions/get-interview-data'
import { checkOfferEligibility } from '../lib/offers/eligibility'

// -----------------------------------------------------------------------------
// Assertion plumbing
// -----------------------------------------------------------------------------

let pass = 0
let fail = 0
const failures: string[] = []
const recorded = new Set<string>()

/**
 * `ok(label, cond, detail?)` in the style of audit-5, with a stable ID
 * prefix so a sibling track can target a single assertion.
 */
function ok(id: string, label: string, cond: boolean, detail?: string): boolean {
  recorded.add(id)
  if (cond) {
    pass++
    console.log(`  ✓ [${id}] ${label}`)
  } else {
    fail++
    failures.push(id)
    console.log(`  ✗ [${id}] ${label}${detail ? ' — ' + detail : ''}`)
  }
  return cond
}

/**
 * Runs a block of assertions. If one of them throws (a database error, an
 * unexpected exception), the remaining IDs in the block are recorded as
 * failed instead of aborting the whole run — the gate always completes.
 */
async function group(ids: string[], fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    for (const id of ids) {
      if (!recorded.has(id)) {
        ok(id, `assertion ${id} could not be evaluated (an earlier step threw)`, false, msg)
      }
    }
  }
}

/**
 * True when an action refused the request for a BUSINESS reason. An
 * INTERNAL error means the code crashed (or the database rejected the
 * query) — that is not a refusal, and must never satisfy an assertion that
 * expects a rejection.
 */
function isBusinessRejection(res: { ok: boolean; error?: { code: string } }): boolean {
  return res.ok === false && !!res.error && res.error.code !== 'INTERNAL'
}

const HERE = typeof __dirname !== 'undefined' ? __dirname : process.cwd()
const REPO_ROOT = resolve(HERE, '..')

function readSource(relPath: string): string {
  try {
    return readFileSync(resolve(REPO_ROOT, relPath), 'utf8')
  } catch {
    return ''
  }
}

/** Returns the body of the first function whose source contains `signature`. */
function extractFunction(src: string, signature: string): string {
  const idx = src.indexOf(signature)
  if (idx === -1) return ''
  const braceIdx = src.indexOf('{', idx + signature.length - 1)
  if (braceIdx === -1) return ''
  let depth = 0
  for (let i = braceIdx; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(braceIdx, i + 1)
    }
  }
  return src.slice(braceIdx)
}

/** All .ts/.tsx files under a repo-relative directory (node_modules skipped). */
function listSourceFiles(relDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full)
    }
  }
  walk(resolve(REPO_ROOT, relDir))
  return out
}

/** True when a `catch {` block after `from` has an empty (comment-only) body. */
function hasBareCatch(src: string, from: number): boolean {
  const window = src.slice(from, from + 4000)
  const re = /catch\s*\{([\s\S]*?)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(window)) !== null) {
    const body = m[1]
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()
    if (body.length === 0) return true
  }
  return false
}

// -----------------------------------------------------------------------------
// Fixture helpers
// -----------------------------------------------------------------------------

const STAMP = Date.now()
const TAG = `audit6-${STAMP}`
const EMAIL_DOMAIN = 'example.test'

function fixtureEmail(local: string): string {
  return `${TAG}-${local}@${EMAIL_DOMAIN}`
}

type Stage = 'APPLIED' | 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'HIRED' | 'REJECTED' | 'WITHDRAWN'

interface Fx {
  orgA: string
  orgB: string
  adminA: string
  adminB: string
  deptA: string
  deptB: string
  hrOpen: string
  hrDraft: string
  hrClosed: string
  hrFilled: string
  jdPublic: string
  publicSlug: string
  closedSlug: string
  filledSlug: string
  candidates: Record<string, string>
  offers: Record<string, string>
  interviewB: string
  existingUserEmail: string
  expiredInvitationId: string
  activeUserInvitationToken: string
}

async function createFixtures(): Promise<Fx> {
  // --- Organization A (the acting organization) --------------------------------
  const orgA = await db.organization.create({
    data: {
      name: `${TAG}-org-a`,
      slug: `${TAG}-org-a`,
      industry: null,
      country: null,
      timezone: null,
      size: null,
    },
    select: { id: true },
  })
  // createdAt is pinned so the dev auth fallback in lib/auth/authorize.ts
  // resolves to THIS admin while the script runs.
  const adminA = await db.user.create({
    data: {
      organizationId: orgA.id,
      email: fixtureEmail('admin-a'),
      firstName: 'Audit6',
      lastName: 'Admin A',
      role: 'ADMIN',
      status: 'ACTIVE',
      createdAt: new Date('2000-01-01T00:00:00.000Z'),
    },
    select: { id: true },
  })
  const deptA = await db.department.create({
    data: { organizationId: orgA.id, name: 'Audit6 Eng', slug: `${TAG}-eng-a` },
    select: { id: true },
  })
  const jdPublic = await db.jobDescription.create({
    data: {
      organizationId: orgA.id,
      title: `${TAG} Role`,
      description: 'Audit 6 fixture role.',
      publicSlug: `${TAG}-public`,
      publicEnabled: true,
    },
    select: { id: true },
  })
  // DRAFT first, OPEN second: the public-apply lookup used to take an
  // unordered `take: 1`, so the DRAFT requisition is the one it finds.
  const hrDraft = await db.hiringRequest.create({
    data: {
      organizationId: orgA.id,
      departmentId: deptA.id,
      createdById: adminA.id,
      jobDescriptionId: jdPublic.id,
      title: `${TAG} Draft Requisition`,
      slug: `${TAG}-hr-draft`,
      status: 'DRAFT',
      openings: 1,
    },
    select: { id: true },
  })
  const hrOpen = await db.hiringRequest.create({
    data: {
      organizationId: orgA.id,
      departmentId: deptA.id,
      createdById: adminA.id,
      jobDescriptionId: jdPublic.id,
      title: `${TAG} Open Requisition`,
      slug: `${TAG}-hr-open`,
      status: 'OPEN',
      openings: 2,
    },
    select: { id: true },
  })
  const hrClosed = await db.hiringRequest.create({
    data: {
      organizationId: orgA.id,
      departmentId: deptA.id,
      createdById: adminA.id,
      title: `${TAG} Closed Requisition`,
      slug: `${TAG}-hr-closed`,
      status: 'CLOSED',
      openings: 1,
    },
    select: { id: true },
  })
  const hrFilled = await db.hiringRequest.create({
    data: {
      organizationId: orgA.id,
      departmentId: deptA.id,
      createdById: adminA.id,
      title: `${TAG} Filled Requisition`,
      slug: `${TAG}-hr-filled`,
      status: 'OPEN',
      openings: 1,
      filled: 1,
    },
    select: { id: true },
  })

  const jdClosed = await db.jobDescription.create({
    data: {
      organizationId: orgA.id,
      title: `${TAG} Closed Role`,
      description: 'Audit 6 fixture role (closed requisition).',
      publicSlug: `${TAG}-closed`,
      publicEnabled: true,
    },
    select: { id: true },
  })
  const jdFilled = await db.jobDescription.create({
    data: {
      organizationId: orgA.id,
      title: `${TAG} Filled Role`,
      description: 'Audit 6 fixture role (filled requisition).',
      publicSlug: `${TAG}-filled`,
      publicEnabled: true,
    },
    select: { id: true },
  })
  await db.hiringRequest.update({
    where: { id: hrClosed.id },
    data: { jobDescriptionId: jdClosed.id },
  })
  await db.hiringRequest.update({
    where: { id: hrFilled.id },
    data: { jobDescriptionId: jdFilled.id },
  })

  // --- Candidates -------------------------------------------------------------
  const mkCandidate = async (
    key: string,
    stage: Stage,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const row = await db.candidate.create({
      data: {
        organizationId: orgA.id,
        hiringRequestId: hrOpen.id,
        firstName: 'Audit6',
        lastName: key,
        email: fixtureEmail(`cand-${key}`),
        stage,
        source: 'Audit6',
        ...extra,
      },
      select: { id: true },
    })
    return row.id
  }

  const candidates: Record<string, string> = {}
  candidates.illegalHire = await mkCandidate('IllegalHire', 'APPLIED')
  candidates.hiredTerminal = await mkCandidate('HiredTerminal', 'HIRED', {
    hiredAt: new Date('2026-01-01T00:00:00.000Z'),
  })
  candidates.offerToHire = await mkCandidate('OfferToHire', 'OFFER')
  // A03 hires a DEDICATED candidate through the manual stage-move path.
  // `offerToHire` must still be at OFFER when A21-A25 accept its offer,
  // otherwise the offer-acceptance assertions would be satisfied by a
  // candidate that A03 had already hired — A21/A22 would pass vacuously
  // and A23 ("increments filled by exactly 1") could never be true.
  candidates.manualHire = await mkCandidate('ManualHire', 'OFFER')
  candidates.bulkHire = await mkCandidate('BulkHire', 'OFFER')
  candidates.bulkRejected = await mkCandidate('BulkRejected', 'SCREENING')
  candidates.terminalDecision = await mkCandidate('TerminalDecision', 'REJECTED', {
    rejectedAt: new Date('2026-01-01T00:00:00.000Z'),
  })
  candidates.interview = await mkCandidate('Interview', 'INTERVIEW')
  candidates.screening = await mkCandidate('Screening', 'SCREENING')
  candidates.applied = await mkCandidate('Applied', 'APPLIED')
  candidates.noScore = await mkCandidate('NoScore', 'APPLIED')
  candidates.rejectedList = await mkCandidate('RejectedList', 'REJECTED', {
    rejectedAt: new Date('2026-01-01T00:00:00.000Z'),
  })
  candidates.withdrawnList = await mkCandidate('WithdrawnList', 'WITHDRAWN', {
    withdrawnAt: new Date('2026-01-01T00:00:00.000Z'),
  })
  candidates.hired = await mkCandidate('Hired', 'HIRED', {
    hiredAt: new Date('2026-01-01T00:00:00.000Z'),
  })
  // The candidate a public re-application will try to overwrite.
  candidates.publicExisting = await mkCandidate('PublicExisting', 'REJECTED', {
    rejectedAt: new Date('2026-01-01T00:00:00.000Z'),
    phone: '+1-555-0100',
    location: 'Cairo',
    summary: 'Recruiter-curated cover letter',
    source: 'Referral',
    firstName: 'Curated',
    lastName: 'Name',
  })

  // --- Offers -----------------------------------------------------------------
  const mkOffer = async (
    key: string,
    candidateId: string,
    status: OfferStatus,
    salaryAmount: number,
  ): Promise<string> => {
    const row = await db.offer.create({
      data: {
        organizationId: orgA.id,
        hiringRequestId: hrOpen.id,
        candidateId,
        title: `${TAG} Offer ${key}`,
        salaryAmount,
        salaryCurrency: 'USD',
        salaryPeriod: 'annual',
        status,
        createdById: adminA.id,
      },
      select: { id: true },
    })
    return row.id
  }
  const offers: Record<string, string> = {}
  offers.accepted = await mkOffer('Accepted', candidates.offerToHire, OfferStatus.ISSUED, 165000)
  offers.declined = await mkOffer('Declined', candidates.bulkRejected, OfferStatus.ISSUED, 150000)
  offers.approved = await mkOffer('Approved', candidates.applied, OfferStatus.APPROVED, 155000)
  offers.issued = await mkOffer('Issued', candidates.noScore, OfferStatus.ISSUED, 150000)
  offers.draft = await mkOffer('Draft', candidates.screening, OfferStatus.DRAFT, 145000)

  // --- Organization B (cross-tenant caller) ------------------------------------
  const orgB = await db.organization.create({
    data: { name: `${TAG}-org-b`, slug: `${TAG}-org-b` },
    select: { id: true },
  })
  const adminB = await db.user.create({
    data: {
      organizationId: orgB.id,
      email: fixtureEmail('admin-b'),
      firstName: 'Audit6',
      lastName: 'Admin B',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
    select: { id: true },
  })
  const deptB = await db.department.create({
    data: { organizationId: orgB.id, name: 'Audit6 Eng B', slug: `${TAG}-eng-b` },
    select: { id: true },
  })
  const hrB = await db.hiringRequest.create({
    data: {
      organizationId: orgB.id,
      departmentId: deptB.id,
      createdById: adminB.id,
      title: `${TAG} Other Org Requisition`,
      slug: `${TAG}-hr-b`,
      status: 'OPEN',
      openings: 1,
    },
    select: { id: true },
  })
  const candB = await db.candidate.create({
    data: {
      organizationId: orgB.id,
      hiringRequestId: hrB.id,
      firstName: 'Audit6',
      lastName: 'OtherOrg',
      email: fixtureEmail('cand-b'),
      stage: 'INTERVIEW',
    },
    select: { id: true },
  })
  const interviewB = await db.interview.create({
    data: {
      organizationId: orgB.id,
      hiringRequestId: hrB.id,
      candidateId: candB.id,
      scheduledById: adminB.id,
      type: 'TECHNICAL',
      title: `${TAG} Other Org Interview`,
      scheduledAt: new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
      status: 'SCHEDULED',
    },
    select: { id: true },
  })

  // --- Invitations -------------------------------------------------------------
  const existingUserEmail = fixtureEmail('already-active')
  const existingUser = await db.user.create({
    data: {
      organizationId: orgA.id,
      email: existingUserEmail,
      firstName: 'Audit6',
      lastName: 'AlreadyActive',
      role: 'RECRUITER',
      status: 'ACTIVE',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz012345678901234567890123456',
      passwordChangedAt: new Date(),
    },
    select: { id: true },
  })
  const activeUserInvitation = await createInvitation({
    organizationId: orgA.id,
    email: existingUserEmail,
    role: 'RECRUITER',
    invitedById: adminA.id,
    firstName: 'Audit6',
    lastName: 'AlreadyActive',
  })
  const expiredInvitation = await db.invitation.create({
    data: {
      organizationId: orgA.id,
      email: fixtureEmail('expired'),
      role: 'RECRUITER',
      tokenHash: `${TAG}-expired-token-hash`,
      tokenPrefix: 'audit6exp',
      invitedById: adminA.id,
      expiresAt: new Date(Date.now() - 86_400_000),
      status: 'PENDING',
    },
    select: { id: true },
  })
  void existingUser

  return {
    orgA: orgA.id,
    orgB: orgB.id,
    adminA: adminA.id,
    adminB: adminB.id,
    deptA: deptA.id,
    deptB: deptB.id,
    hrOpen: hrOpen.id,
    hrDraft: hrDraft.id,
    hrClosed: hrClosed.id,
    hrFilled: hrFilled.id,
    jdPublic: jdPublic.id,
    publicSlug: `${TAG}-public`,
    closedSlug: `${TAG}-closed`,
    filledSlug: `${TAG}-filled`,
    candidates,
    offers,
    interviewB: interviewB.id,
    existingUserEmail,
    expiredInvitationId: expiredInvitation.id,
    activeUserInvitationToken: activeUserInvitation.token,
  }
}

/**
 * The generated Prisma client can be ahead of the database (a sibling track
 * may have regenerated the client before its migration was applied). When
 * that happens, whole flows fail with Prisma P2022 "column does not exist",
 * which is an environment problem, not a business defect. Say so loudly so
 * the baseline is read correctly.
 */
async function reportSchemaDrift(): Promise<void> {
  try {
    const cols = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>(
      Prisma.sql`select table_name, column_name from information_schema.columns where table_name in ('CandidateDecision','Offer','Application')`,
    )
    const has = (table: string, column: string): boolean =>
      cols.some((c) => c.table_name === table && c.column_name === column)
    const missing: string[] = []
    if (!has('CandidateDecision', 'supersedesId')) missing.push('CandidateDecision.supersedesId')
    if (!has('Offer', 'supersededAt')) missing.push('Offer.supersededAt')
    const appTable = cols.some((c) => c.table_name === 'Application')
    if (!appTable) missing.push('Application (table)')
    if (missing.length > 0) {
      console.log(
        `⚠ SCHEMA DRIFT: the database is behind the generated Prisma client — ` +
          `missing ${missing.join(', ')}. Assertions that touch those columns ` +
          'will fail with a database error until the migration is applied.',
      )
      console.log('')
    }
  } catch {
    /* the drift probe is informational only */
  }
}

async function cleanup(fx: Fx): Promise<void> {
  const orgIds = [fx.orgA, fx.orgB]
  try {
    await db.emailOutbox.deleteMany({ where: { to: { contains: TAG } } })
  } catch {
    /* outbox rows are best-effort cleanup */
  }
  try {
    await db.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } })
  } catch {
    /* audit rows are best-effort cleanup */
  }
  try {
    await db.invitation.deleteMany({ where: { organizationId: { in: orgIds } } })
  } catch {
    /* invitation rows are best-effort cleanup */
  }
  try {
    await db.candidateDecision.deleteMany({ where: { organizationId: { in: orgIds } } })
  } catch {
    /* decision rows are best-effort cleanup */
  }
  try {
    await db.hiringRequest.deleteMany({ where: { organizationId: { in: orgIds } } })
  } catch {
    /* requisitions are best-effort cleanup */
  }
  try {
    await db.organization.deleteMany({ where: { id: { in: orgIds } } })
  } catch {
    /* the org cascade removes the rest */
  }
}

// -----------------------------------------------------------------------------
// The gate
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('━'.repeat(72))
  console.log(`BUSINESS-FLOW REGRESSION GATE — ${TAG}`)
  console.log('━'.repeat(72))

  // The fixtures must exist BEFORE the acting identity is resolved: the dev
  // auth fallback in lib/auth/authorize.ts picks the OLDEST active ADMIN, and
  // the fixture admin is pinned to 2000-01-01 so it wins. Otherwise the
  // actions would run against a production tenant.
  const fx = await createFixtures()
  console.log(`Fixtures created in ${fx.orgA} (and ${fx.orgB} for the cross-tenant check)`)

  const auth = await requireAuth()
  if (!auth.ok) {
    console.error(
      'FATAL: no acting identity. This script needs the dev auth fallback ' +
        '(lib/auth/authorize.ts), i.e. NODE_ENV must not be "production" and at ' +
        'least one active ADMIN must exist.',
    )
    await cleanup(fx)
    process.exit(1)
  }
  if (auth.data.userId !== fx.adminA) {
    console.error(
      `FATAL: the acting identity (${auth.data.email}) is not the fixture admin. ` +
        'The dev auth fallback picked another ADMIN — the fixtures would run ' +
        'against the wrong tenant.',
    )
    await cleanup(fx)
    process.exit(1)
  }
  console.log(`Acting identity: ${auth.data.email} (${auth.data.role}) org=${auth.data.organizationId}`)
  console.log('')

  await reportSchemaDrift()

  try {
    await runAssertions(fx)
  } finally {
    await cleanup(fx)
    console.log('\nFixtures removed.')
  }

  console.log('')
  console.log('━'.repeat(72))
  console.log(`FINAL: ${pass} passed, ${fail} failed`)
  if (failures.length > 0) console.log(`Failing IDs: ${failures.join(', ')}`)
  console.log('━'.repeat(72))
  process.exit(fail === 0 ? 0 : 1)
}

async function runAssertions(fx: Fx): Promise<void> {
  // ===========================================================================
  // A01-A10 · Candidate stage transitions
  // ===========================================================================
  console.log('[A01-A10] Candidate stage transitions')

  const stageOf = async (candidateId: string): Promise<string | null> => {
    const row = await db.candidate.findUnique({
      where: { id: candidateId },
      select: { stage: true },
    })
    return row?.stage ?? null
  }

  await group(['A01'], async () => {
    // A01 — an illegal transition must be refused AND leave the row untouched.
    const before = await stageOf(fx.candidates.illegalHire)
    const res = await moveCandidateStageAction({
      candidateId: fx.candidates.illegalHire,
      toStage: ApplicationStage.HIRED,
    })
    const after = await stageOf(fx.candidates.illegalHire)
    ok(
      'A01',
      'moveCandidateStageAction rejects APPLIED → HIRED and leaves the stage unchanged',
      res.ok === false && after === before && before === 'APPLIED',
      `ok=${res.ok} stage ${before} → ${after}`,
    )
  })

  await group(['A02'], async () => {
    // A02 — no resurrection from a terminal stage.
    const before = await stageOf(fx.candidates.hiredTerminal)
    const res = await moveCandidateStageAction({
      candidateId: fx.candidates.hiredTerminal,
      toStage: ApplicationStage.APPLIED,
    })
    const after = await stageOf(fx.candidates.hiredTerminal)
    ok(
      'A02',
      'moveCandidateStageAction rejects HIRED → APPLIED (resurrection)',
      res.ok === false && after === 'HIRED' && before === 'HIRED',
      `ok=${res.ok} stage ${before} → ${after}`,
    )
  })

  await group(['A03'], async () => {
    // A03 — a legal move to HIRED sets hiredAt.
    const res = await moveCandidateStageAction({
      candidateId: fx.candidates.manualHire,
      toStage: ApplicationStage.HIRED,
    })
    const row = await db.candidate.findUnique({
      where: { id: fx.candidates.manualHire },
      select: { stage: true, hiredAt: true },
    })
    ok(
      'A03',
      'moveCandidateStageAction to HIRED sets candidate.stage = HIRED and hiredAt',
      res.ok === true && row?.stage === 'HIRED' && row?.hiredAt !== null,
      `ok=${res.ok} stage=${row?.stage} hiredAt=${row?.hiredAt?.toISOString() ?? 'null'}`,
    )
  })

  await group(['A04'], async () => {
    // A04 — the bulk path must mirror the single path's lifecycle timestamps.
    const res = await bulkMoveCandidatesAction({
      candidateIds: [fx.candidates.bulkHire],
      toStage: ApplicationStage.HIRED,
    })
    const row = await db.candidate.findUnique({
      where: { id: fx.candidates.bulkHire },
      select: { stage: true, hiredAt: true },
    })
    ok(
      'A04',
      'bulkMoveCandidatesAction sets the same lifecycle timestamps as the single path (hiredAt)',
      res.ok === true && row?.stage === 'HIRED' && row?.hiredAt !== null,
      `ok=${res.ok} stage=${row?.stage} hiredAt=${row?.hiredAt?.toISOString() ?? 'null'}`,
    )
  })

  await group(['A05'], async () => {
    // A05 — a terminal candidate must not be decidable.
    const res = await recordDecisionAction({
      candidateId: fx.candidates.terminalDecision,
      hiringRequestId: fx.hrOpen,
      decision: 'SELECTED',
    })
    const stage = await stageOf(fx.candidates.terminalDecision)
    ok(
      'A05',
      'recordDecisionAction on a terminal candidate returns an error, not ok:true',
      isBusinessRejection(res) && stage === 'REJECTED',
      `ok=${res.ok} code=${res.ok ? 'n/a' : res.error?.code} stage=${stage}`,
    )
  })

  await group(['A06'], async () => {
    // A06 — SELECTED must actually move the stage to OFFER.
    const res = await recordDecisionAction({
      candidateId: fx.candidates.interview,
      hiringRequestId: fx.hrOpen,
      decision: 'SELECTED',
    })
    const stage = await stageOf(fx.candidates.interview)
    ok(
      'A06',
      'recordDecisionAction SELECTED moves the candidate to OFFER',
      res.ok === true && stage === 'OFFER',
      `ok=${res.ok} code=${res.ok ? 'n/a' : res.error?.code} stage=${stage}`,
    )
  })

  await group(['A07'], async () => {
    // A07 — REJECT must move the stage and stamp rejectedAt.
    const res = await recordDecisionAction({
      candidateId: fx.candidates.screening,
      hiringRequestId: fx.hrOpen,
      decision: 'REJECT',
      reason: 'Audit6 regression fixture',
    })
    const row = await db.candidate.findUnique({
      where: { id: fx.candidates.screening },
      select: { stage: true, rejectedAt: true },
    })
    ok(
      'A07',
      'recordDecisionAction REJECT moves the stage to REJECTED and sets rejectedAt',
      res.ok === true && row?.stage === 'REJECTED' && row?.rejectedAt !== null,
      `ok=${res.ok} code=${res.ok ? 'n/a' : res.error?.code} stage=${row?.stage} ` +
        `rejectedAt=${row?.rejectedAt?.toISOString() ?? 'null'}`,
    )
  })

  await group(['A08'], async () => {
    // A08 — HOLD and ADVANCE must leave an observable state.
    const holdRes = await recordDecisionAction({
      candidateId: fx.candidates.applied,
      hiringRequestId: fx.hrOpen,
      decision: 'HOLD',
      notes: 'Audit6 hold',
    })
    const holdDecision = await db.candidateDecision.findFirst({
      where: { candidateId: fx.candidates.applied, hiringRequestId: fx.hrOpen },
      select: { decision: true },
    })
    const holdActivity = await db.activity.findFirst({
      where: { candidateId: fx.candidates.applied, type: 'CANDIDATE_HELD' },
      select: { id: true },
    })
    const advanceRes = await recordDecisionAction({
      candidateId: fx.candidates.noScore,
      hiringRequestId: fx.hrOpen,
      decision: 'ADVANCE',
      notes: 'Audit6 advance',
    })
    const advanceDecision = await db.candidateDecision.findFirst({
      where: { candidateId: fx.candidates.noScore, hiringRequestId: fx.hrOpen },
      select: { decision: true },
    })
    const advanceActivity = await db.activity.findFirst({
      where: { candidateId: fx.candidates.noScore, type: 'CANDIDATE_ADVANCED' },
      select: { id: true },
    })
    ok(
      'A08',
      'HOLD and ADVANCE decisions leave an observable state (decision row + activity)',
      holdRes.ok === true &&
        holdDecision?.decision === 'HOLD' &&
        holdActivity !== null &&
        advanceRes.ok === true &&
        advanceDecision?.decision === 'ADVANCE' &&
        advanceActivity !== null,
      `hold=${holdDecision?.decision ?? 'none'} activity=${holdActivity ? 'yes' : 'no'} ` +
        `advance=${advanceDecision?.decision ?? 'none'} activity=${advanceActivity ? 'yes' : 'no'}`,
    )
  })

  await group(['A09', 'A10'], async () => {
    const hub = await getDecisionHubAction(fx.hrOpen)
    const view = hub.ok ? hub.data : null
    const rows = view?.candidates ?? []
    const terminalRow = rows.find((c) => c.id === fx.candidates.terminalDecision)
    const selectableFlagNames = [
      'selectable',
      'canSelect',
      'eligible',
      'canDecide',
      'decidable',
      'actionable',
      'hasActions',
    ]
    let terminalSelectable: boolean | null = null
    if (terminalRow) {
      const raw = terminalRow as unknown as Record<string, unknown>
      for (const name of selectableFlagNames) {
        const v = raw[name]
        if (typeof v === 'boolean') {
          terminalSelectable = v
          break
        }
      }
    }
    const selectableList = view
      ? ((view as unknown as Record<string, unknown>).selectableCandidateIds ??
        (view as unknown as Record<string, unknown>).selectableCandidates)
      : null
    const excludedFromList =
      Array.isArray(selectableList) &&
      !(selectableList as unknown[]).includes(fx.candidates.terminalDecision)
    ok(
      'A09',
      'the Decision Hub marks terminal-stage candidates as NOT selectable',
      terminalRow !== undefined && (terminalSelectable === false || excludedFromList),
      terminalRow === undefined
        ? 'terminal candidate missing from the hub'
        : `selectable flag=${String(terminalSelectable)} list=${excludedFromList ? 'excluded' : 'not excluded'}`,
    )

    const allIds = Object.values(fx.candidates)
    const missing = allIds.filter((id) => !rows.some((r) => r.id === id))
    ok(
      'A10',
      'the Decision Hub still LISTS every candidate (readiness is a badge, not a filter)',
      view !== null && missing.length === 0,
      missing.length > 0 ? `missing ${missing.length} candidate(s) from the hub` : 'hub list complete',
    )
  })

  // ===========================================================================
  // A11-A20 · Decision flow
  // ===========================================================================
  console.log('\n[A11-A20] Decision flow')

  await group(['A11'], async () => {
    // A11 — a refused decision must leave no trace of a bogus decision.
    const before = await db.candidateDecision.count({
      where: { candidateId: fx.candidates.terminalDecision },
    })
    const res = await recordDecisionAction({
      candidateId: fx.candidates.terminalDecision,
      hiringRequestId: fx.hrOpen,
      decision: 'REJECT',
    })
    const after = await db.candidateDecision.count({
      where: { candidateId: fx.candidates.terminalDecision },
    })
    const activity = await db.activity.count({
      where: { candidateId: fx.candidates.terminalDecision, type: 'CANDIDATE_REJECTED' },
    })
    ok(
      'A11',
      'a refused decision on a terminal candidate writes no decision row and no activity',
      isBusinessRejection(res) && after === before && activity === 0,
      `ok=${res.ok} code=${res.ok ? 'n/a' : res.error?.code} decisions ${before} → ${after} ` +
        `rejectActivities=${activity}`,
    )
  })

  await group(['A12'], async () => {
    // A12 — the decision itself must be persisted.
    const row = await db.candidateDecision.findFirst({
      where: { candidateId: fx.candidates.interview, hiringRequestId: fx.hrOpen },
      select: { decision: true, decidedById: true },
    })
    ok(
      'A12',
      'a SELECTED decision is persisted as a CandidateDecision row',
      row?.decision === 'SELECTED' && row?.decidedById === fx.adminA,
      `decision=${row?.decision ?? 'none'} decidedBy=${row?.decidedById ?? 'none'}`,
    )
  })

  await group(['A13'], async () => {
    // A13 — the activity timeline must record the decision type.
    const activity = await db.activity.findFirst({
      where: { candidateId: fx.candidates.interview, type: 'CANDIDATE_SELECTED' },
      select: { id: true, title: true },
    })
    ok(
      'A13',
      'the decision timeline records the decision type (CANDIDATE_SELECTED activity)',
      activity !== null,
      activity ? `activity "${activity.title}"` : 'no CANDIDATE_SELECTED activity',
    )
  })

  await group(['A14'], async () => {
    // A14 — an unanalysed candidate must not be presented as "score 0".
    const hub = await getDecisionHubAction(fx.hrOpen)
    const row = hub.ok ? hub.data.candidates.find((c) => c.id === fx.candidates.noScore) : undefined
    ok(
      'A14',
      'an unanalysed candidate is reported as "not analysed" (matchScore null), not as a score of 0',
      row !== undefined && row.matchScore === null,
      row ? `matchScore=${String(row.matchScore)}` : 'candidate missing from the hub',
    )
  })

  await group(['A15'], async () => {
    // A15 — a re-decision must not destroy the previous decision.
    const res = await recordDecisionAction({
      candidateId: fx.candidates.interview,
      hiringRequestId: fx.hrOpen,
      decision: 'HOLD',
      notes: 'Audit6 re-decision',
    })
    const rows = await db.candidateDecision.findMany({
      where: { candidateId: fx.candidates.interview, hiringRequestId: fx.hrOpen },
      select: { id: true, decision: true, supersedesId: true },
    })
    ok(
      'A15',
      'a second decision does not overwrite the first one — the history is kept and linked',
      res.ok === true &&
        rows.length >= 2 &&
        rows.some((r) => r.decision === 'SELECTED') &&
        rows.some((r) => r.decision === 'HOLD'),
      `decision rows=${rows.length} decisions=${rows.map((r) => r.decision).join(',')} ` +
        `supersedes=${rows.map((r) => r.supersedesId ?? 'none').join(',')}`,
    )
  })

  await group(['A16'], async () => {
    // A16 — a decision must never reference itself as its own predecessor.
    const activity = await db.activity.findFirst({
      where: { candidateId: fx.candidates.interview, type: 'CANDIDATE_HELD' },
      orderBy: { occurredAt: 'desc' },
      select: { id: true, candidateDecisionId: true, metadata: true },
    })
    const meta = (activity?.metadata ?? {}) as Record<string, unknown>
    const previous = meta.previousDecisionId
    ok(
      'A16',
      'a decision never points at itself as its own previous decision',
      activity !== null &&
        activity.candidateDecisionId !== null &&
        previous !== activity.candidateDecisionId,
      `decisionId=${activity?.candidateDecisionId ?? 'none'} previousDecisionId=${String(previous)}`,
    )
  })

  await group(['A17'], async () => {
    // A17 — the hub counters must agree with the list they describe.
    const hub = await getDecisionHubAction(fx.hrOpen)
    const view = hub.ok ? hub.data : null
    ok(
      'A17',
      "the Decision Hub's total count matches the number of candidates it lists",
      view !== null && view.counts.total === view.candidates.length,
      view
        ? `counts.total=${view.counts.total} listed=${view.candidates.length}`
        : 'the hub could not be loaded',
    )
  })

  await group(['A18'], async () => {
    // A18 — a SELECTED candidate must be eligible for an offer.
    const decision = await db.candidateDecision.findFirst({
      where: { candidateId: fx.candidates.interview, hiringRequestId: fx.hrOpen },
      select: { candidateId: true, hiringRequestId: true, decision: true },
    })
    const eligibility = checkOfferEligibility({
      candidate: { id: fx.candidates.interview, organizationId: fx.orgA },
      hiringRequestId: fx.hrOpen,
      hiringRequestOrganizationId: fx.orgA,
      latestDecision: decision
        ? {
            candidateId: decision.candidateId,
            hiringRequestId: decision.hiringRequestId,
            decision: decision.decision,
          }
        : null,
      existingOffers: [],
    })
    ok(
      'A18',
      'a SELECTED candidate is eligible to receive an offer',
      eligibility.ok === true,
      eligibility.ok ? 'eligible' : `blocked: ${eligibility.code}`,
    )
  })

  await group(['A19'], async () => {
    // A19 — a decision for another tenant's candidate must be refused.
    const other = await db.candidate.findFirst({
      where: { organizationId: fx.orgB },
      select: { id: true, hiringRequestId: true },
    })
    if (!other) {
      ok(
        'A19',
        'recordDecisionAction for a candidate in another organization is refused (no cross-tenant write)',
        false,
        'cross-tenant fixture missing',
      )
    } else {
      const res = await recordDecisionAction({
        candidateId: other.id,
        hiringRequestId: other.hiringRequestId,
        decision: 'SELECTED',
      })
      const row = await db.candidateDecision.findFirst({
        where: { candidateId: other.id },
        select: { id: true },
      })
      ok(
        'A19',
        'recordDecisionAction for a candidate in another organization is refused (no cross-tenant write)',
        res.ok === false && row === null,
        `ok=${res.ok} code=${res.ok ? 'n/a' : res.error?.code} decisionRows=${row ? 1 : 0}`,
      )
    }
  })

  await group(['A20'], async () => {
    // A20 — the hub must only list the requested requisition's candidates.
    const hub = await getDecisionHubAction(fx.hrOpen)
    const rows = hub.ok ? hub.data.candidates : []
    const foreign = rows.filter((r) => !r.email.includes(TAG))
    ok(
      'A20',
      'the Decision Hub only lists candidates of the requested hiring request',
      hub.ok === true && foreign.length === 0,
      foreign.length > 0 ? `${foreign.length} foreign candidate(s) in the hub` : 'no foreign candidates',
    )
  })

  // ===========================================================================
  // A21-A30 · Offer lifecycle and hire
  // ===========================================================================
  console.log('\n[A21-A30] Offer lifecycle and hire')

  const offerCtx = {
    userId: fx.adminA,
    organizationId: fx.orgA,
    isAdmin: true,
    isTaLead: false,
    role: 'ADMIN',
  }

  await group(['A21', 'A22', 'A23', 'A24', 'A25'], async () => {
    const hrBefore = await db.hiringRequest.findUnique({
      where: { id: fx.hrOpen },
      select: { filled: true, openings: true, status: true },
    })
    const res = await recordOfferResponse(offerCtx, fx.offers.accepted, 'ACCEPTED', {
      confirm: true,
    })
    const cand = await db.candidate.findUnique({
      where: { id: fx.candidates.offerToHire },
      select: { stage: true, hiredAt: true },
    })
    const hrAfter = await db.hiringRequest.findUnique({
      where: { id: fx.hrOpen },
      select: { filled: true, openings: true, status: true },
    })
    ok(
      'A21',
      'an ACCEPTED offer response sets candidate.stage = HIRED',
      res.ok === true && cand?.stage === 'HIRED',
      `ok=${res.ok} stage=${cand?.stage}`,
    )
    ok(
      'A22',
      'an ACCEPTED offer response sets candidate.hiredAt',
      res.ok === true && cand?.hiredAt !== null,
      `hiredAt=${cand?.hiredAt?.toISOString() ?? 'null'}`,
    )
    ok(
      'A23',
      'an ACCEPTED offer response increments HiringRequest.filled by exactly 1',
      hrAfter !== null && hrBefore !== null && hrAfter.filled === hrBefore.filled + 1,
      `filled ${hrBefore?.filled} → ${hrAfter?.filled}`,
    )
    ok(
      'A24',
      'when filled >= openings the hiring request status becomes FILLED',
      hrAfter !== null &&
        hrAfter.filled >= hrAfter.openings &&
        hrAfter.status === 'FILLED',
      `filled=${hrAfter?.filled}/${hrAfter?.openings} status=${hrAfter?.status}`,
    )
    ok(
      'A25',
      'the hire write is atomic (stage + hiredAt + filled + status commit together) [static check: transaction boundary]',
      isAtomicHireImplementation(),
      'the offer-acceptance write path contains no db.$transaction boundary',
    )
  })

  await group(['A26'], async () => {
    const res = await recordOfferResponse(offerCtx, fx.offers.declined, 'DECLINED', {
      reason: 'Audit6 declined',
    })
    const cand = await db.candidate.findUnique({
      where: { id: fx.candidates.bulkRejected },
      select: { stage: true },
    })
    const offer = await db.offer.findUnique({
      where: { id: fx.offers.declined },
      select: { status: true, declinedAt: true, declineReason: true },
    })
    const activity = await db.activity.findFirst({
      where: { offerId: fx.offers.declined, type: 'OFFER_DECLINED' },
      select: { id: true },
    })
    ok(
      'A26',
      'a DECLINED offer response moves the candidate out of OFFER and records the decline',
      res.ok === true &&
        cand?.stage !== 'OFFER' &&
        offer?.status === 'DECLINED' &&
        offer?.declinedAt !== null &&
        activity !== null,
      `ok=${res.ok} stage=${cand?.stage} offerStatus=${offer?.status} activity=${activity ? 'yes' : 'no'}`,
    )
  })

  await group(['A27'], async () => {
    const approved = await setOfferDraftContent(
      offerCtx,
      fx.offers.approved,
      { fullText: 'tampered after approval' },
      {},
    )
    const issued = await setOfferDraftContent(
      offerCtx,
      fx.offers.issued,
      { fullText: 'tampered after issue' },
      {},
    )
    const approvedRow = await db.offer.findUnique({
      where: { id: fx.offers.approved },
      select: { status: true, draftContent: true },
    })
    ok(
      'A27',
      'the offer letter cannot be edited when the offer is APPROVED or ISSUED',
      approved.ok === false && issued.ok === false,
      `approved=${approved.ok ? 'EDITED (bad)' : 'blocked'} issued=${issued.ok ? 'EDITED (bad)' : 'blocked'} ` +
        `stored=${JSON.stringify(approvedRow?.draftContent)}`,
    )
  })

  await group(['A28'], async () => {
    const offer = await db.offer.findUnique({
      where: { id: fx.offers.draft },
      select: { id: true, salaryAmount: true, status: true },
    })
    const wrongComp = {
      fullText: 'We are pleased to offer you the role.',
      compensationSection: 'Your annual salary will be $999,999 USD.',
    }
    const res = await setOfferDraftContent(offerCtx, fx.offers.draft, wrongComp, {})
    const stored = await db.offer.findUnique({
      where: { id: fx.offers.draft },
      select: { draftContent: true, salaryAmount: true },
    })
    const persistedText = JSON.stringify(stored?.draftContent ?? '')
    const mismatchPersisted = persistedText.includes('999,999') || persistedText.includes('999999')
    ok(
      'A28',
      "the offer letter's compensation matches offer.salaryAmount",
      offer !== null &&
        (res.ok === false || mismatchPersisted === false) &&
        stored?.salaryAmount === offer.salaryAmount,
      `salaryAmount=${offer?.salaryAmount} saveRejected=${res.ok === false} ` +
        `mismatchPersisted=${mismatchPersisted}`,
    )
  })

  await group(['A29'], async () => {
    // Static check: the dev auth fallback can only act as ADMIN, so a role
    // without `offer.view_compensation` is not reachable from a script.
    const src = readSource('features/offers/actions/offer-actions.ts')
    const body = extractFunction(src, 'export async function getOfferDetailAction')
    const guardIdx = body.search(/if\s*\(\s*\w+\.canComp\s*\)/)
    const draftIdx = body.indexOf('draftContent')
    const projectedInsideGate = guardIdx !== -1 && draftIdx > guardIdx
    const redacted = /compensationSection/.test(body) && /canComp/.test(body)
    ok(
      'A29',
      'getOfferDetailAction does NOT return draftContent to a role without offer.view_compensation [static check]',
      projectedInsideGate || redacted,
      projectedInsideGate
        ? 'draftContent is projected inside the canComp gate'
        : `draftContent is projected outside the canComp gate (index ${draftIdx} < guard ${guardIdx})`,
    )
  })

  await group(['A30'], async () => {
    const fullText = `Audit6 offer letter body ${STAMP}`
    const res = await setOfferDraftContent(
      offerCtx,
      fx.offers.draft,
      {
        fullText,
        greeting: 'Hello,',
        compensationSection: 'Compensation as approved.',
      },
      {},
    )
    const reread = await getOffer(offerCtx, fx.offers.draft)
    const rereadText =
      reread.ok && reread.data.draftContent ? JSON.stringify(reread.data.draftContent) : ''
    ok(
      'A30',
      'the offer letter is readable back after a reload (draftContent.fullText survives)',
      res.ok === true && reread.ok === true && rereadText.includes(fullText),
      `saved=${res.ok} readBack=${reread.ok} containsFullText=${rereadText.includes(fullText)}`,
    )
  })

  // ===========================================================================
  // A31-A36 · Public apply
  // ===========================================================================
  console.log('\n[A31-A36] Public apply')

  const publicIp = `203.0.113.${(STAMP % 200) + 10}`

  await group(['A31'], async () => {
    const before = await db.candidate.findUnique({
      where: { id: fx.candidates.publicExisting },
      select: { stage: true, rejectedAt: true, hiringRequestId: true, email: true },
    })
    const res = await submitPublicApplicationAction(
      {
        jobSlug: fx.publicSlug,
        firstName: 'Impostor',
        lastName: 'Applicant',
        email: before?.email ?? fixtureEmail('cand-PublicExisting'),
        phone: '+1-555-9999',
        location: 'Mars',
        coverLetter: 'Let me in.',
        consent: 'on',
      },
      { ip: publicIp, userAgent: 'audit6/1.0' },
    )
    const after = await db.candidate.findUnique({
      where: { id: fx.candidates.publicExisting },
      select: { stage: true, rejectedAt: true },
    })
    ok(
      'A31',
      'public apply does NOT change the stage of an existing terminal candidate',
      after?.stage === 'REJECTED' && after?.rejectedAt !== null,
      `stage ${before?.stage} → ${after?.stage} rejectedAt=${after?.rejectedAt?.toISOString() ?? 'null'} ` +
        `applyOk=${res.ok}`,
    )
  })

  await group(['A32'], async () => {
    const after = await db.candidate.findUnique({
      where: { id: fx.candidates.publicExisting },
      select: {
        firstName: true,
        lastName: true,
        phone: true,
        location: true,
        summary: true,
        source: true,
      },
    })
    ok(
      'A32',
      "public apply does NOT overwrite an existing candidate's identity fields",
      after?.firstName === 'Curated' &&
        after?.lastName === 'Name' &&
        after?.phone === '+1-555-0100' &&
        after?.location === 'Cairo' &&
        after?.summary === 'Recruiter-curated cover letter' &&
        after?.source === 'Referral',
      `name=${after?.firstName} ${after?.lastName} phone=${after?.phone} location=${after?.location} ` +
        `source=${after?.source}`,
    )
  })

  await group(['A33'], async () => {
    const first = await submitPublicApplicationAction(
      {
        jobSlug: fx.publicSlug,
        firstName: 'Deterministic',
        lastName: 'One',
        email: fixtureEmail('public-1'),
        consent: 'on',
      },
      { ip: publicIp, userAgent: 'audit6/1.0' },
    )
    const second = await submitPublicApplicationAction(
      {
        jobSlug: fx.publicSlug,
        firstName: 'Deterministic',
        lastName: 'Two',
        email: fixtureEmail('public-2'),
        consent: 'on',
      },
      { ip: publicIp, userAgent: 'audit6/1.0' },
    )
    const c1 = first.ok
      ? await db.candidate.findUnique({
          where: { id: first.candidateId },
          select: { hiringRequestId: true },
        })
      : null
    const c2 = second.ok
      ? await db.candidate.findUnique({
          where: { id: second.candidateId },
          select: { hiringRequestId: true },
        })
      : null
    const hr1 = c1
      ? await db.hiringRequest.findUnique({
          where: { id: c1.hiringRequestId },
          select: { status: true },
        })
      : null
    const deterministic = c1 !== null && c2 !== null && c1.hiringRequestId === c2.hiringRequestId
    const boundToOpen = c1?.hiringRequestId === fx.hrOpen
    ok(
      'A33',
      'public apply attaches to a deterministically-chosen requisition (the bound one)',
      deterministic && boundToOpen,
      `hr1=${c1?.hiringRequestId ?? 'none'} hr2=${c2?.hiringRequestId ?? 'none'} ` +
        `expected=${fx.hrOpen} chosenStatus=${hr1?.status ?? 'none'}`,
    )
  })

  await group(['A34'], async () => {
    const rows = await db.$queryRaw<Array<{ table_name: string }>>(
      Prisma.sql`select table_name from information_schema.tables where table_schema = 'public' and lower(table_name) in ('application','applications')`,
    )
    const table = rows[0]?.table_name
    if (!table) {
      ok(
        'A34',
        'public apply creates an Application row with consentAt set',
        false,
        'no Application table in the database yet (migration not applied)',
      )
    } else {
      const applied = await db.$queryRaw<Array<{ id: string; consent_at: Date | null }>>(
        Prisma.sql`select id, "consentAt" from ${Prisma.raw(`"${table}"`)} where "organizationId" = ${fx.orgA} order by "createdAt" desc limit 5`,
      )
      const withConsent = applied.filter((r) => r.consent_at !== null)
      ok(
        'A34',
        'public apply creates an Application row with consentAt set',
        withConsent.length > 0,
        `application rows=${applied.length} withConsentAt=${withConsent.length}`,
      )
    }
  })

  await group(['A35'], async () => {
    const closed = await submitPublicApplicationAction(
      {
        jobSlug: fx.closedSlug,
        firstName: 'Closed',
        lastName: 'Applicant',
        email: fixtureEmail('closed'),
        consent: 'on',
      },
      { ip: publicIp, userAgent: 'audit6/1.0' },
    )
    const filled = await submitPublicApplicationAction(
      {
        jobSlug: fx.filledSlug,
        firstName: 'Filled',
        lastName: 'Applicant',
        email: fixtureEmail('filled'),
        consent: 'on',
      },
      { ip: publicIp, userAgent: 'audit6/1.0' },
    )
    const closedCandidate = closed.ok
      ? await db.candidate.findUnique({ where: { id: closed.candidateId }, select: { id: true } })
      : null
    const filledCandidate = filled.ok
      ? await db.candidate.findUnique({ where: { id: filled.candidateId }, select: { id: true } })
      : null
    ok(
      'A35',
      'public apply rejects when the bound requisition is closed or filled',
      closed.ok === false && filled.ok === false && closedCandidate === null && filledCandidate === null,
      `closed.ok=${closed.ok} filled.ok=${filled.ok} closedCreated=${closedCandidate !== null} ` +
        `filledCreated=${filledCandidate !== null}`,
    )
  })

  await group(['A36'], async () => {
    const routeSrc = readSource('app/api/public/apply/route.ts')
    const applySrc = readSource('app/(public)/jobs/[slug]/apply-action.ts')
    const limitSrc = readSource('lib/auth/rate-limit.ts')
    const all = `${routeSrc}\n${applySrc}\n${limitSrc}`
    const serverDerived =
      /x-vercel-forwarded-for/i.test(all) ||
      /x-real-ip/i.test(all) ||
      /request\.ip|\breq\.ip\b/.test(all)
    const clientPreferred = /x-forwarded-for['"]\s*\)?\s*\??\.?split\s*\(/i.test(all)
    ok(
      'A36',
      'the public apply rate limit is keyed on a server-derived IP, not a client-set header [static check]',
      serverDerived && !clientPreferred,
      `serverDerived=${serverDerived} clientHeaderPreferred=${clientPreferred}`,
    )
  })

  // ===========================================================================
  // A37-A42 · Onboarding and invitations
  // ===========================================================================
  console.log('\n[A37-A42] Onboarding and invitations')

  await group(['A37'], async () => {
    const pageSrc = readSource('app/onboarding/done/page.tsx')
    const transitionsSrc = readSource('lib/onboarding/transitions.ts')
    const pageBody = extractFunction(pageSrc, 'async function DonePage')
    const completeBody = extractFunction(transitionsSrc, 'export async function completeOnboarding')
    const gated =
      /onboardingStep/.test(pageBody) ||
      /onboardingStep/.test(completeBody) ||
      /canCompleteOnboarding|isOnboardingComplete|stepComplete/i.test(`${pageBody}${completeBody}`)
    ok(
      'A37',
      '/onboarding/done does NOT complete onboarding when the step is incomplete [static check]',
      gated,
      gated
        ? 'the completion path checks the onboarding step'
        : 'the completion path never looks at onboardingStep',
    )
  })

  await group(['A38'], async () => {
    const actionsSrc = readSource('lib/onboarding/actions.ts')
    const swallowed =
      /transitionOnboardingStep\([\s\S]{0,400}?\)\s*\.catch\s*\(\s*\(\s*\)\s*=>\s*null\s*\)/.test(
        actionsSrc,
      )
    const transitionsSrc = readSource('lib/onboarding/transitions.ts')
    const returnsFailure = /INVALID_TRANSITION/.test(transitionsSrc)
    ok(
      'A38',
      'an onboarding step transition failure is surfaced, not swallowed [static check]',
      !swallowed && returnsFailure,
      swallowed
        ? 'a caller still discards the transition result with .catch(() => null)'
        : 'transition results are checked by their callers',
    )
  })

  await group(['A39'], async () => {
    await db.user.update({
      where: { id: fx.adminA },
      data: { onboardingStatus: 'PENDING', onboardingStep: 'ACCOUNT_CREATED' },
    })
    await db.organization.update({
      where: { id: fx.orgA },
      data: { onboardingStatus: 'PENDING' },
    })
    try {
      await completeOnboardingAction()
    } catch {
      /* revalidatePath throws outside a Next request context — the state write
         already happened, which is exactly what this assertion measures. */
    }
    const org = await db.organization.findUnique({
      where: { id: fx.orgA },
      select: { onboardingStatus: true, country: true, timezone: true, industry: true },
    })
    ok(
      'A39',
      'an org cannot be fully onboarded with no company configuration',
      org?.onboardingStatus !== 'COMPLETED',
      `onboardingStatus=${org?.onboardingStatus} country=${org?.country ?? 'null'} ` +
        `timezone=${org?.timezone ?? 'null'} industry=${org?.industry ?? 'null'}`,
    )
    await db.user.update({
      where: { id: fx.adminA },
      data: { onboardingStatus: 'COMPLETED', onboardingStep: 'COMPLETED' },
    })
    await db.organization.update({
      where: { id: fx.orgA },
      data: { onboardingStatus: 'COMPLETED' },
    })
  })

  await group(['A40'], async () => {
    let result: { ok: boolean; reason?: string } | null = null
    let threw: string | null = null
    try {
      result = await acceptInvitation({
        token: fx.activeUserInvitationToken,
        firstName: 'Audit6',
        lastName: 'AlreadyActive',
        password: 'Audit6-Strong-Pass-42',
      })
    } catch (err) {
      threw = err instanceof Error ? err.message : String(err)
    }
    ok(
      'A40',
      'accepting an invitation for an already-active email returns an error, not a crash',
      threw === null && result !== null && result.ok === false,
      threw ? `threw: ${threw}` : `returned ok=${result?.ok} reason=${result?.reason ?? 'none'}`,
    )
  })

  await group(['A41'], async () => {
    const res = await listInvitations({
      organizationId: fx.orgA,
      userId: fx.adminA,
      role: 'ADMIN',
    })
    const rows = res.ok && res.data ? res.data.invitations : []
    const expired = rows.find((i) => i.id === fx.expiredInvitationId)
    ok(
      'A41',
      'the Settings invitation list does not show expired invitations as active',
      expired === undefined || expired.status !== 'PENDING',
      expired
        ? `expired invitation listed with status=${expired.status}`
        : 'expired invitation not listed',
    )
  })

  await group(['A42'], async () => {
    const src = readSource('lib/auth/invitation.ts')
    const verifies =
      /otp/i.test(src) ||
      /verificationToken/i.test(src) ||
      /verifyEmail/i.test(src) ||
      /emailVerification/i.test(src) ||
      /challenge/i.test(src)
    const documented = /limitation/i.test(src) && /(ownership|mailbox|verif)/i.test(src)
    ok(
      'A42',
      'invitation acceptance verifies mailbox ownership, OR the limitation is documented in the code [static check]',
      verifies || documented,
      verifies
        ? 'the invitation flow contains an ownership-verification mechanism'
        : documented
          ? 'the limitation is documented'
          : 'no ownership verification and no documented limitation',
    )
  })

  // ===========================================================================
  // A43-A50 · Reporting and metrics
  // ===========================================================================
  console.log('\n[A43-A50] Reporting and metrics')

  await group(['A43'], async () => {
    const dashboardSrc = [
      readSource('app/(app)/dashboard/actions.ts'),
      readSource('app/(app)/dashboard/_components/dashboard-view.tsx'),
    ].join('\n')
    const hardcoded = /change\s*:\s*-?\d+\s*[,}]/.test(dashboardSrc)
    ok(
      'A43',
      'the dashboard contains NO hardcoded change/trend values [static check]',
      !hardcoded,
      hardcoded
        ? 'a metric literal change: <number> is still hardcoded'
        : 'no hardcoded change literals',
    )
  })

  await group(['A44'], async () => {
    const dashboardSrc = readSource('app/(app)/dashboard/actions.ts')
    const hardcodedDays = /value\s*:\s*['"`]\s*\d+\s*(day|days)\s*['"`]/i.test(dashboardSrc)
    ok(
      'A44',
      'the dashboard has no hardcoded "Avg. Time to Hire" string [static check]',
      !hardcodedDays,
      hardcodedDays
        ? 'a metric value is still a hardcoded number of days'
        : 'no hardcoded day-count metric',
    )
  })

  await group(['A45'], async () => {
    const analytics = await getAnalyticsDataAction()
    const actual = await db.candidate.count({
      where: { organizationId: fx.orgA, stage: 'HIRED' },
    })
    const hireMetric = analytics.metrics.find((m) => m.label.toLowerCase().includes('hire'))
    const reported = hireMetric ? Number(hireMetric.value) : Number.NaN
    ok(
      'A45',
      'the analytics hire count matches the actual number of HIRED candidates',
      Number.isFinite(reported) && reported === actual,
      `reported=${reported} actual=${actual}`,
    )
  })

  await group(['A46'], async () => {
    const hr = await db.hiringRequest.findUnique({
      where: { id: fx.hrOpen },
      select: { filled: true },
    })
    const actual = await db.candidate.count({
      where: { hiringRequestId: fx.hrOpen, stage: 'HIRED' },
    })
    ok(
      'A46',
      'the hiring-request "filled" value equals the actual number of HIRED candidates',
      hr !== null && hr.filled === actual,
      `filled=${hr?.filled} actualHired=${actual}`,
    )
  })

  await group(['A47'], async () => {
    const analytics = await getAnalyticsDataAction()
    const total = await db.candidate.count({ where: { organizationId: fx.orgA } })
    const sum = analytics.funnel.reduce((acc, f) => acc + f.value, 0)
    ok(
      'A47',
      'funnel denominators do not double-count candidates across cumulative stages',
      sum <= total,
      `sum(funnel)=${sum} candidates=${total} funnel=${analytics.funnel
        .map((f) => `${f.label}:${f.value}`)
        .join(', ')}`,
    )
  })

  await group(['A48'], async () => {
    const payload = await getCandidatesAction()
    const rejected = payload.candidates.find((c) => c.id === fx.candidates.rejectedList)
    const withdrawn = payload.candidates.find((c) => c.id === fx.candidates.withdrawnList)
    const applied = payload.candidates.find((c) => c.id === fx.candidates.applied)
    const stageOfRow = (row: typeof applied | undefined): string => String(row?.stage ?? '')
    ok(
      'A48',
      'the candidate list renders REJECTED and WITHDRAWN distinctly from APPLIED',
      rejected !== undefined &&
        withdrawn !== undefined &&
        applied !== undefined &&
        stageOfRow(rejected) !== stageOfRow(applied) &&
        stageOfRow(withdrawn) !== stageOfRow(applied),
      `rejected=${stageOfRow(rejected)} withdrawn=${stageOfRow(withdrawn)} applied=${stageOfRow(applied)}`,
    )
  })

  await group(['A49'], async () => {
    const src = readSource('app/(app)/candidates/actions.ts')
    const body = extractFunction(src, 'function stageToUI')
    const rejectedCase = /case\s+'REJECTED'\s*:[\s\S]*?;/.exec(body)
    const rejectedBranch = rejectedCase ? rejectedCase[0] : ''
    const mapsToApplied = /return\s+'applied'/.test(rejectedBranch)
    ok(
      'A49',
      'a rejected candidate is not displayed with an "applied" badge [static check]',
      !mapsToApplied,
      mapsToApplied
        ? 'stageToUI maps REJECTED → applied'
        : 'stageToUI does not map REJECTED → applied',
    )
  })

  await group(['A50'], async () => {
    const src = readSource('app/(app)/reports/page.tsx')
    const mockMarkers = [
      /mockData/i,
      /fakeData/i,
      /recentRuns?\s*[:=]/i,
      /scheduledReports?\s*[:=]/i,
      /\b20\d\d-\d\d-\d\d\b/,
    ]
    const offender = mockMarkers.find((re) => re.test(src))
    const honest = /coming soon/i.test(src)
    ok(
      'A50',
      'the reports page contains no mock data where real data exists [static check]',
      offender === undefined && honest,
      offender
        ? `mock marker found: ${String(offender)}`
        : honest
          ? 'no mock data blocks; the surface is labelled Coming soon'
          : 'no mock markers, but no honest "Coming soon" marker either',
    )
  })

  // ===========================================================================
  // A51-A56 · Email and CV readability
  // ===========================================================================
  console.log('\n[A51-A56] Email and CV readability')

  await group(['A51'], async () => {
    const expected =
      process.env.EMAIL_PROVIDER === 'resend' && Boolean(process.env.RESEND_API_KEY)
    const reported = isEmailDeliveryConfigured()
    const providerName = getEmailProviderName()
    ok(
      'A51',
      'isEmailDeliveryConfigured() correctly reports the configured state',
      reported === expected && (reported ? providerName === 'resend' : providerName === 'local-outbox'),
      `reported=${reported} expected=${expected} provider=${providerName}`,
    )
  })

  await group(['A52'], async () => {
    const to = fixtureEmail('outbox')
    const res = await sendEmail({
      kind: 'audit6_probe',
      to,
      subject: 'Audit6 probe',
      text: 'Audit6 regression probe.',
    })
    const row = await db.emailOutbox.findFirst({
      where: { kind: 'audit6_probe', to },
      orderBy: { createdAt: 'desc' },
      select: { status: true, subject: true },
    })
    const adminSurfaces = [...listSourceFiles('app'), ...listSourceFiles('features')].filter((f) =>
      /emailOutbox/.test(readFileSync(f, 'utf8')),
    )
    ok(
      'A52',
      'an email send to the local outbox records a delivery status visible to an admin',
      row !== null &&
        typeof row.status === 'string' &&
        row.status.length > 0 &&
        adminSurfaces.length > 0,
      `row=${row ? `status=${row.status}` : 'missing'} delivery=${res.delivery} ` +
        `adminSurfaces=${adminSurfaces.length}`,
    )
  })

  await group(['A53'], async () => {
    const candidatesUi = listSourceFiles('app/(app)/candidates').filter((f) => f.endsWith('.tsx'))
    const rendersParsedText = candidatesUi.some((f) => /parsedText/.test(readFileSync(f, 'utf8')))
    ok(
      'A53',
      'the CV parsed text IS rendered on the candidate profile [static check]',
      rendersParsedText,
      rendersParsedText
        ? 'a candidate UI component renders parsedText'
        : 'no candidate UI component references parsedText',
    )
  })

  await group(['A54'], async () => {
    let storageUrl: string | null = null
    let applyOk: boolean | null = null
    try {
      const cvBuffer = readFileSync(resolve(REPO_ROOT, 'test-fixtures/cvs/marcus-chen-backend.docx'))
      const result = await submitPublicApplicationAction(
        {
          jobSlug: fx.publicSlug,
          firstName: 'Cv',
          lastName: 'Applicant',
          email: fixtureEmail('cv'),
          consent: 'on',
          cv: {
            dataBase64: cvBuffer.toString('base64'),
            fileName: 'marcus-chen-backend.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
        },
        { ip: publicIp, userAgent: 'audit6/1.0' },
      )
      applyOk = result.ok
      if (result.ok) {
        const cvRow = await db.cVFile.findFirst({
          where: { candidateId: result.candidateId },
          orderBy: { uploadedAt: 'desc' },
          select: { storageUrl: true, parsedText: true },
        })
        storageUrl = cvRow?.storageUrl ?? null
      }
    } catch (err) {
      ok(
        'A54',
        'the CV file bytes are not silently discarded without a visible signal',
        false,
        `upload threw: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    if (storageUrl !== null || applyOk === false) {
      const synthetic = storageUrl !== null && storageUrl.startsWith('memory://')
      ok(
        'A54',
        'the CV file bytes are not silently discarded without a visible signal',
        !synthetic || applyOk === false,
        `storageUrl=${storageUrl ?? 'none'} applyRejected=${applyOk === false}`,
      )
    }
  })

  await group(['A55'], async () => {
    const files = [
      ...listSourceFiles('app'),
      ...listSourceFiles('features'),
      ...listSourceFiles('lib'),
    ]
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      let idx = src.indexOf('sendEmail(')
      while (idx !== -1) {
        if (hasBareCatch(src, idx)) offenders.push(file.replace(`${REPO_ROOT}/`, ''))
        idx = src.indexOf('sendEmail(', idx + 1)
      }
    }
    const unique = Array.from(new Set(offenders))
    ok(
      'A55',
      'no email send site swallows its failure in a bare `catch {}` [static check]',
      unique.length === 0,
      unique.length > 0 ? `bare catch in: ${unique.join(', ')}` : 'no bare catch around an email send',
    )
  })

  await group(['A56'], async () => {
    const res = await startInterviewAction(fx.interviewB)
    const interview = await db.interview.findUnique({
      where: { id: fx.interviewB },
      select: { startedAt: true },
    })
    ok(
      'A56',
      'startInterviewAction rejects an unauthorized caller (cross-tenant write refused)',
      res.ok === false && interview?.startedAt === null,
      `ok=${res.ok} startedAt=${interview?.startedAt?.toISOString() ?? 'null'}`,
    )
  })
}

/**
 * Static half of A25: the offer-acceptance write path must commit inside a
 * transaction, otherwise a crash between the four writes leaves a candidate
 * hired with `filled` still at zero.
 */
function isAtomicHireImplementation(): boolean {
  const files = [...listSourceFiles('features/offers'), ...listSourceFiles('lib/offers')]
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    if (!src.includes('$transaction')) continue
    if (/hiredAt|HIRED|filled/.test(src)) return true
  }
  return false
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
