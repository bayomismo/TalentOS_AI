/**
 * TalentOS event bus — shared event types.
 *
 * The bus is intentionally framework-agnostic. React context wraps it for
 * client-side fan-out; server actions publish directly to the bus for
 * in-tab updates; `revalidatePath` keeps server-rendered data in sync.
 */

import type { JobDescriptionOutput } from '@/lib/ai/schemas/job-description.schema'
import type {
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
