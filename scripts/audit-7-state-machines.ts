/**
 * Sprint 19 — State machine unit tests (pure, no DB).
 *
 * Covers every state machine the business-flow audit touched:
 *   1. Candidate stage machine      — lib/candidates/state-machine.ts
 *   2. Hiring-request machine        — lib/hiring-requests/state-machine.ts
 *   3. Interview machine             — lib/interviews/state-machine.ts
 *   4. Application machine           — lib/applications/state-machine.ts
 *   5. Offer machine                — lib/offers/state-machine.ts
 *
 * For each machine the suite asserts:
 *   - every LEGAL transition is accepted,
 *   - every ILLEGAL transition is rejected — the full status × status
 *     matrix, so no gap can hide,
 *   - a rejection names BOTH the source and the target stage/status,
 *   - a legal transition produces a transition code that matches the
 *     declared vocabulary,
 *   - `allowedNext*` returns exactly the legal set,
 *   - `isTerminal*` agrees with the legal set.
 *
 * Run: npx tsx --env-file=.env scripts/audit-7-state-machines.ts
 */
import {
  ApplicationStage,
  HiringRequestStatus,
  InterviewStatus,
  OfferStatus,
} from '@prisma/client'
import {
  validateStageTransition,
  allowedNextStages,
  isTerminalStage,
  isTerminalApplicationStage,
  canReceiveDecisionOrOffer,
} from '../lib/candidates/state-machine'
import {
  validateHiringRequestTransition,
  allowedNextHiringRequestStatuses,
  isTerminalHiringRequestStatus,
} from '../lib/hiring-requests/state-machine'
import {
  validateInterviewTransition,
  allowedNextInterviewStatuses,
  isTerminalInterviewStatus,
} from '../lib/interviews/state-machine'
import {
  validateApplicationTransition,
  allowedNextApplicationStages,
} from '../lib/applications/state-machine'
import {
  validateTransition as validateOfferTransition,
  allowedNextStatuses as allowedNextOfferStatuses,
  isTerminalStatus as isTerminalOfferStatus,
} from '../lib/offers/state-machine'

let pass = 0, fail = 0
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}

/** The minimum surface every machine exposes, so one checker can drive them all. */
interface Machine<S extends string> {
  title: string
  statuses: S[]
  /** The legal destinations per source status. The source of truth for the test. */
  allowed: Record<S, S[]>
  /** Prefix of the transition code a legal transition must produce. */
  codePrefix: string
  validate: (from: S, to: S) => { ok: boolean; code?: string; reason?: string }
  allowedNext: (from: S) => ReadonlyArray<S>
  isTerminal: (s: S) => boolean
}

function sameSet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((v, i) => v === right[i])
}

function checkMachine<S extends string>(m: Machine<S>) {
  console.log(`\n=== ${m.title} ===`)

  // 1. Every legal transition is accepted.
  console.log('[1] Legal transitions are accepted')
  for (const from of m.statuses) {
    for (const to of m.allowed[from]) {
      ok(`${from} → ${to}`, m.validate(from, to).ok)
    }
  }

  // 2. The full matrix: anything not in the legal set must be rejected.
  console.log('\n[2] Every other transition is rejected (full matrix)')
  for (const from of m.statuses) {
    for (const to of m.statuses) {
      const legal = from !== to && m.allowed[from].includes(to)
      const r = m.validate(from, to)
      ok(`${from} → ${to} ${legal ? 'accepted' : 'rejected'}`, r.ok === legal, `expected ok=${legal}`)
      if (!r.ok) {
        ok(
          `${from} → ${to} rejection names both stages`,
          typeof r.reason === 'string' && r.reason.includes(from) && r.reason.includes(to),
          r.reason,
        )
      }
    }
  }

  // 3. A legal transition produces the declared transition code.
  console.log('\n[3] Transition codes match the declared vocabulary')
  for (const from of m.statuses) {
    for (const to of m.allowed[from]) {
      const r = m.validate(from, to)
      ok(
        `${from} → ${to} code = ${m.codePrefix}${from}_TO_${to}`,
        r.ok && r.code === `${m.codePrefix}${from}_TO_${to}`,
        r.code,
      )
    }
  }

  // 4. allowedNext returns exactly the legal set.
  console.log('\n[4] allowedNext returns the legal set')
  for (const from of m.statuses) {
    ok(
      `allowedNext(${from}) = [${m.allowed[from].join(', ')}]`,
      sameSet(m.allowedNext(from), m.allowed[from]),
      `[${m.allowedNext(from).join(', ')}]`,
    )
  }

  // 5. isTerminal agrees with the legal set.
  console.log('\n[5] isTerminal agrees with the legal set')
  for (const s of m.statuses) {
    const terminal = m.allowed[s].length === 0
    ok(`${s} terminal = ${terminal}`, m.isTerminal(s) === terminal)
  }

  // 6. Self-transitions are always rejected.
  console.log('\n[6] Self-transitions are rejected')
  for (const s of m.statuses) {
    ok(`${s} → ${s} rejected`, !m.validate(s, s).ok)
  }
}

// ---------------------------------------------------------------------------
// 1. Candidate stage machine
// ---------------------------------------------------------------------------
const candidateMachine: Machine<ApplicationStage> = {
  title: 'Candidate stage machine',
  statuses: [
    ApplicationStage.APPLIED,
    ApplicationStage.SCREENING,
    ApplicationStage.INTERVIEW,
    ApplicationStage.OFFER,
    ApplicationStage.HIRED,
    ApplicationStage.REJECTED,
    ApplicationStage.WITHDRAWN,
  ],
  allowed: {
    [ApplicationStage.APPLIED]: [ApplicationStage.SCREENING, ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN],
    [ApplicationStage.SCREENING]: [ApplicationStage.INTERVIEW, ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN],
    [ApplicationStage.INTERVIEW]: [ApplicationStage.OFFER, ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN],
    [ApplicationStage.OFFER]: [ApplicationStage.HIRED, ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN],
    [ApplicationStage.HIRED]: [],
    [ApplicationStage.REJECTED]: [],
    [ApplicationStage.WITHDRAWN]: [],
  },
  codePrefix: 'STAGE_',
  validate: (from, to) => validateStageTransition(from, to),
  allowedNext: (from) => allowedNextStages(from),
  isTerminal: (s) => isTerminalStage(s),
}

// ---------------------------------------------------------------------------
// 2. Hiring-request machine
// ---------------------------------------------------------------------------
const hiringRequestMachine: Machine<HiringRequestStatus> = {
  title: 'Hiring-request machine',
  statuses: [
    HiringRequestStatus.DRAFT,
    HiringRequestStatus.OPEN,
    HiringRequestStatus.ON_HOLD,
    HiringRequestStatus.CLOSED,
    HiringRequestStatus.FILLED,
    HiringRequestStatus.CANCELLED,
  ],
  allowed: {
    [HiringRequestStatus.DRAFT]: [HiringRequestStatus.OPEN, HiringRequestStatus.CANCELLED],
    [HiringRequestStatus.OPEN]: [
      HiringRequestStatus.ON_HOLD,
      HiringRequestStatus.CLOSED,
      HiringRequestStatus.FILLED,
      HiringRequestStatus.CANCELLED,
    ],
    [HiringRequestStatus.ON_HOLD]: [HiringRequestStatus.OPEN, HiringRequestStatus.CLOSED, HiringRequestStatus.CANCELLED],
    [HiringRequestStatus.CLOSED]: [HiringRequestStatus.OPEN],
    [HiringRequestStatus.FILLED]: [HiringRequestStatus.OPEN],
    [HiringRequestStatus.CANCELLED]: [HiringRequestStatus.DRAFT],
  },
  codePrefix: '',
  validate: (from, to) => validateHiringRequestTransition(from, to),
  allowedNext: (from) => allowedNextHiringRequestStatuses(from),
  isTerminal: (s) => isTerminalHiringRequestStatus(s),
}

// ---------------------------------------------------------------------------
// 3. Interview machine
// ---------------------------------------------------------------------------
const interviewMachine: Machine<InterviewStatus> = {
  title: 'Interview machine',
  statuses: [
    InterviewStatus.SCHEDULED,
    InterviewStatus.IN_PROGRESS,
    InterviewStatus.COMPLETED,
    InterviewStatus.CANCELLED,
    InterviewStatus.NO_SHOW,
    InterviewStatus.RESCHEDULED,
  ],
  allowed: {
    [InterviewStatus.SCHEDULED]: [
      InterviewStatus.IN_PROGRESS,
      InterviewStatus.CANCELLED,
      InterviewStatus.NO_SHOW,
      InterviewStatus.RESCHEDULED,
    ],
    [InterviewStatus.RESCHEDULED]: [
      InterviewStatus.SCHEDULED,
      InterviewStatus.CANCELLED,
      InterviewStatus.NO_SHOW,
    ],
    [InterviewStatus.IN_PROGRESS]: [
      InterviewStatus.COMPLETED,
      InterviewStatus.CANCELLED,
      InterviewStatus.NO_SHOW,
    ],
    [InterviewStatus.NO_SHOW]: [InterviewStatus.RESCHEDULED],
    [InterviewStatus.COMPLETED]: [],
    [InterviewStatus.CANCELLED]: [],
  },
  codePrefix: '',
  validate: (from, to) => validateInterviewTransition(from, to),
  allowedNext: (from) => allowedNextInterviewStatuses(from),
  isTerminal: (s) => isTerminalInterviewStatus(s),
}

// ---------------------------------------------------------------------------
// 4. Application machine
// ---------------------------------------------------------------------------
const applicationMachine: Machine<ApplicationStage> = {
  title: 'Application machine',
  statuses: [
    ApplicationStage.APPLIED,
    ApplicationStage.SCREENING,
    ApplicationStage.INTERVIEW,
    ApplicationStage.OFFER,
    ApplicationStage.HIRED,
    ApplicationStage.REJECTED,
    ApplicationStage.WITHDRAWN,
  ],
  allowed: {
    [ApplicationStage.APPLIED]: [ApplicationStage.SCREENING, ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN],
    [ApplicationStage.SCREENING]: [ApplicationStage.INTERVIEW, ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN],
    [ApplicationStage.INTERVIEW]: [
      ApplicationStage.OFFER,
      ApplicationStage.SCREENING,
      ApplicationStage.REJECTED,
      ApplicationStage.WITHDRAWN,
    ],
    [ApplicationStage.OFFER]: [ApplicationStage.HIRED, ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN],
    [ApplicationStage.HIRED]: [],
    [ApplicationStage.REJECTED]: [],
    [ApplicationStage.WITHDRAWN]: [],
  },
  codePrefix: '',
  validate: (from, to) => validateApplicationTransition(from, to),
  allowedNext: (from) => allowedNextApplicationStages(from),
  isTerminal: (s) => allowedNextApplicationStages(s).length === 0,
}

// ---------------------------------------------------------------------------
// 5. Offer machine (Sprint 19 P1-03 / P3-03)
// ---------------------------------------------------------------------------
const offerMachine: Machine<OfferStatus> = {
  title: 'Offer machine',
  statuses: [
    OfferStatus.DRAFT,
    OfferStatus.PENDING_APPROVAL,
    OfferStatus.APPROVED,
    OfferStatus.ISSUED,
    OfferStatus.SENT,
    OfferStatus.UNDER_REVIEW,
    OfferStatus.ACCEPTED,
    OfferStatus.DECLINED,
    OfferStatus.WITHDRAWN,
    OfferStatus.EXPIRED,
  ],
  allowed: {
    [OfferStatus.DRAFT]: [OfferStatus.PENDING_APPROVAL],
    [OfferStatus.PENDING_APPROVAL]: [OfferStatus.APPROVED, OfferStatus.DRAFT],
    [OfferStatus.APPROVED]: [OfferStatus.ISSUED, OfferStatus.WITHDRAWN, OfferStatus.EXPIRED],
    [OfferStatus.ISSUED]: [
      OfferStatus.ACCEPTED,
      OfferStatus.DECLINED,
      OfferStatus.WITHDRAWN,
      OfferStatus.EXPIRED,
    ],
    [OfferStatus.SENT]: [
      OfferStatus.ACCEPTED,
      OfferStatus.DECLINED,
      OfferStatus.WITHDRAWN,
      OfferStatus.EXPIRED,
    ],
    [OfferStatus.UNDER_REVIEW]: [
      OfferStatus.ACCEPTED,
      OfferStatus.DECLINED,
      OfferStatus.WITHDRAWN,
      OfferStatus.EXPIRED,
    ],
    [OfferStatus.ACCEPTED]: [],
    [OfferStatus.DECLINED]: [],
    [OfferStatus.WITHDRAWN]: [],
    [OfferStatus.EXPIRED]: [],
  },
  codePrefix: '',
  validate: (from, to) => validateOfferTransition(from, to),
  allowedNext: (from) => allowedNextOfferStatuses(from),
  isTerminal: (s) => isTerminalOfferStatus(s),
}

function main() {
  console.log('=== State machines ===\n')

  checkMachine(candidateMachine)
  checkMachine(hiringRequestMachine)
  checkMachine(interviewMachine)
  checkMachine(applicationMachine)
  checkMachine(offerMachine)

  // -------------------------------------------------------------------------
  // Candidate-specific helpers
  // -------------------------------------------------------------------------
  console.log('\n=== Candidate helpers ===')

  console.log('\n[7] isTerminalApplicationStage mirrors isTerminalStage')
  for (const stage of candidateMachine.statuses) {
    ok(
      `isTerminalApplicationStage(${stage}) = isTerminalStage(${stage})`,
      isTerminalApplicationStage(stage) === isTerminalStage(stage),
    )
  }

  console.log('\n[8] canReceiveDecisionOrOffer')
  for (const stage of candidateMachine.statuses) {
    const terminal = isTerminalStage(stage)
    ok(
      `canReceiveDecisionOrOffer(${stage}) = ${!terminal}`,
      canReceiveDecisionOrOffer(stage) === !terminal,
    )
  }
  ok('a HIRED candidate cannot receive a decision or an offer', !canReceiveDecisionOrOffer(ApplicationStage.HIRED))
  ok('a REJECTED candidate cannot receive a decision or an offer', !canReceiveDecisionOrOffer(ApplicationStage.REJECTED))
  ok('a WITHDRAWN candidate cannot receive a decision or an offer', !canReceiveDecisionOrOffer(ApplicationStage.WITHDRAWN))
  ok('an APPLIED candidate can still receive a decision or an offer', canReceiveDecisionOrOffer(ApplicationStage.APPLIED))

  // -------------------------------------------------------------------------
  // Audit P1-03 — APPROVED is no longer a one-way dead end.
  // -------------------------------------------------------------------------
  console.log('\n=== Offer P1-03 regression ===')
  ok('APPROVED → WITHDRAWN is legal', validateOfferTransition(OfferStatus.APPROVED, OfferStatus.WITHDRAWN).ok)
  ok('APPROVED → EXPIRED is legal', validateOfferTransition(OfferStatus.APPROVED, OfferStatus.EXPIRED).ok)
  ok('APPROVED → DRAFT is still illegal', !validateOfferTransition(OfferStatus.APPROVED, OfferStatus.DRAFT).ok)
  ok('APPROVED → ACCEPTED is still illegal (must be ISSUED first)', !validateOfferTransition(OfferStatus.APPROVED, OfferStatus.ACCEPTED).ok)

  // -------------------------------------------------------------------------
  // Audit P3-03 — the transition-code vocabulary is consistent.
  // -------------------------------------------------------------------------
  console.log('\n=== Offer P3-03 regression (code vocabulary) ===')
  const produced = new Set<string>()
  for (const from of offerMachine.statuses) {
    for (const to of offerMachine.statuses) {
      const r = validateOfferTransition(from, to)
      if (r.ok && r.code) produced.add(r.code)
    }
  }
  ok(
    `every produced code is a FROM_TO_TO pair (${produced.size} codes)`,
    [...produced].every((c) => /^[A-Z_]+_TO_[A-Z_]+$/.test(c)),
  )
  ok(
    'no produced code is PENDING_APPROVAL_TO_RETURNED_FOR_CHANGES',
    !produced.has('PENDING_APPROVAL_TO_RETURNED_FOR_CHANGES'),
  )
  ok(
    'the legacy SENT / UNDER_REVIEW codes are produced',
    produced.has('SENT_TO_ACCEPTED') && produced.has('UNDER_REVIEW_TO_ACCEPTED'),
  )
  ok(
    'the new APPROVED codes are produced',
    produced.has('APPROVED_TO_WITHDRAWN') && produced.has('APPROVED_TO_EXPIRED'),
  )

  console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
  if (fail > 0) process.exit(1)
}

main()
