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

/**
 * Sprint 19 (audit P2-17) — readiness is computed from the EVIDENCE a
 * reviewer needs, never from whether the AI happened to run.
 *
 * The old rule required `matchScore !== null` before a candidate could
 * reach READY_FOR_REVIEW, so a candidate whose CV had not been analysed
 * was permanently "Not Ready" and a partially analysed requisition looked
 * empty. The CV analysis is now reported separately (see
 * `MatchAnalysisState`) and no longer gates readiness.
 *
 * `DECIDED` is new: the candidate is in a terminal stage (HIRED /
 * REJECTED / WITHDRAWN) — there is nothing left to decide.
 */
export type DecisionReadiness =
  | 'NOT_READY'
  | 'NEEDS_INTERVIEW'
  | 'AWAITING_EVALUATION'
  | 'READY_FOR_REVIEW'
  | 'DECIDED'

export const READINESS_LABEL: Record<DecisionReadiness, string> = {
  NOT_READY: 'Not Ready',
  NEEDS_INTERVIEW: 'Needs Interview',
  AWAITING_EVALUATION: 'Awaiting Evaluation',
  READY_FOR_REVIEW: 'Ready for Review',
  DECIDED: 'Decided',
}

export const READINESS_COLOR: Record<DecisionReadiness, string> = {
  NOT_READY: 'slate',
  NEEDS_INTERVIEW: 'amber',
  AWAITING_EVALUATION: 'sky',
  READY_FOR_REVIEW: 'emerald',
  DECIDED: 'slate',
}

/**
 * Sprint 19 (audit P2-16) — an un-analysed candidate is NOT a candidate
 * with a score of 0. `NOT_ANALYZED` is rendered as "Not analysed" so a
 * reviewer cannot mistake "no analysis yet" for "terrible candidate".
 */
export type MatchAnalysisState = 'ANALYZED' | 'NOT_ANALYZED'

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
  /** Sprint 19 (P2-16) — explicit "never analysed" state, not a score of 0. */
  analysisState: MatchAnalysisState
  recommendation: EvaluationRecommendation | null
  recommendationReasoning: string | null
  /**
   * Sprint 19 (audit P2-03) — WHERE the recommendation came from.
   *
   * The AI CV recommendation is advisory. A reviewer must be able to
   * tell an AI recommendation from a human interviewer's one, and must
   * never see an AI signal presented as a decision.
   */
  recommendationSource: 'AI_CV_ANALYSIS' | 'INTERVIEW_EVALUATION' | null
  /**
   * Sprint 19 (audit P2-03) — always true. A candidate is only ever
   * rejected by a human decision (`decision.record`); no AI path can
   * move a candidate into a terminal stage.
   */
  requiresHumanReview: boolean
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
  /**
   * Sprint 19 (P0-10) — false when the candidate is in a terminal stage
   * (REJECTED / WITHDRAWN / HIRED). A terminal candidate can still be
   * LISTED (readiness is a badge, not a filter) but must never be
   * selectable, rejected again, or offered a job.
   */
  selectable: boolean
  /** True when the candidate is in a terminal stage. */
  terminal: boolean
  /**
   * Sprint 19 (P1-20) — true when the latest human decision is HOLD.
   * A candidate on hold must not be offered a job until the hold is
   * lifted (by recording a new decision).
   */
  onHold: boolean
  /**
   * Sprint 19 (P2-26) — false when the stored match score contradicts
   * the stored recommendation (e.g. score 92 + REJECT).
   */
  scoreRecommendationConsistent: boolean
  consistencyWarning: string | null
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
  /**
   * Sprint 19 (audit P1-07) — the evaluation the panel actually
   * submitted, newest first across every interview of the candidate.
   *
   * Before this, a submitted evaluation was WRITE-ONLY: the hub read
   * `interviews[0].evaluations[0]`, so a follow-up interview scheduled
   * after the evaluated one hid the evaluation the reviewer was supposed
   * to act on.
   */
  latestEvaluation: {
    id: string
    interviewId: string
    interviewScore: number | null
    overallScore: number | null
    recommendation: EvaluationRecommendation | null
    strengths: string | null
    concerns: string | null
    overallNotes: string | null
    criterionScores: Record<string, number> | null
    evaluatorName: string
    submittedAt: string
  } | null
  /** Existing human final decision (the most recent one). */
  finalDecision: {
    id: string
    decision: 'ADVANCE' | 'HOLD' | 'REJECT' | 'SELECTED'
    notes?: string | null
    reason: string | null
    decidedByName: string
    decidedAt: string
  } | null
  /**
   * Sprint 19 (P2-18) — the decision history, newest first. A
   * re-decision never overwrites the previous one, so this list is the
   * reconstructable history of the call.
   */
  decisionHistory: Array<{
    id: string
    decision: 'ADVANCE' | 'HOLD' | 'REJECT' | 'SELECTED'
    notes?: string | null
    reason: string | null
    decidedByName: string
    decidedAt: string
  }>
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
  /**
   * Sprint 19 (P0-10) — the ids of the candidates that may still be
   * decided on / offered a job. Terminal candidates (REJECTED /
   * WITHDRAWN / HIRED) are still LISTED in `candidates` (readiness is a
   * badge, not a filter) but they are not in this list.
   */
  selectableCandidateIds: string[]
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
