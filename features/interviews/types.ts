/**
 * Sprint 8 — Interview feature shared types.
 *
 * Public types consumed by:
 *  - server actions
 *  - React components
 *  - the feature index barrel
 *
 * No Prisma, no I/O — pure types so this file is safe to import from
 * anywhere (client and server).
 */

import type {
  ApplicationStage,
  EvaluationRecommendation,
  InterviewStatus,
  InterviewType,
  QuestionDifficulty,
  QuestionPurpose,
} from '@prisma/client'
import type { InterviewKitOutput } from '@/lib/ai/schemas/interview-kit.schema'

// -----------------------------------------------------------------------------
// Re-exports — pass through the existing model types + the AI output type
// -----------------------------------------------------------------------------

export type {
  InterviewType,
  InterviewStatus,
  ApplicationStage,
  QuestionPurpose,
  QuestionDifficulty,
  EvaluationRecommendation,
}

export type { InterviewKitOutput }

// -----------------------------------------------------------------------------
// Action result envelope (mirrors the project's ActionResult convention)
// -----------------------------------------------------------------------------

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable?: boolean; details?: unknown } }

// -----------------------------------------------------------------------------
// View types — what the UI consumes
// -----------------------------------------------------------------------------

export interface KitQuestionView {
  id: string
  order: number
  purpose: QuestionPurpose
  category: string
  question: string
  whyThisQuestion: string
  strongAnswer: string
  redFlags: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT'
  suggestedFollowUp: string
  askedAt: string | null
  notes: string | null
}

export interface KitScorecardView {
  name: string
  description: string
  weight: number
  poorIndicator: string
  meetsIndicator: string
  excellentIndicator: string
}

export interface InterviewKitView {
  interviewId: string
  candidateId: string
  hiringRequestId: string
  candidateName: string
  position: string
  matchScore: number | null
  recommendation: string | null
  interviewType: InterviewType
  status: InterviewStatus
  round: number
  scheduledAt: string | null
  durationMinutes: number
  overview: {
    recommendedType: InterviewType
    recommendedDurationMinutes: number
    interviewFocus: string
  }
  candidateSnapshot: {
    overallScore: number
    keyStrengths: string[]
    keyGaps: string[]
    areasRequiringValidation: string[]
  }
  questions: KitQuestionView[]
  scorecard: KitScorecardView[]
  participantNames: string[]
  startedAt: string | null
  completedAt: string | null
  hasEvaluation: boolean
  evaluationId: string | null
  interviewScore: number | null
  evaluationRecommendation: EvaluationRecommendation | null
}

export interface CandidateInterviewListItem {
  id: string
  candidateId: string
  type: InterviewType
  title: string
  status: InterviewStatus
  scheduledAt: string
  durationMinutes: number
  round: number
  participantNames: string[]
  hasEvaluation: boolean
  interviewScore: number | null
  evaluationRecommendation: EvaluationRecommendation | null
  /** Sprint 17 — public token for the .ics download link. Set when
   *  the 24h reminder is sent; null for interviews that haven't
   *  received their reminder yet (the server auto-creates one). */
  reminderToken: string | null
}

export interface InterviewCenterData {
  today: CandidateInterviewListItem[]
  upcoming: CandidateInterviewListItem[]
  past: CandidateInterviewListItem[]
  completed: CandidateInterviewListItem[]
  all: CandidateInterviewListItem[]
  counts: {
    today: number
    upcoming: number
    past: number
    completed: number
    all: number
  }
}

// -----------------------------------------------------------------------------
// Action input types
// -----------------------------------------------------------------------------

export interface GenerateInterviewKitInput {
  candidateId: string
  scheduledAt?: string
  durationMinutes?: number
  interviewerIds?: string[]
  type?: InterviewType
}

export interface CreateInterviewInput {
  candidateId: string
  type?: InterviewType
  scheduledAt: string
  durationMinutes: number
  interviewerIds: string[]
  notes?: string
}

export interface MarkQuestionAskedInput {
  questionId: string
  asked: boolean
  notes?: string
}

export interface SubmitEvaluationInput {
  interviewId: string
  criterionScores: Record<string, number>
  strengths: string
  concerns: string
  overallNotes: string
  recommendation: EvaluationRecommendation
}
