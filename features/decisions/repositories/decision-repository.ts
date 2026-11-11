/**
 * Sprint 8 — Decision Hub repository.
 *
 * All Prisma access for the Decision Hub. Server actions call into these.
 *
 * Design: aggregate queries (counts) live here. Per-candidate detail
 * queries also live here. The action layer is thin: one repository
 * method per "data shape the UI needs".
 */

import { db } from '@/lib/db'
import { Prisma, type EvaluationRecommendation, type ApplicationStage, type CandidateStatus, type InterviewStatus } from '@prisma/client'
import { readinessFromCandidate } from '../services/decision-readiness-service'
import { checkScoreRecommendationConsistency } from '../services/score-consistency-service'
import { canReceiveDecisionOrOffer, isTerminalApplicationStage } from '@/lib/candidates/state-machine'
import type { DecisionBriefSummary, DecisionCandidateView, DecisionHubView, ComparisonView } from '../types'
import type { DecisionBriefOutput } from '@/lib/ai/schemas/decision-brief.schema'

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function getDefaultActorId(orgId: string): Promise<string> {
  const user = await db.user.findFirst({
    where: { organizationId: orgId, role: 'ADMIN' },
    select: { id: true },
  })
  if (user) return user.id
  const any = await db.user.findFirst({
    where: { organizationId: orgId },
    select: { id: true },
  })
  if (!any) throw new Error('No user in organization. Run pnpm db:seed first.')
  return any.id
}

type CandidateWithIncludes = Prisma.CandidateGetPayload<{
  include: typeof CANDIDATE_INCLUDE
}>

function mapCandidateToView(c: CandidateWithIncludes): DecisionCandidateView {
  const breakdown = c.matchScoreBreakdown as { skills?: number; experience?: number; roleAlignment?: number; education?: number } | null
  const latestInterview = c.interviews[0] ?? null
  // Audit P1-07 / P2-15 — a submitted evaluation used to be invisible to
  // the decision flow whenever the candidate had a NEWER interview
  // scheduled but no evaluation yet: the hub only ever looked at
  // `interviews[0].evaluations[0]`. The evaluation is now read across
  // every interview of the candidate, newest first, so what the panel
  // actually wrote is what the reviewer sees.
  const latestEvaluation =
    c.interviews
      .flatMap(i => i.evaluations.map(e => ({ ...e, interviewId: i.id })))
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())[0] ?? null

  const evalRow = latestEvaluation
  const terminal = isTerminalApplicationStage(c.stage)
  const consistency = checkScoreRecommendationConsistency(c.matchScore, c.recommendation)
  const latestDecision = c.candidateDecisions[0] ?? null

  return {
    id: c.id,
    fullName: `${c.firstName} ${c.lastName}`,
    email: c.email,
    currentTitle: c.currentTitle,
    yearsExperience: c.yearsExperience,
    stage: c.stage.toLowerCase() as any,
    status: c.status,
    matchScore: c.matchScore,
    // Audit P2-16 — "never analysed" is its own state. It is NOT a
    // score of 0: a reviewer must not read "no analysis yet" as
    // "terrible candidate".
    analysisState: c.matchScore === null ? 'NOT_ANALYZED' : 'ANALYZED',
    recommendation: c.recommendation as EvaluationRecommendation | null,
    recommendationReasoning: c.recommendationReasoning,
    // Audit P2-03 — the AI recommendation is advisory. The source says
    // whether it came from the machine CV analysis or from a human
    // interviewer's evaluation, and `requiresHumanReview` is always
    // true: only a human decision can reject a candidate.
    recommendationSource: c.recommendation
      ? (evalRow?.recommendation ? 'INTERVIEW_EVALUATION' : 'AI_CV_ANALYSIS')
      : null,
    requiresHumanReview: true,
    matchScoreBreakdown: breakdown
      ? {
          skills: breakdown.skills ?? 0,
          experience: breakdown.experience ?? 0,
          education: breakdown.education ?? 0,
          role: breakdown.roleAlignment ?? 0,
        }
      : null,
    strengths: c.strengths,
    gaps: c.gaps,
    concerns: c.concerns,
    topSkills: c.skills.map(s => s.name).slice(0, 8),
    // Audit P0-10 — a terminal candidate (REJECTED / WITHDRAWN / HIRED)
    // is still LISTED (readiness is a badge, not a filter) but must never
    // be selectable, rejected again, or offered a job.
    selectable: canReceiveDecisionOrOffer(c.stage),
    terminal,
    // Audit P1-20 — the latest human decision is a HOLD, so the
    // candidate is parked and must not be offered a job until the hold
    // is lifted by a new decision.
    onHold: latestDecision?.decision === 'HOLD',
    // Audit P2-26 — a stored score that contradicts the stored
    // recommendation is surfaced instead of being presented as fact.
    scoreRecommendationConsistent: consistency.consistent,
    consistencyWarning: consistency.warning,
    latestInterview: latestInterview
      ? {
          id: latestInterview.id,
          status: latestInterview.status,
          interviewScore: evalRow?.interviewScore ?? null,
          recommendation: evalRow?.recommendation ?? null,
          strengths: evalRow?.strengths ?? null,
          concerns: evalRow?.weaknesses ?? null,
          overallNotes: evalRow?.overallNotes ?? null,
          criterionScores: (evalRow?.criterionScores as Record<string, number> | null) ?? null,
          completedAt: latestInterview.completedAt ? latestInterview.completedAt.toISOString() : null,
        }
      : null,
    // Audit P1-07 — the evaluation the panel actually submitted, so the
    // decision flow can read it back instead of it being write-only.
    latestEvaluation: evalRow
      ? {
          id: evalRow.id,
          interviewId: evalRow.interviewId,
          interviewScore: evalRow.interviewScore,
          overallScore: evalRow.overallScore,
          recommendation: evalRow.recommendation,
          strengths: evalRow.strengths,
          concerns: evalRow.weaknesses,
          overallNotes: evalRow.overallNotes,
          criterionScores: (evalRow.criterionScores as Record<string, number> | null) ?? null,
          evaluatorName: evalRow.evaluator
            ? `${evalRow.evaluator.firstName} ${evalRow.evaluator.lastName}`
            : 'Unknown',
          submittedAt: evalRow.submittedAt.toISOString(),
        }
      : null,
    finalDecision: latestDecision
      ? {
          id: latestDecision.id,
          decision: latestDecision.decision,
          notes: latestDecision.notes,
          reason: latestDecision.reason,
          decidedByName: latestDecision.decidedBy
            ? `${latestDecision.decidedBy.firstName} ${latestDecision.decidedBy.lastName}`
            : 'Unknown',
          decidedAt: latestDecision.decidedAt.toISOString(),
        }
      : null,
    // Audit P2-18 — the full decision history, newest first. A
    // re-decision never overwrites the previous one.
    decisionHistory: c.candidateDecisions.map(d => ({
      id: d.id,
      decision: d.decision,
      notes: d.notes,
      reason: d.reason,
      decidedByName: d.decidedBy
        ? `${d.decidedBy.firstName} ${d.decidedBy.lastName}`
        : 'Unknown',
      decidedAt: d.decidedAt.toISOString(),
    })),
    readiness: readinessFromCandidate({ matchScore: c.matchScore, stage: c.stage }, latestInterview),
  }
}

/**
 * The include shape of the Decision Hub candidate query.
 *
 * Sprint 19 changes:
 *
 *   - `interviews` is no longer `take: 1`. The hub must be able to show
 *     the evaluation of a candidate whose LATEST interview has not been
 *     evaluated yet (audit P1-07), and a follow-up interview must not
 *     hide the interview the panel actually evaluated. The list is
 *     bounded so a candidate with a long interview history cannot blow
 *     up the page.
 *   - `candidateDecisions` is no longer `take: 1`. The decision history
 *     is append-only (audit P2-18) and the hub shows it.
 */
const CANDIDATE_INCLUDE = {
  skills: { orderBy: { isPrimary: 'desc' } },
  interviews: {
    orderBy: { scheduledAt: 'desc' },
    take: 10,
    include: {
      evaluations: {
        orderBy: { submittedAt: 'desc' },
        include: {
          evaluator: { select: { firstName: true, lastName: true } },
        },
      },
    },
  },
  candidateDecisions: {
    orderBy: { decidedAt: 'desc' },
    include: { decidedBy: { select: { firstName: true, lastName: true } } },
  },
} satisfies Prisma.CandidateInclude

// -----------------------------------------------------------------------------
// Read helpers
// -----------------------------------------------------------------------------

export async function findHiringRequestForDecisionHub(hiringRequestId: string, organizationId?: string) {
  return db.hiringRequest.findFirst({
    where: { id: hiringRequestId, ...(organizationId ? { organizationId } : {}) },
    include: {
      department: { select: { name: true } },
      hiringManager: { select: { firstName: true, lastName: true } },
    },
  })
}

export async function listDecisionHubCandidates(
  hiringRequestId: string,
  organizationId?: string
) {
  // Sprint 18 — show ALL candidates for the HR, not just AI-analyzed ones.
  //
  // The previous filter (`matchScore: { not: null }`) hid any candidate that
  // was added without an AI ranking — manual entry, public application
  // (Sprint 17.6), etc. — even though the metrics at the top of the
  // Decision Hub correctly count them. That left a confusing page where
  // "TOTAL: 2" was followed by "0 ready for review" and the empty state
  // "No analyzed candidates yet" even when there were clearly 2 candidates
  // to act on.
  //
  // We now show every candidate, sorted so the most-promising move to the
  // top (analyzed + matched first, by score; everything else after). The
  // "ready for review" badge in the UI marks candidates with a completed
  // interview + evaluation, so the user can see at a glance which ones
  // are actionable.
  //
  // Sprint 19 — the tenant filter is applied IN THE QUERY, next to the
  // requisition filter, so the hub can never list a candidate that
  // belongs to another organization.
  return db.candidate.findMany({
    where: { hiringRequestId, ...(organizationId ? { organizationId } : {}) },
    orderBy: [{ matchScore: { sort: 'desc', nulls: 'last' } }, { lastName: 'asc' }],
    include: CANDIDATE_INCLUDE,
  })
}

export async function getCandidatesByIdsForComparison(
  hiringRequestId: string,
  candidateIds: string[],
  organizationId?: string
) {
  return db.candidate.findMany({
    where: {
      id: { in: candidateIds },
      hiringRequestId,
      ...(organizationId ? { organizationId } : {}),
    },
    orderBy: [{ matchScore: 'desc' }],
    include: CANDIDATE_INCLUDE,
  })
}

export async function getDecisionHubCounts(hiringRequestId: string, organizationId?: string) {
  // One round-trip — groupBy by stage. Finalist count is heuristic:
  // matchScore >= 50 AND in INTERVIEW or beyond.
  const where = { hiringRequestId, ...(organizationId ? { organizationId } : {}) }
  const rows = await db.candidate.groupBy({
    by: ['stage'],
    where,
    _count: { _all: true },
  })
  let total = 0
  let shortlisted = 0
  let interviewed = 0
  for (const r of rows) {
    total += r._count._all
    if (r.stage === 'SCREENING' || r.stage === 'INTERVIEW' || r.stage === 'OFFER' || r.stage === 'HIRED') {
      shortlisted += r._count._all
    }
    if (r.stage === 'INTERVIEW' || r.stage === 'OFFER' || r.stage === 'HIRED') {
      interviewed += r._count._all
    }
  }
  // Selected = explicit CandidateDecision with SELECTED.
  // Sprint 19 — the decision log is APPEND-ONLY (audit P2-18), so a
  // candidate that was selected and later held is counted once per
  // decision row. Counting the LATEST decision per candidate is the
  // meaningful number ("how many candidates are currently selected").
  const decisionRows = await db.candidateDecision.findMany({
    where: { hiringRequestId, ...(organizationId ? { organizationId } : {}) },
    select: { candidateId: true, decision: true },
    orderBy: { decidedAt: 'desc' },
  })
  const latestByCandidate = new Map<string, (typeof decisionRows)[number]>()
  for (const row of decisionRows) {
    if (!latestByCandidate.has(row.candidateId)) latestByCandidate.set(row.candidateId, row)
  }
  const selectedCount = [...latestByCandidate.values()].filter(r => r.decision === 'SELECTED').length
  const rejectedCount = [...latestByCandidate.values()].filter(r => r.decision === 'REJECT').length
  // Finalists: candidates with completed interview + evaluation, OR
  // with a final decision recorded
  const finalistsCount = await db.candidate.count({
    where: {
      hiringRequestId,
      ...(organizationId ? { organizationId } : {}),
      OR: [
        {
          interviews: {
            some: {
              status: 'COMPLETED',
              evaluations: { some: {} },
            },
          },
        },
        {
          candidateDecisions: { some: { hiringRequestId } },
        },
      ],
    },
  })
  return {
    total,
    shortlisted,
    interviewed,
    selected: selectedCount,
    rejected: rejectedCount,
    finalists: finalistsCount,
  }
}

export async function listRecentDecisionHubActivity(hiringRequestId: string, limit = 15) {
  return db.activity.findMany({
    where: { hiringRequestId },
    orderBy: { occurredAt: 'desc' },
    take: limit,
    include: {
      actor: { select: { firstName: true, lastName: true } },
      candidate: { select: { firstName: true, lastName: true } },
    },
  })
}

export async function getLatestDecisionBriefForHR(hiringRequestId: string) {
  const task = await db.aITask.findFirst({
    where: { hiringRequestId, type: 'DECISION_BRIEF', status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
    },
  })
  if (!task) return null
  const meta = (task.metadata as {
    comparedCandidateIds?: string[]
  } | null) ?? null
  return {
    id: task.id,
    hiringRequestId: task.hiringRequestId!,
    comparedCandidateIds: meta?.comparedCandidateIds ?? [],
    output: task.result as unknown as DecisionBriefOutput,
    modelUsed: task.modelUsed,
    createdAt: (task.completedAt ?? task.createdAt).toISOString(),
    createdByName: task.createdBy ? `${task.createdBy.firstName} ${task.createdBy.lastName}` : null,
  } satisfies DecisionBriefSummary
}

/**
 * Audit P2-18 — the LATEST decision for a candidate + requisition.
 *
 * The decision log is append-only, so there is no longer a single row
 * per (candidate, hiring request). "The current decision" is the newest
 * one; `supersedesId` links it to the decision it replaced.
 *
 * The lookup is a `findFirst` ordered by `decidedAt` — NOT a
 * `findUnique` on the old compound unique key, which no longer exists.
 */
export async function findLatestDecision(candidateId: string, hiringRequestId: string) {
  return db.candidateDecision.findFirst({
    where: { candidateId, hiringRequestId },
    orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }],
  })
}

export async function getFinalDecisionForCandidate(candidateId: string) {
  return db.candidateDecision.findFirst({
    where: { candidateId },
    orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }],
  })
}

// -----------------------------------------------------------------------------
// Write helpers
// -----------------------------------------------------------------------------

export interface PersistDecisionBriefInput {
  organizationId: string
  hiringRequestId: string
  createdById: string
  comparedCandidateIds: string[]
  output: DecisionBriefOutput
  prompt: string
  rawText: string
  modelUsed: string | null
  inputTokens: number | null
  outputTokens: number | null
  durationMs: number | null
}

export async function persistDecisionBriefTask(input: PersistDecisionBriefInput) {
  return db.aITask.create({
    data: {
      organizationId: input.organizationId,
      hiringRequestId: input.hiringRequestId,
      createdById: input.createdById,
      type: 'DECISION_BRIEF',
      title: `Decision Brief — ${input.comparedCandidateIds.length} finalist(s)`,
      status: 'COMPLETED',
      prompt: input.prompt,
      result: input.output as unknown as object,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      modelUsed: input.modelUsed,
      durationMs: input.durationMs,
      startedAt: new Date(Date.now() - (input.durationMs ?? 0)),
      completedAt: new Date(),
      metadata: {
        comparedCandidateIds: input.comparedCandidateIds,
        rawTextLength: input.rawText.length,
      },
    },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
    },
  })
}

export interface RecordDecisionRow {
  organizationId: string
  candidateId: string
  hiringRequestId: string
  decision: 'ADVANCE' | 'HOLD' | 'REJECT' | 'SELECTED'
  notes?: string
  reason?: string | null
  decidedById: string
  /** The decision this one replaces (audit P2-18). */
  supersedesId?: string | null
  /** Explicit timestamp — the caller keeps it strictly increasing. */
  decidedAt?: Date
}

/**
 * Audit P2-18 — APPEND a decision. It never overwrites the previous one.
 *
 * The old implementation was an `upsert` on the compound unique key
 * `(candidateId, hiringRequestId)`: a re-decision destroyed the previous
 * decision row, so the history the Decision Brief is built on was not
 * trustworthy. Worse, the activity metadata carried the id of the row it
 * had just overwritten — a decision that pointed at ITSELF as its own
 * predecessor.
 *
 * Now every decision is a new row that names the one it supersedes, and
 * `supersedesId` can never be the new row's own id (the row does not
 * exist yet when the id is chosen).
 */
export async function appendDecision(row: RecordDecisionRow) {
  return db.candidateDecision.create({
    data: {
      organizationId: row.organizationId,
      candidateId: row.candidateId,
      hiringRequestId: row.hiringRequestId,
      decision: row.decision,
      notes: row.notes,
      reason: row.reason,
      decidedById: row.decidedById,
      supersedesId: row.supersedesId ?? null,
      ...(row.decidedAt ? { decidedAt: row.decidedAt } : {}),
    },
    include: { decidedBy: { select: { firstName: true, lastName: true } } },
  })
}

/**
 * The same append, on a transaction client — so the decision row, the
 * stage change and the activity commit or roll back together.
 */
export async function appendDecisionTx(
  tx: Prisma.TransactionClient,
  row: RecordDecisionRow
) {
  return tx.candidateDecision.create({
    data: {
      organizationId: row.organizationId,
      candidateId: row.candidateId,
      hiringRequestId: row.hiringRequestId,
      decision: row.decision,
      notes: row.notes,
      reason: row.reason,
      decidedById: row.decidedById,
      supersedesId: row.supersedesId ?? null,
      ...(row.decidedAt ? { decidedAt: row.decidedAt } : {}),
    },
    include: { decidedBy: { select: { firstName: true, lastName: true } } },
  })
}

export async function createDecisionActivity(args: {
  organizationId: string
  type:
    | 'DECISION_BRIEF_GENERATED'
    | 'COMPARISON_VIEWED'
    | 'CANDIDATE_SELECTED'
    | 'CANDIDATE_HELD'
    | 'CANDIDATE_REJECTED'
    | 'CANDIDATE_ADVANCED'
  actorId: string
  candidateId: string | null
  hiringRequestId: string
  candidateDecisionId?: string
  title: string
  description?: string
  metadata?: Record<string, unknown>
}) {
  return db.activity.create({
    data: {
      organizationId: args.organizationId,
      type: args.type,
      actorId: args.actorId,
      candidateId: args.candidateId,
      hiringRequestId: args.hiringRequestId,
      candidateDecisionId: args.candidateDecisionId,
      title: args.title,
      description: args.description,
      metadata: (args.metadata ?? {}) as object,
    },
    include: {
      actor: { select: { firstName: true, lastName: true } },
      candidate: { select: { firstName: true, lastName: true } },
    },
  })
}

/**
 * The same activity write, on a transaction client.
 *
 * Audit P2-28 / P0-10 — the decision row, the stage change and the
 * activity that records them must commit together. A crash between them
 * must not leave a decision without a timeline entry (or the other way
 * round).
 */
export async function createDecisionActivityTx(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string
    type:
      | 'DECISION_BRIEF_GENERATED'
      | 'COMPARISON_VIEWED'
      | 'CANDIDATE_SELECTED'
      | 'CANDIDATE_HELD'
      | 'CANDIDATE_REJECTED'
      | 'CANDIDATE_ADVANCED'
    actorId: string
    candidateId: string | null
    hiringRequestId: string
    candidateDecisionId?: string
    title: string
    description?: string
    metadata?: Record<string, unknown>
  },
) {
  return tx.activity.create({
    data: {
      organizationId: args.organizationId,
      type: args.type,
      actorId: args.actorId,
      candidateId: args.candidateId,
      hiringRequestId: args.hiringRequestId,
      candidateDecisionId: args.candidateDecisionId,
      title: args.title,
      description: args.description,
      metadata: (args.metadata ?? {}) as object,
    },
    include: {
      actor: { select: { firstName: true, lastName: true } },
      candidate: { select: { firstName: true, lastName: true } },
    },
  })
}

// -----------------------------------------------------------------------------
// View builders
// -----------------------------------------------------------------------------

export async function buildDecisionHubView(hiringRequestId: string, organizationId: string): Promise<DecisionHubView | null> {
  const hr = await findHiringRequestForDecisionHub(hiringRequestId, organizationId)
  if (!hr) return null
  const [candRows, counts, activities, latestBrief] = await Promise.all([
    listDecisionHubCandidates(hiringRequestId, organizationId),
    getDecisionHubCounts(hiringRequestId, organizationId),
    listRecentDecisionHubActivity(hiringRequestId, 12),
    getLatestDecisionBriefForHR(hiringRequestId),
  ])
  const candidates = candRows.map(c => mapCandidateToView(c))
  return {
    hiringRequest: {
      id: hr.id,
      title: hr.title,
      status: hr.status,
      department: hr.department.name,
      location: hr.location,
      hiringManagerName: hr.hiringManager
        ? `${hr.hiringManager.firstName} ${hr.hiringManager.lastName}`
        : null,
      openings: hr.openings,
      filled: hr.filled,
    },
    counts,
    candidates,
    // Audit P0-10 — readiness is a BADGE, not a visibility filter: every
    // candidate of the requisition is listed above. This list is the
    // subset that may still be decided on / offered a job. A terminal
    // candidate (REJECTED / WITHDRAWN / HIRED) is never in it.
    selectableCandidateIds: candidates.filter(c => c.selectable).map(c => c.id),
    recentActivities: activities.map(a => ({
      id: a.id,
      type: a.type,
      title: a.title,
      description: a.description,
      occurredAt: a.occurredAt.toISOString(),
      actorName: a.actor ? `${a.actor.firstName} ${a.actor.lastName}` : null,
      candidateName: a.candidate ? `${a.candidate.firstName} ${a.candidate.lastName}` : null,
    })),
    latestBrief,
  }
}

export async function buildComparisonView(
  hiringRequestId: string,
  organizationId: string,
  candidateIds: string[]
): Promise<ComparisonView | null> {
  if (candidateIds.length < 2 || candidateIds.length > 4) {
    return null
  }
  const hr = await findHiringRequestForDecisionHub(hiringRequestId, organizationId)
  if (!hr) return null
  const [candRows, latestBrief] = await Promise.all([
    getCandidatesByIdsForComparison(hiringRequestId, candidateIds, organizationId),
    getLatestDecisionBriefForHR(hiringRequestId),
  ])
  // Only return the brief if it was generated for this exact set of candidates
  const brief =
    latestBrief && sameSet(latestBrief.comparedCandidateIds, candidateIds) ? latestBrief : null
  return {
    hiringRequest: {
      id: hr.id,
      title: hr.title,
      status: hr.status,
      department: hr.department.name,
      location: hr.location,
      hiringManagerName: hr.hiringManager
        ? `${hr.hiringManager.firstName} ${hr.hiringManager.lastName}`
        : null,
      openings: hr.openings,
      filled: hr.filled,
    },
    candidates: candRows.map(c => mapCandidateToView(c)),
    brief,
  }
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  for (const x of b) if (!sa.has(x)) return false
  return true
}

