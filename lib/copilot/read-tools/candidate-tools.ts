/**
 * Sprint 11 — Candidate read tools.
 */

import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { CopilotTool } from '../types'
import { MAX_RECORDS_PER_TOOL } from '../types'

const CandidatesByStageInput = z.object({
  stages: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(MAX_RECORDS_PER_TOOL).default(50),
})

const CandidatesByStageOutput = z.object({
  total: z.number(),
  byStage: z.record(z.string(), z.number()),
  records: z.array(z.object({
    id: z.string(),
    name: z.string(),
    stage: z.string(),
    hiringRequestId: z.string(),
    hiringRequestTitle: z.string(),
    updatedAt: z.string(),
  })),
})

export const getCandidatesByStageTool: CopilotTool<z.infer<typeof CandidatesByStageInput>, z.infer<typeof CandidatesByStageOutput>> = {
  id: 'get_candidates_by_stage',
  description: 'List candidates in the user\'s organization, optionally filtered by stage. Returns the count per stage and a record list (id, name, stage, hiring request).',
  requiredPermission: 'candidate.view',
  inputSchema: CandidatesByStageInput,
  outputSchema: CandidatesByStageOutput,
  async execute(ctx, input) {
    const where: any = { organizationId: ctx.organizationId }
    if (input.stages && input.stages.length > 0) where.stage = { in: input.stages }
    const [total, rows] = await Promise.all([
      db.candidate.count({ where }),
      db.candidate.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: input.limit,
        include: { hiringRequest: { select: { id: true, title: true } } },
      }),
    ])
    const groups = await db.candidate.groupBy({ by: ['stage'], where: { organizationId: ctx.organizationId }, _count: { _all: true } })
    const byStage: Record<string, number> = {}
    for (const g of groups) byStage[g.stage] = g._count._all
    return {
      total,
      byStage,
      records: rows.map(r => ({
        id: r.id,
        name: `${r.firstName} ${r.lastName}`.trim(),
        stage: r.stage,
        hiringRequestId: r.hiringRequest.id,
        hiringRequestTitle: r.hiringRequest.title,
        updatedAt: r.updatedAt.toISOString(),
      })),
    }
  },
}

const AwaitingInterviewInput = z.object({
  limit: z.number().int().min(1).max(MAX_RECORDS_PER_TOOL).default(50),
})

const AwaitingInterviewOutput = z.object({
  total: z.number(),
  records: z.array(z.object({
    candidateId: z.string(),
    candidateName: z.string(),
    hiringRequestId: z.string(),
    hiringRequestTitle: z.string(),
    stage: z.string(),
  })),
})

export const getCandidatesAwaitingInterviewTool: CopilotTool<z.infer<typeof AwaitingInterviewInput>, z.infer<typeof AwaitingInterviewOutput>> = {
  id: 'get_candidates_awaiting_interview',
  description: 'List candidates in the SCREENING or INTERVIEW stage who do not yet have a confirmed/scheduled interview. Useful for "who needs an interview?" questions.',
  requiredPermission: 'candidate.view',
  inputSchema: AwaitingInterviewInput,
  outputSchema: AwaitingInterviewOutput,
  async execute(ctx, input) {
    // Candidates in INTERVIEW stage (not yet scheduled)
    const rows = await db.candidate.findMany({
      where: {
        organizationId: ctx.organizationId,
        stage: { in: ['INTERVIEW', 'SCREENING'] as never[] },
        interviews: { none: { status: { in: ['SCHEDULED', 'CONFIRMED', 'COMPLETED'] as never[] } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: input.limit,
      include: { hiringRequest: { select: { id: true, title: true } } },
    })
    return {
      total: rows.length,
      records: rows.map(r => ({
        candidateId: r.id,
        candidateName: `${r.firstName} ${r.lastName}`.trim(),
        hiringRequestId: r.hiringRequest.id,
        hiringRequestTitle: r.hiringRequest.title,
        stage: r.stage,
      })),
    }
  },
}

const AwaitingEvaluationInput = z.object({
  limit: z.number().int().min(1).max(MAX_RECORDS_PER_TOOL).default(50),
})

const AwaitingEvaluationOutput = z.object({
  total: z.number(),
  records: z.array(z.object({
    interviewId: z.string(),
    candidateId: z.string(),
    candidateName: z.string(),
    hiringRequestTitle: z.string(),
    scheduledAt: z.string().nullable(),
  })),
})

export const getCandidatesAwaitingEvaluationTool: CopilotTool<z.infer<typeof AwaitingEvaluationInput>, z.infer<typeof AwaitingEvaluationOutput>> = {
  id: 'get_candidates_awaiting_evaluation',
  description: 'List interviews that have been completed but do not yet have a submitted evaluation. Returns the candidate + hiring request for each.',
  requiredPermission: 'interview.view',
  inputSchema: AwaitingEvaluationInput,
  outputSchema: AwaitingEvaluationOutput,
  async execute(ctx, input) {
    const rows = await db.interview.findMany({
      where: {
        organizationId: ctx.organizationId,
        status: 'COMPLETED' as never,
        evaluations: { none: {} },
      },
      orderBy: { scheduledAt: 'desc' },
      take: input.limit,
      include: {
        candidate: { select: { id: true, firstName: true, lastName: true } },
        hiringRequest: { select: { title: true } },
      },
    })
    return {
      total: rows.length,
      records: rows.map(r => ({
        interviewId: r.id,
        candidateId: r.candidate.id,
        candidateName: `${r.candidate.firstName} ${r.candidate.lastName}`.trim(),
        hiringRequestTitle: r.hiringRequest.title,
        scheduledAt: r.scheduledAt?.toISOString() ?? null,
      })),
    }
  },
}

const CandidateSummaryInput = z.object({
  candidateId: z.string().uuid(),
})

const CandidateSummaryOutput = z.object({
  found: z.boolean(),
  id: z.string().optional(),
  name: z.string().optional(),
  stage: z.string().optional(),
  hiringRequestId: z.string().optional(),
  hiringRequestTitle: z.string().optional(),
  hasAIAnalysis: z.boolean().optional(),
  hasInterview: z.boolean().optional(),
  hasEvaluation: z.boolean().optional(),
  hasDecision: z.boolean().optional(),
  decisionValue: z.string().optional(),
  hasActiveOffer: z.boolean().optional(),
  offerStatus: z.string().optional(),
})

export const getCandidateSummaryTool: CopilotTool<z.infer<typeof CandidateSummaryInput>, z.infer<typeof CandidateSummaryOutput>> = {
  id: 'get_candidate_summary',
  description: 'Return a workflow summary for one candidate: stage, hiring request, AI analysis availability, interview status, evaluation status, decision, and offer status. Does NOT include CV text, scores, or compensation.',
  requiredPermission: 'candidate.view',
  inputSchema: CandidateSummaryInput,
  outputSchema: CandidateSummaryOutput,
  async execute(ctx, input): Promise<z.infer<typeof CandidateSummaryOutput>> {
    const c = await db.candidate.findFirst({
      where: { id: input.candidateId, organizationId: ctx.organizationId },
      include: {
        hiringRequest: { select: { id: true, title: true } },
        interviews: { select: { id: true, evaluations: { select: { id: true } } } },
        offers: { select: { id: true, status: true }, orderBy: { updatedAt: 'desc' }, take: 1 },
      },
    })
    if (!c) {
      return { found: false }
    }
    // Fetch the latest decision separately (no relation on Candidate)
    const lastDecision = await db.candidateDecision.findFirst({
      where: { candidateId: c.id, organizationId: ctx.organizationId },
      orderBy: { decidedAt: 'desc' },
      select: { id: true, decision: true },
    })
    const hasEval = (c.interviews ?? []).some((i: any) => (i.evaluations ?? []).length > 0)
    const lastOffer = (c.offers ?? [])[0]
    const isActiveOffer = lastOffer && !['DECLINED', 'WITHDRAWN', 'EXPIRED', 'SENT', 'UNDER_REVIEW'].includes(lastOffer.status as string)
    return {
      found: true,
      id: c.id,
      name: `${c.firstName} ${c.lastName}`.trim(),
      stage: c.stage,
      hiringRequestId: c.hiringRequest.id,
      hiringRequestTitle: c.hiringRequest.title,
      hasAIAnalysis: false, // no analysis relation in current schema
      hasInterview: (c.interviews ?? []).length > 0,
      hasEvaluation: hasEval,
      hasDecision: !!lastDecision,
      decisionValue: lastDecision?.decision,
      hasActiveOffer: !!isActiveOffer,
      offerStatus: lastOffer?.status,
    }
  },
}

const DecisionReadinessInput = z.object({
  hiringRequestId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(MAX_RECORDS_PER_TOOL).default(50),
})

const DecisionReadinessOutput = z.object({
  total: z.number(),
  records: z.array(z.object({
    candidateId: z.string(),
    candidateName: z.string(),
    hiringRequestId: z.string(),
    hiringRequestTitle: z.string(),
    hasInterview: z.boolean(),
    hasEvaluation: z.boolean(),
    stage: z.string(),
  })),
})

export const getDecisionReadinessTool: CopilotTool<z.infer<typeof DecisionReadinessInput>, z.infer<typeof DecisionReadinessOutput>> = {
  id: 'get_decision_readiness',
  description: 'List candidates who are ready (or not) for a human decision. Returns per-candidate: has interview? has evaluation? stage. Optional hiring-request filter.',
  requiredPermission: 'decision.view',
  inputSchema: DecisionReadinessInput,
  outputSchema: DecisionReadinessOutput,
  async execute(ctx, input) {
    const where: any = { organizationId: ctx.organizationId, stage: { in: ['INTERVIEW', 'OFFER'] as never[] } }
    if (input.hiringRequestId) where.hiringRequestId = input.hiringRequestId
    const rows = await db.candidate.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: input.limit,
      include: {
        hiringRequest: { select: { id: true, title: true } },
        interviews: { select: { id: true, evaluations: { select: { id: true } } } },
      },
    })
    return {
      total: rows.length,
      records: rows.map(c => {
        const hasEval = (c.interviews ?? []).some(i => (i.evaluations ?? []).length > 0)
        return {
          candidateId: c.id,
          candidateName: `${c.firstName} ${c.lastName}`.trim(),
          hiringRequestId: c.hiringRequest.id,
          hiringRequestTitle: c.hiringRequest.title,
          hasInterview: (c.interviews ?? []).length > 0,
          hasEvaluation: hasEval,
          stage: c.stage,
        }
      }),
    }
  },
}

const SelectedWithoutOfferInput = z.object({
  limit: z.number().int().min(1).max(MAX_RECORDS_PER_TOOL).default(50),
})

const SelectedWithoutOfferOutput = z.object({
  total: z.number(),
  records: z.array(z.object({
    candidateId: z.string(),
    candidateName: z.string(),
    hiringRequestId: z.string(),
    hiringRequestTitle: z.string(),
    selectedAt: z.string().nullable(),
  })),
})

export const getSelectedCandidatesWithoutOfferTool: CopilotTool<z.infer<typeof SelectedWithoutOfferInput>, z.infer<typeof SelectedWithoutOfferOutput>> = {
  id: 'get_selected_candidates_without_offer',
  description: 'List candidates with a SELECTED human final decision who do not yet have an active offer. Useful for "show selected candidates without offers" questions.',
  requiredPermission: 'offer.view',
  inputSchema: SelectedWithoutOfferInput,
  outputSchema: SelectedWithoutOfferOutput,
  async execute(ctx, input) {
    const decisions = await db.candidateDecision.findMany({
      where: { organizationId: ctx.organizationId, decision: 'SELECTED' as never },
      orderBy: { decidedAt: 'desc' },
      take: input.limit,
      include: {
        candidate: {
          select: {
            id: true, firstName: true, lastName: true,
            offers: { where: { status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'ACCEPTED'] as never[] } }, select: { id: true } },
          },
        },
        hiringRequest: { select: { id: true, title: true } },
      },
    })
    const records = decisions
      .filter(d => (d.candidate.offers ?? []).length === 0)
      .map(d => ({
        candidateId: d.candidate.id,
        candidateName: `${d.candidate.firstName} ${d.candidate.lastName}`.trim(),
        hiringRequestId: d.hiringRequest.id,
        hiringRequestTitle: d.hiringRequest.title,
        selectedAt: d.decidedAt.toISOString(),
      }))
    return { total: records.length, records }
  },
}
