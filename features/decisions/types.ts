/**
 * Sprint 8 — Decision Hub types.
 */

import type {
  ApplicationStage,
  CandidateStatus,
  EvaluationRecommendation,
  QuestionPurpose,
} from '@prisma/client'
import type { DecisionBriefOutput } from '@/lib/ai/schemas/decision-brief.schema'

export type { DecisionBriefOutput }

// -----------------------------------------------------------------------------
// Action result envelope
// -----------------------------------------------------------------------------

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable?: boolean; details?: unknown } }

// -----------------------------------------------------------------------------
// Decision Readiness
// -----------------------------------------------------------------------------

export type DecisionReadiness =
  | 'NOT_READY'
  | 'NEEDS_INTERVIEW'
  | 'AWAITING_EVALUATION'
  | 'READY_FOR_REVIEW'

export const READINESS_LABEL: Record<DecisionReadiness, string> = {
  NOT_READY: 'Not Ready',
  NEEDS_INTERVIEW: 'Needs Interview',
  AWAITING_EVALUATION: 'Awaiting Evaluation',
  READY_FOR_REVIEW: 'Ready for Review',
}

export const READINESS_COLOR: Record<DecisionReadiness, string> = {
  NOT_READY: 'slate',
  NEEDS_INTERVIEW: 'amber',
  AWAITING_EVALUATION: 'sky',
  READY_FOR_REVIEW: 'emerald',
}

// -----------------------------------------------------------------------------
// Hub view
// -----------------------------------------------------------------------------

export interface DecisionCandidateView {
  id: string
  fullName: string
  email: string
  currentTitle: string | null
  yearsExperience: number | null
  stage: 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn'
  status: string
  matchScore: number | null
  recommendation: EvaluationRecommendation | null
  recommendationReasoning: string | null
  matchScoreBreakdown: {
    skills: number
    experience: number
    education: number
    role: number
  } | null
  strengths: string[]
  gaps: string[]
  concerns: string[]
  topSkills: string[]
  /** Latest interview summary. */
  latestInterview: {
    id: string
    status: string
    interviewScore: number | null
    recommendation: EvaluationRecommendation | null
    strengths: string | null
    concerns: string | null
    overallNotes: string | null
    criterionScores: Record<string, number> | null
    completedAt: string | null
  } | null
  /** Existing human final decision. */
  finalDecision: {
    id: string
    decision: 'ADVANCE' | 'HOLD' | 'REJECT' | 'SELECTED'
    notes?: string | null
    reason: string | null
    decidedByName: string
    decidedAt: string
  } | null
  /** Decision readiness (computed server-side, not by AI). */
  readiness: DecisionReadiness
}

// -----------------------------------------------------------------------------
// Hub page payload
// -----------------------------------------------------------------------------

export interface DecisionHubView {
  hiringRequest: {
    id: string
    title: string
    status: string
    department: string
    location: string | null
    hiringManagerName: string | null
    openings: number
    filled: number
  }
  counts: {
    total: number
    shortlisted: number
    interviewed: number
    selected: number
    rejected: number
    finalists: number
  }
  candidates: DecisionCandidateView[]
  recentActivities: Array<{
    id: string
    type: string
    title: string
    description: string | null
    occurredAt: string
    actorName: string | null
    candidateName: string | null
  }>
  /** The latest persisted Decision Brief for this hiring request, if any. */
  latestBrief: DecisionBriefSummary | null
}

export interface DecisionBriefSummary {
  id: string
  hiringRequestId: string
  comparedCandidateIds: string[]
  /** Decoded structured output. */
  output: DecisionBriefOutput
  modelUsed: string | null
  createdAt: string
  createdByName: string | null
}

// -----------------------------------------------------------------------------
// Comparison page payload
// -----------------------------------------------------------------------------

export interface ComparisonView {
  hiringRequest: DecisionHubView['hiringRequest']
  /** 2-4 candidates. */
  candidates: DecisionCandidateView[]
  /** Latest brief for these candidates, if one matches. */
  brief: DecisionBriefSummary | null
}

// -----------------------------------------------------------------------------
// Action inputs
// -----------------------------------------------------------------------------

export interface GenerateDecisionBriefInput {
  hiringRequestId: string
  candidateIds: string[]
}

export interface RecordDecisionInput {
  candidateId: string
  hiringRequestId: string
  decision: 'ADVANCE' | 'HOLD' | 'REJECT' | 'SELECTED'
  notes?: string
  reason?: string
}
