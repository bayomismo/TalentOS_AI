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
  const evalRow = latestInterview?.evaluations[0] ?? null
  return {
    id: c.id,
    fullName: `${c.firstName} ${c.lastName}`,
    email: c.email,
    currentTitle: c.currentTitle,
    yearsExperience: c.yearsExperience,
    stage: c.stage.toLowerCase() as any,
    status: c.status,
    matchScore: c.matchScore,
    recommendation: c.recommendation as EvaluationRecommendation | null,
    recommendationReasoning: c.recommendationReasoning,
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
    finalDecision: c.candidateDecisions[0]
      ? {
          id: c.candidateDecisions[0].id,
          decision: c.candidateDecisions[0].decision,
          notes: c.candidateDecisions[0].notes,
          reason: c.candidateDecisions[0].reason,
          decidedByName: c.candidateDecisions[0].decidedBy
            ? `${c.candidateDecisions[0].decidedBy.firstName} ${c.candidateDecisions[0].decidedBy.lastName}`
            : 'Unknown',
          decidedAt: c.candidateDecisions[0].decidedAt.toISOString(),
        }
      : null,
    readiness: readinessFromCandidate({ matchScore: c.matchScore }, latestInterview),
  }
}

const CANDIDATE_INCLUDE = {
  skills: { orderBy: { isPrimary: 'desc' } },
  interviews: {
    orderBy: { scheduledAt: 'desc' },
    take: 1,
    include: {
      evaluations: {
        orderBy: { submittedAt: 'desc' },
        take: 1,
        include: {
          evaluator: { select: { firstName: true, lastName: true } },
        },
      },
    },
  },
  candidateDecisions: {
    orderBy: { decidedAt: 'desc' },
    take: 1,
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

export async function listDecisionHubCandidates(hiringRequestId: string) {
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
  return db.candidate.findMany({
    where: { hiringRequestId },
    orderBy: [{ matchScore: { sort: 'desc', nulls: 'last' } }, { lastName: 'asc' }],
    include: CANDIDATE_INCLUDE,
  })
}

export async function getCandidatesByIdsForComparison(
  hiringRequestId: string,
  candidateIds: string[]
) {
  return db.candidate.findMany({
    where: { id: { in: candidateIds }, hiringRequestId },
    orderBy: [{ matchScore: 'desc' }],
    include: CANDIDATE_INCLUDE,
  })
}

export async function getDecisionHubCounts(hiringRequestId: string) {
  // One round-trip — groupBy by stage. Finalist count is heuristic:
  // matchScore >= 50 AND in INTERVIEW or beyond.
  const rows = await db.candidate.groupBy({
    by: ['stage'],
    where: { hiringRequestId },
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
  // Selected = explicit CandidateDecision with SELECTED
  const selectedCount = await db.candidateDecision.count({
    where: { hiringRequestId, decision: 'SELECTED' },
  })
  const rejectedCount = await db.candidateDecision.count({
    where: { hiringRequestId, decision: 'REJECT' },
  })
  // Finalists: candidates with completed interview + evaluation, OR
  // with a final decision recorded
  const finalistsCount = await db.candidate.count({
    where: {
      hiringRequestId,
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

export async function findExistingDecision(candidateId: string, hiringRequestId: string) {
  return db.candidateDecision.findUnique({
    where: { candidateId_hiringRequestId: { candidateId, hiringRequestId } },
  })
}

export async function getFinalDecisionForCandidate(candidateId: string) {
  return db.candidateDecision.findUnique({
    where: { candidateId_hiringRequestId: { candidateId, hiringRequestId: '' } },
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
}

export async function upsertDecision(row: RecordDecisionRow) {
  return db.candidateDecision.upsert({
    where: {
      candidateId_hiringRequestId: {
        candidateId: row.candidateId,
        hiringRequestId: row.hiringRequestId,
      },
    },
    create: {
      organizationId: row.organizationId,
      candidateId: row.candidateId,
      hiringRequestId: row.hiringRequestId,
      decision: row.decision,
      notes: row.notes,
      reason: row.reason,
      decidedById: row.decidedById,
    },
    update: {
      decision: row.decision,
      notes: row.notes,
      reason: row.reason,
      decidedById: row.decidedById,
      decidedAt: new Date(),
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

// -----------------------------------------------------------------------------
// View builders
// -----------------------------------------------------------------------------

export async function buildDecisionHubView(hiringRequestId: string, organizationId: string): Promise<DecisionHubView | null> {
  const hr = await findHiringRequestForDecisionHub(hiringRequestId, organizationId)
  if (!hr) return null
  const [candRows, counts, activities, latestBrief] = await Promise.all([
    listDecisionHubCandidates(hiringRequestId),
    getDecisionHubCounts(hiringRequestId),
    listRecentDecisionHubActivity(hiringRequestId, 12),
    getLatestDecisionBriefForHR(hiringRequestId),
  ])
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
    candidates: candRows.map(c => mapCandidateToView(c)),
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
    getCandidatesByIdsForComparison(hiringRequestId, candidateIds),
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

