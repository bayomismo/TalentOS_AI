'use server'

/**
 * Sprint 7 — AI Interview Kit + Structured Evaluation server actions.
 *
 * 1. `getCandidateInterviewsAction`        — list all interviews for a candidate.
 * 2. `getInterviewKitAction`               — fetch a single interview + its
 *                                             generated questions + scorecard
 *                                             (denormalized from kitSnapshot).
 * 3. `generateInterviewKitAction`          — call AI to generate the kit,
 *                                             persist Interview + InterviewQuestion
 *                                             rows, publish events + activity.
 * 4. `createInterviewAction`               — schedule a new interview with
 *                                             interviewer(s) + duration.
 * 5. `markInterviewStartedAction`          — flip status to IN_PROGRESS.
 * 6. `markInterviewQuestionAskedAction`    — toggle asked/notes on a question.
 * 7. `submitEvaluationAction`              — persist InterviewEvaluation,
 *                                             compute deterministic interview
 *                                             score, publish events + activity.
 * 8. `getInterviewCenterAction`            — feed the Interview Center page
 *                                             (today/upcoming/past + counts).
 *
 * Errors are typed via `ActionResult` and never leak raw exceptions.
 */

import { revalidatePath } from 'next/cache'

/**
 * Safe revalidatePath — only works inside a Next.js request context.
 * Server actions called from scripts (e.g. local E2E) crash if we call
 * revalidatePath, so we swallow the error and continue.
 */
function safeRevalidate(path: string): void {
  try {
    safeRevalidate(path)
  } catch {
    // Outside a request context (e.g. tsx script). Ignore.
  }
}

import { db } from '@/lib/db'
import { getAIEngine } from '@/lib/ai/service/ai-engine'
import { getEventBus } from '@/lib/events'
import type {
  InterviewEvaluationSnapshot,
  InterviewKitSnapshot,
  InterviewCreatedSnapshot,
  InterviewCompletedSnapshot,
  InterviewStartedSnapshot,
} from '@/lib/events/types'
import {
  interviewKitOutputSchema,
  extractQuestionMeta,
  type InterviewKitOutput,
  type InterviewKitQuestion,
  type InterviewKitScorecardCriterion,
} from '@/lib/ai/schemas/interview-kit.schema'
import type {
  ApplicationStage,
  EvaluationRecommendation,
  InterviewStatus,
  InterviewType,
  QuestionPurpose,
} from '@prisma/client'

// -----------------------------------------------------------------------------
// Shared types
// -----------------------------------------------------------------------------

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable?: boolean; details?: unknown } }

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

function activitySnapshot(a: {
  id: string
  type: string
  title: string
  description: string | null
  occurredAt: Date
}): {
  id: string
  type: string
  title: string
  description: string | null
  actorName: string | null
  candidateName: string | null
  occurredAt: string
} {
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    description: a.description,
    actorName: null,
    candidateName: null,
    occurredAt: a.occurredAt.toISOString(),
  }
}

function kitQuestionToView(
  q: {
    id: string
    order: number
    purpose: QuestionPurpose
    category: string
    question: string
    whyThisQuestion: string | null
    strongAnswerIndicators: string | null
    redFlags: string | null
    suggestedFollowUp: string | null
    difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT'
    askedAt: Date | null
    notes: string | null
  }
): KitQuestionView {
  // Backward compat: if the row was stored with the old flat fields and
  // strongAnswerIndicators has the optional Follow-up/Difficulty trailers,
  // they have already been stripped out and stored separately. If not,
  // we run the extraction again (for safety).
  const extracted = extractQuestionMeta(q.strongAnswerIndicators ?? '')
  return {
    id: q.id,
    order: q.order,
    purpose: q.purpose,
    category: q.category,
    question: q.question,
    whyThisQuestion: q.whyThisQuestion ?? '',
    strongAnswer: extracted.suggestedFollowUp || q.strongAnswerIndicators
      ? q.strongAnswerIndicators ?? ''
      : q.strongAnswerIndicators ?? '',
    redFlags: q.redFlags ?? '',
    difficulty: q.difficulty,
    suggestedFollowUp: q.suggestedFollowUp ?? extracted.suggestedFollowUp,
    askedAt: q.askedAt ? q.askedAt.toISOString() : null,
    notes: q.notes,
  }
}

function isKitQuestion(q: unknown): q is InterviewKitQuestion {
  return typeof q === 'object' && q !== null && 'purpose' in (q as Record<string, unknown>)
}

// -----------------------------------------------------------------------------
// 1. getCandidateInterviewsAction
// -----------------------------------------------------------------------------

export async function getCandidateInterviewsAction(
  candidateId: string
): Promise<ActionResult<{ items: CandidateInterviewListItem[] }>> {
  try {
    const rows = await db.interview.findMany({
      where: { candidateId },
      include: {
        participants: { include: { user: { select: { firstName: true, lastName: true } } } },
        evaluations: { select: { id: true, interviewScore: true, recommendation: true }, orderBy: { submittedAt: 'desc' }, take: 1 },
      },
      orderBy: { scheduledAt: 'desc' },
    })
    const items: CandidateInterviewListItem[] = rows.map(r => {
      const evalRow = r.evaluations[0]
      return {
        id: r.id,
        candidateId: r.candidateId,
        type: r.type,
        title: r.title,
        status: r.status,
        scheduledAt: r.scheduledAt.toISOString(),
        durationMinutes: r.durationMinutes,
        round: r.round,
        participantNames: r.participants.map(p => `${p.user.firstName} ${p.user.lastName}`),
        hasEvaluation: !!evalRow,
        interviewScore: evalRow?.interviewScore ?? null,
        evaluationRecommendation: evalRow?.recommendation ?? null,
      }
    })
    return { ok: true, data: { items } }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to load candidate interviews.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}

// -----------------------------------------------------------------------------
// 2. getInterviewKitAction
// -----------------------------------------------------------------------------

export async function getInterviewKitAction(
  interviewId: string
): Promise<ActionResult<InterviewKitView>> {
  try {
    const interview = await db.interview.findUnique({
      where: { id: interviewId },
      include: {
        candidate: { include: { skills: true } },
        hiringRequest: { include: { jobDescription: true } },
        participants: { include: { user: { select: { firstName: true, lastName: true } } } },
        questions: { orderBy: { order: 'asc' } },
        evaluations: { orderBy: { submittedAt: 'desc' }, take: 1 },
      },
    })
    if (!interview) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }
    const snapshot = interview.kitSnapshot as InterviewKitOutput | null
    const candidateName = `${interview.candidate.firstName} ${interview.candidate.lastName}`

    // Scorecard: prefer denormalized snapshot, otherwise reconstruct minimal
    // empty scorecard so the UI doesn't blow up.
    const scorecard: KitScorecardView[] = snapshot?.scorecardCriteria
      ? snapshot.scorecardCriteria.map((c: InterviewKitScorecardCriterion) => ({
          name: c.name,
          description: c.description,
          weight: c.weight,
          poorIndicator: c.indicators.poor,
          meetsIndicator: midpointIndicator(c.indicators.poor, c.indicators.excellent),
          excellentIndicator: c.indicators.excellent,
        }))
      : []

    const questions: KitQuestionView[] = interview.questions.map(kitQuestionToView)
    const evalRow = interview.evaluations[0]

    return {
      ok: true,
      data: {
        interviewId: interview.id,
        candidateId: interview.candidateId,
        hiringRequestId: interview.hiringRequestId,
        candidateName,
        position: interview.hiringRequest.title,
        matchScore: interview.candidate.matchScore,
        recommendation: interview.candidate.recommendation,
        interviewType: interview.type,
        status: interview.status,
        round: interview.round,
        scheduledAt: interview.scheduledAt.toISOString(),
        durationMinutes: interview.durationMinutes,
        overview: {
          recommendedType: (snapshot?.overview.recommendedType as InterviewType | undefined) ?? interview.type,
          recommendedDurationMinutes: snapshot?.overview.recommendedDurationMinutes ?? interview.durationMinutes,
          interviewFocus: snapshot?.overview.interviewFocus ?? '',
        },
        candidateSnapshot: {
          overallScore: snapshot?.candidateSnapshot.overallScore ?? interview.candidate.matchScore ?? 0,
          keyStrengths: snapshot?.candidateSnapshot.keyStrengths ?? interview.candidate.strengths,
          keyGaps: snapshot?.candidateSnapshot.keyGaps ?? interview.candidate.gaps,
          areasRequiringValidation:
            snapshot?.candidateSnapshot.areasRequiringValidation ??
            interview.candidate.skills.map(s => s.name).slice(0, 5),
        },
        questions,
        scorecard,
        participantNames: interview.participants.map(p => `${p.user.firstName} ${p.user.lastName}`),
        startedAt: interview.startedAt ? interview.startedAt.toISOString() : null,
        completedAt: interview.completedAt ? interview.completedAt.toISOString() : null,
        hasEvaluation: !!evalRow,
        evaluationId: evalRow?.id ?? null,
        interviewScore: evalRow?.interviewScore ?? null,
        evaluationRecommendation: evalRow?.recommendation ?? null,
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to load interview kit.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}

/**
 * Cheap, deterministic midpoint text between two indicator strings.
 * The real midpoint is the interviewer's judgment — we just give a
 * reasonable sentence in between.
 */
function midpointIndicator(poor: string, excellent: string): string {
  return `Solid, on-target evidence across most criteria; not yet at the bar where ${trimPeriod(excellent.toLowerCase())}.`
}

function trimPeriod(s: string): string {
  return s.endsWith('.') ? s.slice(0, -1) : s
}

// -----------------------------------------------------------------------------
// 3. generateInterviewKitAction
// -----------------------------------------------------------------------------

export interface GenerateInterviewKitInput {
  candidateId: string
  /**
   * Optional schedule fields. If provided, the interview is scheduled
   * immediately after the kit is generated. If not, the interview is
   * created in SCHEDULED status with placeholder `scheduledAt` = now + 7
   * days, and the user edits it before sending to the interviewer.
   */
  scheduledAt?: string
  durationMinutes?: number
  interviewerIds?: string[]
  type?: InterviewType
}

export async function generateInterviewKitAction(
  input: GenerateInterviewKitInput
): Promise<ActionResult<{ interviewId: string; kit: InterviewKitView }>> {
  const bus = getEventBus()
  try {
    const candidate = await db.candidate.findUnique({
      where: { id: input.candidateId },
      include: {
        organization: true,
        hiringRequest: { include: { jobDescription: true } },
        skills: true,
        experiences: { orderBy: { startDate: 'desc' } },
        educations: true,
        certifications: true,
      },
    })
    if (!candidate) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Candidate not found.', retryable: false } }
    }
    if (!candidate.hiringRequest.jobDescription) {
      return {
        ok: false,
        error: { code: 'NO_JD', message: 'This candidate has no job description yet. Generate one first.', retryable: false },
      }
    }
    const hr = candidate.hiringRequest
    const jd = hr.jobDescription!
    const eligibleStages: ApplicationStage[] = ['SCREENING', 'INTERVIEW']
    if (!eligibleStages.includes(candidate.stage)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_STAGE',
          message: `Interview Kit can only be generated from SCREENING or INTERVIEW. This candidate is in ${candidate.stage}.`,
          retryable: false,
          details: { currentStage: candidate.stage },
        },
      }
    }

    // Build the engine input
    const engineInput = {
      jobContext: {
        jobTitle: hr.title,
        jobLevel: hr.level,
        jobSummary: jd.summary ?? jd.description,
        responsibilities: jd.responsibilities,
        requiredSkills: jd.requiredSkills,
        preferredSkills: jd.niceToHave,
        qualifications: jd.requiredSkills,
        experienceRequirements: jd.responsibilities,
      },
      candidateContext: {
        name: `${candidate.firstName} ${candidate.lastName}`,
        currentRole: candidate.currentTitle ?? 'Unknown',
        totalYearsExperience: candidate.yearsExperience ?? 0,
        skills: candidate.skills.map(s => s.name),
        workExperience: candidate.experiences.map(e => ({
          company: e.company,
          title: e.title,
          startDate: e.startDate ? e.startDate.toISOString().slice(0, 7) : undefined,
          endDate: e.endDate ? e.endDate.toISOString().slice(0, 7) : undefined,
          description: e.description ?? undefined,
        })),
        education: candidate.educations.map(e => ({
          institution: e.institution,
          degree: e.degree,
          field: e.field ?? undefined,
        })),
        certifications: candidate.certifications.map(c => c.name),
      },
      matchContext: {
        overallScore: candidate.matchScore ?? 0,
        scoreBreakdown: (candidate.matchScoreBreakdown as { skills: number; experience: number; roleAlignment: number; education: number } | null) ?? {
          skills: 0,
          experience: 0,
          roleAlignment: 0,
          education: 0,
        },
        strengths: candidate.strengths,
        gaps: candidate.gaps,
        concerns: candidate.concerns,
        recommendation: candidate.recommendation ?? 'POTENTIAL_MATCH',
        recommendationReasoning: candidate.recommendationReasoning ?? '',
      },
    }

    // Call the engine
    const result = await getAIEngine().generateInterviewKit(engineInput)
    const kit = result.data
    // Defensive defaults: the model sometimes forgets to copy the candidate
    // name / position from the prompt. We fill them in from the DB so the
    // UI never sees a blank header.
    kit.overview.candidateName = kit.overview.candidateName || `${candidate.firstName} ${candidate.lastName}`
    kit.overview.position = kit.overview.position || hr.title
    const parseResult = interviewKitOutputSchema.safeParse(kit)
    if (!parseResult.success) {
      return {
        ok: false,
        error: {
          code: 'SCHEMA_VALIDATION',
          message: 'AI returned an interview kit that does not match the schema. Please try again.',
          retryable: true,
          details: parseResult.error.issues,
        },
      }
    }

    // Validate scorecard weights sum to 100
    const weightSum = kit.scorecardCriteria.reduce((a, c) => a + c.weight, 0)
    if (weightSum !== 100) {
      return {
        ok: false,
        error: {
          code: 'WEIGHTS_INVALID',
          message: `Scorecard weights do not sum to 100 (got ${weightSum}).`,
          retryable: true,
        },
      }
    }

    // Resolve interviewer ids — default to any admin in the org
    const actorId = await getDefaultActorId(candidate.organizationId)
    const requestedInterviewerIds = input.interviewerIds && input.interviewerIds.length > 0
      ? input.interviewerIds
      : [actorId]

    // Reuse an existing non-completed interview, or create a new one
    let interview = await db.interview.findFirst({
      where: { candidateId: candidate.id, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
      include: { questions: true },
      orderBy: { scheduledAt: 'desc' },
    })

    const interviewType: InterviewType = input.type ?? (kit.overview.recommendedType as InterviewType) ?? 'TECHNICAL'
    const durationMinutes = input.durationMinutes ?? kit.overview.recommendedDurationMinutes
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const isReschedule = !!interview
    const previousStatus = interview?.status

    if (!interview) {
      interview = await db.interview.create({
        data: {
          organizationId: candidate.organizationId,
          hiringRequestId: candidate.hiringRequestId,
          candidateId: candidate.id,
          scheduledById: actorId,
          type: interviewType,
          title: `${interviewType.replace(/_/g, ' ')} — ${candidate.firstName} ${candidate.lastName} (Round ${candidate.stage === 'SCREENING' ? 1 : 2})`,
          status: 'SCHEDULED',
          scheduledAt,
          durationMinutes,
          stage: 'INTERVIEW',
          round: candidate.stage === 'SCREENING' ? 1 : 2,
          kitSnapshot: kit as unknown as object,
        },
        include: { questions: true },
      })
    } else {
      // Overwrite the kit (re-generation)
      interview = await db.interview.update({
        where: { id: interview.id },
        data: {
          type: interviewType,
          durationMinutes,
          scheduledAt,
          kitSnapshot: kit as unknown as object,
        },
        include: { questions: true },
      })
      // Clear old questions
      await db.interviewQuestion.deleteMany({ where: { interviewId: interview.id } })
    }

    // Insert questions
    await db.interviewQuestion.createMany({
      data: kit.questions.map((q, i) => {
        const meta = extractQuestionMeta(q.guidance.strongAnswer)
        return {
          interviewId: interview!.id,
          category: q.category,
          type: purposeToQuestionType(q.purpose),
          purpose: q.purpose,
          difficulty: meta.difficulty,
          question: q.question,
          whyThisQuestion: q.whyThisQuestion,
          strongAnswerIndicators: q.guidance.strongAnswer,
          redFlags: q.guidance.redFlags,
          suggestedFollowUp: meta.suggestedFollowUp,
          order: i,
        }
      }),
    })

    // Sync participants — diff to avoid unique-constraint churn
    const existing = await db.interviewParticipant.findMany({
      where: { interviewId: interview.id },
      select: { userId: true, role: true },
    })
    const existingKeys = new Set(existing.map(p => `${p.userId}::${p.role}`))
    for (const userId of requestedInterviewerIds) {
      for (const role of ['INTERVIEWER'] as const) {
        const key = `${userId}::${role}`
        if (existingKeys.has(key)) continue
        await db.interviewParticipant.upsert({
          where: { interviewId_userId: { interviewId: interview.id, userId } },
          update: { role },
          create: { interviewId: interview.id, userId, role },
        })
      }
    }

    // Activity
    const activity = await db.activity.create({
      data: {
        organizationId: candidate.organizationId,
        type: 'INTERVIEW_KIT_GENERATED',
        actorId,
        candidateId: candidate.id,
        hiringRequestId: candidate.hiringRequestId,
        interviewId: interview.id,
        title: `Interview kit generated — ${kit.questions.length} questions, ${kit.scorecardCriteria.length} criteria`,
        description: `${kit.overview.recommendedType.replace(/_/g, ' ')} · ${kit.overview.recommendedDurationMinutes} min · ${candidate.firstName} ${candidate.lastName} → ${hr.title}`,
        metadata: {
          questionCount: kit.questions.length,
          criterionCount: kit.scorecardCriteria.length,
          recommendedType: kit.overview.recommendedType,
          recommendedDurationMinutes: kit.overview.recommendedDurationMinutes,
        },
      },
    })

    // Bus events
    const busInstance = bus
    const snapshot: InterviewKitSnapshot = {
      interviewId: interview.id,
      candidateId: candidate.id,
      hiringRequestId: candidate.hiringRequestId,
      recommendedType: kit.overview.recommendedType,
      recommendedDurationMinutes: kit.overview.recommendedDurationMinutes,
      questionCount: kit.questions.length,
      criterionCount: kit.scorecardCriteria.length,
      generatedAt: new Date().toISOString(),
    }
    busInstance.publish({ type: 'InterviewKitGenerated', payload: snapshot })
    const createdPayload: InterviewCreatedSnapshot = {
      interviewId: interview.id,
      candidateId: candidate.id,
      hiringRequestId: candidate.hiringRequestId,
      scheduledAt: interview.scheduledAt.toISOString(),
      durationMinutes: interview.durationMinutes,
      type: interview.type,
      round: interview.round,
      participantNames: await resolveNames(requestedInterviewerIds),
    }
    busInstance.publish({ type: 'InterviewCreated', payload: createdPayload })
    busInstance.publish({
      type: 'ActivityRecorded',
      payload: { activity: activitySnapshot({ ...activity, occurredAt: activity.occurredAt }) },
    })

    safeRevalidate(`/candidates/${candidate.id}`)
    safeRevalidate(`/candidates/${candidate.id}/interview-kit`)
    safeRevalidate(`/candidates/${candidate.id}/interview-kit/${interview.id}`)
    safeRevalidate(`/interview-center`)
    safeRevalidate(`/hiring-requests/${hr.id}/candidates`)

    const view = await getInterviewKitAction(interview.id)
    if (!view.ok) {
      return { ok: false, error: view.error }
    }
    if (!isReschedule && previousStatus === undefined) {
      // The first-time generation also flips the candidate to INTERVIEW if
      // they were still in SCREENING. This matches user expectations:
      // "I generated the kit" → "the candidate is being interviewed".
      if (candidate.stage === 'SCREENING') {
        await db.candidate.update({
          where: { id: candidate.id },
          data: { stage: 'INTERVIEW' },
        })
        await db.activity.create({
          data: {
            organizationId: candidate.organizationId,
            type: 'CANDIDATE_MOVED',
            actorId,
            candidateId: candidate.id,
            hiringRequestId: candidate.hiringRequestId,
            title: `Candidate moved to INTERVIEW`,
            description: `Auto-advanced from SCREENING after the interview kit was generated.`,
            metadata: { fromStage: 'SCREENING', toStage: 'INTERVIEW', trigger: 'INTERVIEW_KIT_GENERATED' },
          },
        })
        busInstance.publish({
          type: 'CandidateStageChanged',
          payload: {
            candidateId: candidate.id,
            hiringRequestId: candidate.hiringRequestId,
            fullName: `${candidate.firstName} ${candidate.lastName}`,
            fromStage: 'SCREENING',
            toStage: 'INTERVIEW',
            changedAt: new Date().toISOString(),
            actorName: null,
          },
        })
      }
    }
    return { ok: true, data: { interviewId: interview.id, kit: view.data } }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message: 'Failed to generate interview kit.',
        retryable: true,
        details: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

function purposeToQuestionType(p: QuestionPurpose): 'TECHNICAL' | 'BEHAVIORAL' | 'SITUATIONAL' | 'CULTURAL' | 'CASE_STUDY' | 'SYSTEM_DESIGN' | 'CODING' {
  switch (p) {
    case 'BEHAVIORAL':
      return 'BEHAVIORAL'
    case 'SCENARIO':
      return 'SITUATIONAL'
    case 'CLOSING':
      return 'CULTURAL'
    case 'OPENING':
    case 'ROLE_SPECIFIC':
    case 'SKILL_VALIDATION':
    case 'GAP_VALIDATION':
    case 'CANDIDATE_SPECIFIC':
      return 'TECHNICAL'
    default:
      return 'TECHNICAL'
  }
}

async function resolveNames(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { firstName: true, lastName: true },
  })
  return users.map(u => `${u.firstName} ${u.lastName}`)
}

// -----------------------------------------------------------------------------
// 4. createInterviewAction
// -----------------------------------------------------------------------------

export interface CreateInterviewInput {
  candidateId: string
  type?: InterviewType
  scheduledAt: string
  durationMinutes: number
  interviewerIds: string[]
  notes?: string
}

export async function createInterviewAction(
  input: CreateInterviewInput
): Promise<ActionResult<{ interviewId: string }>> {
  const bus = getEventBus()
  try {
    const candidate = await db.candidate.findUnique({
      where: { id: input.candidateId },
      select: { id: true, organizationId: true, hiringRequestId: true, stage: true, firstName: true, lastName: true },
    })
    if (!candidate) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Candidate not found.', retryable: false } }
    }
    const actorId = await getDefaultActorId(candidate.organizationId)
    const interview = await db.interview.create({
      data: {
        organizationId: candidate.organizationId,
        hiringRequestId: candidate.hiringRequestId,
        candidateId: candidate.id,
        scheduledById: actorId,
        type: input.type ?? 'TECHNICAL',
        title: `${input.type ?? 'TECHNICAL'} — ${candidate.firstName} ${candidate.lastName}`,
        status: 'SCHEDULED',
        scheduledAt: new Date(input.scheduledAt),
        durationMinutes: input.durationMinutes,
        notes: input.notes,
        stage: 'INTERVIEW',
        round: candidate.stage === 'SCREENING' ? 1 : 2,
      },
    })
    for (const userId of input.interviewerIds) {
      await db.interviewParticipant.create({
        data: { interviewId: interview.id, userId, role: 'INTERVIEWER' },
      })
    }
    const activity = await db.activity.create({
      data: {
        organizationId: candidate.organizationId,
        type: 'INTERVIEW_SCHEDULED',
        actorId,
        candidateId: candidate.id,
        hiringRequestId: candidate.hiringRequestId,
        interviewId: interview.id,
        title: `Interview scheduled — ${interview.type}`,
        description: `${interview.durationMinutes} min · ${interview.scheduledAt.toISOString().slice(0, 16).replace('T', ' ')}`,
      },
    })
    bus.publish({
      type: 'InterviewCreated',
      payload: {
        interviewId: interview.id,
        candidateId: candidate.id,
        hiringRequestId: candidate.hiringRequestId,
        scheduledAt: interview.scheduledAt.toISOString(),
        durationMinutes: interview.durationMinutes,
        type: interview.type,
        round: interview.round,
        participantNames: await resolveNames(input.interviewerIds),
      } satisfies InterviewCreatedSnapshot,
    })
    bus.publish({
      type: 'ActivityRecorded',
      payload: { activity: activitySnapshot({ ...activity, occurredAt: activity.occurredAt }) },
    })
    safeRevalidate(`/candidates/${candidate.id}`)
    safeRevalidate(`/interview-center`)
    return { ok: true, data: { interviewId: interview.id } }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to create interview.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}

// -----------------------------------------------------------------------------
// 5. markInterviewStartedAction
// -----------------------------------------------------------------------------

export async function markInterviewStartedAction(
  interviewId: string
): Promise<ActionResult<{ startedAt: string }>> {
  const bus = getEventBus()
  try {
    const interview = await db.interview.findUnique({
      where: { id: interviewId },
      select: { id: true, candidateId: true, status: true, startedAt: true },
    })
    if (!interview) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }
    if (interview.startedAt) {
      return { ok: true, data: { startedAt: interview.startedAt.toISOString() } }
    }
    const startedAt = new Date()
    await db.interview.update({
      where: { id: interview.id },
      data: { startedAt, status: 'IN_PROGRESS' },
    })
    const payload: InterviewStartedSnapshot = {
      interviewId: interview.id,
      candidateId: interview.candidateId,
      startedAt: startedAt.toISOString(),
    }
    bus.publish({ type: 'InterviewStarted', payload })
    safeRevalidate(`/candidates/${interview.candidateId}/interview-kit/${interview.id}`)
    return { ok: true, data: { startedAt: startedAt.toISOString() } }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: 'Failed to start interview.', retryable: true, details: err instanceof Error ? err.message : String(err) } }
  }
}

// -----------------------------------------------------------------------------
// 6. markInterviewQuestionAskedAction
// -----------------------------------------------------------------------------

export async function markInterviewQuestionAskedAction(input: {
  questionId: string
  asked: boolean
  notes?: string
}): Promise<ActionResult<{ askedAt: string | null }>> {
  try {
    const question = await db.interviewQuestion.findUnique({
      where: { id: input.questionId },
      select: { id: true, askedAt: true },
    })
    if (!question) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Question not found.', retryable: false } }
    }
    const askedAt = input.asked ? new Date() : null
    await db.interviewQuestion.update({
      where: { id: question.id },
      data: {
        askedAt,
        notes: input.notes !== undefined ? input.notes : undefined,
      },
    })
    return { ok: true, data: { askedAt: askedAt ? askedAt.toISOString() : null } }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: 'Failed to mark question asked.', retryable: true, details: err instanceof Error ? err.message : String(err) } }
  }
}

// -----------------------------------------------------------------------------
// 7. submitEvaluationAction
// -----------------------------------------------------------------------------

export interface SubmitEvaluationInput {
  interviewId: string
  /** Per-criterion scores, 1-5. Key = criterion name. */
  criterionScores: Record<string, number>
  /** Free-form notes from the interviewer. */
  strengths: string
  concerns: string
  overallNotes: string
  recommendation: EvaluationRecommendation
}

export async function submitEvaluationAction(
  input: SubmitEvaluationInput
): Promise<ActionResult<{ evaluationId: string; interviewScore: number }>> {
  const bus = getEventBus()
  try {
    const interview = await db.interview.findUnique({
      where: { id: input.interviewId },
      include: {
        candidate: { select: { id: true, organizationId: true, hiringRequestId: true, firstName: true, lastName: true } },
        evaluations: { take: 1, orderBy: { submittedAt: 'desc' } },
      },
    })
    if (!interview) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }
    if (interview.evaluations.length > 0) {
      return { ok: false, error: { code: 'ALREADY_SUBMITTED', message: 'An evaluation was already submitted for this interview. Delete the existing one first.', retryable: false } }
    }
    const snapshot = interview.kitSnapshot as InterviewKitOutput | null
    if (!snapshot) {
      return { ok: false, error: { code: 'NO_KIT', message: 'No interview kit is attached to this interview. Generate the kit first.', retryable: false } }
    }
    // Validate scores: 1-5, all criteria present
    const errors: string[] = []
    for (const c of snapshot.scorecardCriteria) {
      const s = input.criterionScores[c.name]
      if (s === undefined || s === null) errors.push(`Missing score for "${c.name}"`)
      else if (!Number.isInteger(s) || s < 1 || s > 5) errors.push(`Invalid score for "${c.name}" (must be integer 1-5, got ${s})`)
    }
    if (errors.length > 0) {
      return { ok: false, error: { code: 'INVALID_SCORES', message: errors.join('; '), retryable: false, details: errors } }
    }
    // Weights must still sum to 100
    const weightSum = snapshot.scorecardCriteria.reduce((a, c) => a + c.weight, 0)
    if (weightSum !== 100) {
      return { ok: false, error: { code: 'INVALID_WEIGHTS', message: `Scorecard weights do not sum to 100 (got ${weightSum}).`, retryable: false } }
    }

    // Deterministic score = sum over criteria (criterionScore/5 * weight)
    let interviewScore = 0
    for (const c of snapshot.scorecardCriteria) {
      const s = input.criterionScores[c.name]
      interviewScore += (s / 5) * c.weight
    }
    interviewScore = Math.round(interviewScore)

    const overallScore = Math.round(
      Object.values(input.criterionScores).reduce((a, s) => a + s, 0) /
        Object.values(input.criterionScores).length
    )

    const actorId = await getDefaultActorId(interview.candidate.organizationId)

    const evaluation = await db.interviewEvaluation.create({
      data: {
        interviewId: interview.id,
        evaluatorId: actorId,
        overallScore,
        interviewScore,
        criterionScores: input.criterionScores as unknown as object,
        strengths: input.strengths,
        weaknesses: input.concerns,
        overallNotes: input.overallNotes,
        recommendation: input.recommendation,
        summary: input.overallNotes.slice(0, 400),
      },
    })

    // Mark interview complete
    await db.interview.update({
      where: { id: interview.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    })

    const activity = await db.activity.create({
      data: {
        organizationId: interview.candidate.organizationId,
        type: 'EVALUATION_SUBMITTED',
        actorId,
        candidateId: interview.candidateId,
        hiringRequestId: interview.hiringRequestId,
        interviewId: interview.id,
        title: `Evaluation submitted — ${interviewScore}/100`,
        description: `Recommendation: ${input.recommendation}`,
        metadata: {
          interviewScore,
          overallScore,
          recommendation: input.recommendation,
        },
      },
    })

    const evaluator = await db.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true } })
    const evaluationPayload: InterviewEvaluationSnapshot = {
      interviewId: interview.id,
      candidateId: interview.candidateId,
      evaluatorName: evaluator ? `${evaluator.firstName} ${evaluator.lastName}` : 'Unknown',
      overallScore,
      interviewScore,
      recommendation: input.recommendation,
      submittedAt: evaluation.submittedAt.toISOString(),
    }
    const completedPayload: InterviewCompletedSnapshot = {
      interviewId: interview.id,
      candidateId: interview.candidateId,
      completedAt: new Date().toISOString(),
    }
    bus.publish({ type: 'InterviewEvaluationSubmitted', payload: evaluationPayload })
    bus.publish({ type: 'InterviewCompleted', payload: completedPayload })
    bus.publish({
      type: 'ActivityRecorded',
      payload: { activity: activitySnapshot({ ...activity, occurredAt: activity.occurredAt }) },
    })

    safeRevalidate(`/candidates/${interview.candidateId}`)
    safeRevalidate(`/candidates/${interview.candidateId}/interview-kit/${interview.id}`)
    safeRevalidate(`/interview-center`)
    return { ok: true, data: { evaluationId: evaluation.id, interviewScore } }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to submit evaluation.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}

// -----------------------------------------------------------------------------
// 8. getInterviewCenterAction
// -----------------------------------------------------------------------------

export async function getInterviewCenterAction(): Promise<ActionResult<InterviewCenterData>> {
  try {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

    const rows = await db.interview.findMany({
      include: {
        candidate: { select: { firstName: true, lastName: true } },
        hiringRequest: { select: { title: true } },
        participants: { include: { user: { select: { firstName: true, lastName: true } } } },
        evaluations: { select: { interviewScore: true, recommendation: true }, orderBy: { submittedAt: 'desc' }, take: 1 },
      },
      orderBy: { scheduledAt: 'asc' },
    })

    const toItem = (r: typeof rows[number]): CandidateInterviewListItem => {
      const e = r.evaluations[0]
      return {
        id: r.id,
        candidateId: r.candidateId,
        type: r.type,
        title: `${r.candidate.firstName} ${r.candidate.lastName} — ${r.hiringRequest.title}`,
        status: r.status,
        scheduledAt: r.scheduledAt.toISOString(),
        durationMinutes: r.durationMinutes,
        round: r.round,
        participantNames: r.participants.map(p => `${p.user.firstName} ${p.user.lastName}`),
        hasEvaluation: !!e,
        interviewScore: e?.interviewScore ?? null,
        evaluationRecommendation: e?.recommendation ?? null,
      }
    }

    const items = rows.map(toItem)
    const today = items.filter(i => {
      const d = new Date(i.scheduledAt)
      return d >= startOfDay && d <= endOfDay
    })
    const upcoming = items.filter(i => new Date(i.scheduledAt) > endOfDay && i.status !== 'COMPLETED' && i.status !== 'CANCELLED')
    const past = items.filter(i => new Date(i.scheduledAt) < startOfDay)
    const completed = items.filter(i => i.status === 'COMPLETED')
    const all = items

    return {
      ok: true,
      data: {
        today,
        upcoming,
        past,
        completed,
        all,
        counts: {
          today: today.length,
          upcoming: upcoming.length,
          past: past.length,
          completed: completed.length,
          all: all.length,
        },
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to load interview center.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}
