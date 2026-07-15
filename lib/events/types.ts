/**
 * TalentOS event bus — shared event types.
 *
 * The bus is intentionally framework-agnostic. React context wraps it for
 * client-side fan-out; server actions publish directly to the bus for
 * in-tab updates; `revalidatePath` keeps server-rendered data in sync.
 */

import type { JobDescriptionOutput } from '@/lib/ai/schemas/job-description.schema'
import type { CandidateRecommendation } from '@/lib/ai/schemas/candidate-ranking.schema'
import type {
  ApplicationStage,
  EmploymentStatus,
  HiringRequestStatus,
  JobLevel,
  JobType,
  Priority,
  WorkArrangement,
} from '@prisma/client'

// -----------------------------------------------------------------------------
// Domain event payloads
// -----------------------------------------------------------------------------

export interface HiringRequestSnapshot {
  id: string
  title: string
  status: HiringRequestStatus
  priority: Priority
  department: string
  openings: number
  filled: number
  location: string | null
  jobType: JobType
  workArrangement: WorkArrangement
  level: JobLevel
  salaryMin: number | null
  salaryMax: number | null
  createdAt: string
  hiringManagerName: string | null
  jobDescriptionSummary: string | null
}

export interface JobDescriptionSnapshot {
  id: string
  title: string
  summary: string | null
  responsibilities: string[]
  requiredSkills: string[]
  preferredSkills: string[]
  qualifications: string[]
  benefits: string[]
  screeningQuestions: string[]
  interviewQuestions: { category: string; question: string }[]
}

export interface AISnapshot {
  id: string
  type: string
  title: string
  status: string
  completedAt: string | null
}

export interface ActivitySnapshot {
  id: string
  type: string
  title: string
  description: string | null
  actorName: string | null
  candidateName: string | null
  occurredAt: string
}

export interface MetricDelta {
  openPositionsDelta?: number
  totalPositionsDelta?: number
  candidatesDelta?: number
}

// -----------------------------------------------------------------------------
// Sprint 6: CV / Candidate event payloads
// -----------------------------------------------------------------------------

export interface CVUploadedSnapshot {
  /** Client-side temp id (matches UI queue). */
  clientId: string
  hiringRequestId: string
  fileName: string
  fileSize: number
  fileKind: 'PDF' | 'DOCX'
  uploadedAt: string
}

export interface CVParsedSnapshot {
  clientId: string
  hiringRequestId: string
  fileName: string
  parsedAt: string
  characterCount: number
}

export interface CandidateCreatedSnapshot {
  id: string
  hiringRequestId: string
  fullName: string
  email: string
  currentTitle: string
  yearsExperience: number
  createdAt: string
}

export interface MatchAnalysisSnapshot {
  overallScore: number
  skillsScore: number
  experienceScore: number
  educationScore: number
  roleScore: number
  recommendation: CandidateRecommendation
  recommendationLabel: string
  reasoning: string
  strengths: string[]
  gaps: string[]
  concerns: string[]
  analyzedAt: string
}

export interface CandidateAnalyzedSnapshot {
  candidateId: string
  hiringRequestId: string
  fullName: string
  analysis: MatchAnalysisSnapshot
}

export interface CandidateRankedSnapshot {
  hiringRequestId: string
  rankings: Array<{ candidateId: string; fullName: string; overallScore: number; recommendation: string }>
  rankedAt: string
}

export interface CandidateStageChangedSnapshot {
  candidateId: string
  hiringRequestId: string
  fullName: string
  fromStage: ApplicationStage | null
  toStage: ApplicationStage
  changedAt: string
  actorName: string | null
}

// -----------------------------------------------------------------------------
// Sprint 7: Interview Kit + Evaluation event payloads
// -----------------------------------------------------------------------------

export interface InterviewKitSnapshot {
  interviewId: string
  candidateId: string
  hiringRequestId: string
  recommendedType: string
  recommendedDurationMinutes: number
  questionCount: number
  criterionCount: number
  generatedAt: string
}

export interface InterviewCreatedSnapshot {
  interviewId: string
  candidateId: string
  hiringRequestId: string
  scheduledAt: string
  durationMinutes: number
  type: string
  round: number
  participantNames: string[]
}

export interface InterviewStartedSnapshot {
  interviewId: string
  candidateId: string
  startedAt: string
}

export interface InterviewEvaluationSnapshot {
  interviewId: string
  candidateId: string
  evaluatorName: string
  overallScore: number
  interviewScore: number
  recommendation: string
  submittedAt: string
}

export interface InterviewCompletedSnapshot {
  interviewId: string
  candidateId: string
  completedAt: string
}

// -----------------------------------------------------------------------------
// The bus's event union
// -----------------------------------------------------------------------------

export type TalentOSEvent =
  | {
      type: 'HiringRequestCreated'
      payload: {
        hiringRequest: HiringRequestSnapshot
        jobDescription: JobDescriptionSnapshot
        activity: ActivitySnapshot
        aiTask: AISnapshot | null
      }
    }
  | {
      type: 'JobDescriptionGenerated'
      payload: {
        jobDescription: JobDescriptionSnapshot
        source: 'wizard' | 'retry'
      }
    }
  | {
      type: 'AITaskCompleted'
      payload: { aiTask: AISnapshot }
    }
  | {
      type: 'ActivityRecorded'
      payload: { activity: ActivitySnapshot }
    }
  | {
      type: 'HiringRequestDraftSaved'
      payload: { hiringRequest: HiringRequestSnapshot }
    }
  // Sprint 6: CV / Candidate workspace events
  | { type: 'CVUploaded'; payload: CVUploadedSnapshot }
  | { type: 'CVParsed'; payload: CVParsedSnapshot }
  | { type: 'CandidateCreated'; payload: CandidateCreatedSnapshot }
  | { type: 'CandidateAnalyzed'; payload: CandidateAnalyzedSnapshot }
  | { type: 'CandidateRanked'; payload: CandidateRankedSnapshot }
  | { type: 'CandidateStageChanged'; payload: CandidateStageChangedSnapshot }
  // Sprint 7: Interview Kit + Evaluation events
  | { type: 'InterviewKitGenerated'; payload: InterviewKitSnapshot }
  | { type: 'InterviewCreated'; payload: InterviewCreatedSnapshot }
  | { type: 'InterviewStarted'; payload: InterviewStartedSnapshot }
  | { type: 'InterviewEvaluationSubmitted'; payload: InterviewEvaluationSnapshot }
  | { type: 'InterviewCompleted'; payload: InterviewCompletedSnapshot }

export type TalentOSEventType = TalentOSEvent['type']

// -----------------------------------------------------------------------------
// Hiring request wizard draft state (client-side only)
// -----------------------------------------------------------------------------

export interface JobDescriptionDraft extends JobDescriptionOutput {
  /** Mirrors the user-editable role, department, location, etc. */
  meta: {
    role: string
    department: string
    employmentType: EmploymentType
    experience: string
    location: string
    companySummary: string
  }
  /** Wizard-set evaluation criteria derived from the AI output. */
  evaluationCriteria: EvaluationCriterion[]
}

export type EmploymentType =
  | 'FULL_TIME'
  | 'PART_TIME'
  | 'CONTRACT'
  | 'INTERNSHIP'
  | 'TEMPORARY'

export interface EvaluationCriterion {
  id: string
  category: string
  weight: number
  indicators: string[]
}

// -----------------------------------------------------------------------------
// Helper: re-export commonly used types for callers
// -----------------------------------------------------------------------------

export type { JobDescriptionOutput }
