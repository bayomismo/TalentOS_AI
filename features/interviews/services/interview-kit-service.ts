/**
 * Sprint 8 — Interview Kit service.
 *
 * Orchestrates the AI generation + persistence flow for a candidate's
 * personalized interview kit. The service is the only place that knows
 * how to:
 *  - Build the AI engine input
 *  - Call the engine
 *  - Persist the interview + questions + participants
 *  - Publish events + create activities
 *  - Auto-advance the candidate from SCREENING to INTERVIEW
 *
 * Server actions are thin wrappers around this service.
 */

import { db } from '@/lib/db'
import { getAIEngine } from '@/lib/ai/service/ai-engine'
import { enforceAiQuota, recordAiUsage } from '@/lib/ai/quota'
import { getEventBus } from '@/lib/events'
import { interviewKitOutputSchema, type InterviewKitOutput } from '@/lib/ai/schemas/interview-kit.schema'
import type { GenerateInterviewKitInput, InterviewKitView } from '../types'
import { kitQuestionToView, resolveInterviewType, scorecardSnapshotToView } from '../mappers/interview-mappers'
import {
  bulkInsertQuestions,
  createInterview,
  deleteAllQuestionsForInterview,
  findOpenInterviewForCandidate,
  findExistingParticipants,
  upsertParticipant,
  updateInterviewKit,
} from '../repositories/interview-repository'

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

async function resolveNames(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { firstName: true, lastName: true },
  })
  return users.map(u => `${u.firstName} ${u.lastName}`)
}

function activitySnapshot(a: {
  id: string
  type: string
  title: string
  description: string | null
  occurredAt: Date
}) {
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

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

export interface GenerateKitResult {
  interviewId: string
  kit: InterviewKitView
}

export async function generateInterviewKitService(
  input: GenerateInterviewKitInput
): Promise<{ ok: true; data: GenerateKitResult } | { ok: false; error: { code: string; message: string; retryable?: boolean; details?: unknown } }> {
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
        error: {
          code: 'NO_JD',
          message: 'This candidate has no job description yet. Generate one first.',
          retryable: false,
        },
      }
    }
    const hr = candidate.hiringRequest
    const jd = hr.jobDescription!
    const eligibleStages = ['SCREENING', 'INTERVIEW'] as const
    if (!eligibleStages.includes(candidate.stage as (typeof eligibleStages)[number])) {
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
        scoreBreakdown:
          (candidate.matchScoreBreakdown as { skills: number; experience: number; roleAlignment: number; education: number } | null) ?? {
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

    // Sprint 16 — per-org AI quota. Refuse if over limit.
    const quotaCheck = await enforceAiQuota(candidate.organizationId, 'interview_kit')
    if (!quotaCheck.allowed) {
      return {
        ok: false,
        error: {
          code: 'AI_LIMIT_REACHED',
          message: quotaCheck.message ?? 'AI limit reached for this month.',
          retryable: false,
        },
      }
    }

    const result = await getAIEngine().generateInterviewKit(engineInput)
    await recordAiUsage({
      organizationId: candidate.organizationId,
      feature: 'interview_kit',
      tokensIn: result.usage.inputTokens,
      tokensOut: result.usage.outputTokens,
    })
    const kit: InterviewKitOutput = result.data
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

    const actorId = await getDefaultActorId(candidate.organizationId)
    const requestedInterviewerIds = input.interviewerIds && input.interviewerIds.length > 0
      ? input.interviewerIds
      : [actorId]

    let interview = await findOpenInterviewForCandidate(candidate.id)
    const interviewType = input.type ?? resolveInterviewType(kit.overview.recommendedType, interview?.type)
    const durationMinutes = input.durationMinutes ?? kit.overview.recommendedDurationMinutes
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const isReschedule = !!interview
    const previousStatus = interview?.status

    if (!interview) {
      interview = await createInterview({
        organizationId: candidate.organizationId,
        hiringRequestId: candidate.hiringRequestId,
        candidateId: candidate.id,
        scheduledById: actorId,
        type: interviewType,
        title: `${interviewType.replace(/_/g, ' ')} — ${candidate.firstName} ${candidate.lastName} (Round ${candidate.stage === 'SCREENING' ? 1 : 2})`,
        scheduledAt,
        durationMinutes,
        stage: 'INTERVIEW',
        round: candidate.stage === 'SCREENING' ? 1 : 2,
        kitSnapshot: kit,
      })
    } else {
      interview = await updateInterviewKit(interview.id, {
        type: interviewType,
        durationMinutes,
        scheduledAt,
        kitSnapshot: kit,
      })
      await deleteAllQuestionsForInterview(interview.id)
    }

    await bulkInsertQuestions(interview!.id, kit)

    const existing = await findExistingParticipants(interview!.id)
    const existingKeys = new Set(existing.map(p => `${p.userId}::${p.role ?? ''}`))
    for (const userId of requestedInterviewerIds) {
      const role = 'INTERVIEWER'
      const key = `${userId}::${role}`
      if (existingKeys.has(key)) continue
      await upsertParticipant(interview!.id, userId, role)
    }

    const activity = await db.activity.create({
      data: {
        organizationId: candidate.organizationId,
        type: 'INTERVIEW_KIT_GENERATED',
        actorId,
        candidateId: candidate.id,
        hiringRequestId: candidate.hiringRequestId,
        interviewId: interview!.id,
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

    bus.publish({
      type: 'InterviewKitGenerated',
      payload: {
        interviewId: interview!.id,
        candidateId: candidate.id,
        hiringRequestId: candidate.hiringRequestId,
        recommendedType: kit.overview.recommendedType,
        recommendedDurationMinutes: kit.overview.recommendedDurationMinutes,
        questionCount: kit.questions.length,
        criterionCount: kit.scorecardCriteria.length,
        generatedAt: new Date().toISOString(),
      },
    })
    bus.publish({
      type: 'InterviewCreated',
      payload: {
        interviewId: interview!.id,
        candidateId: candidate.id,
        hiringRequestId: candidate.hiringRequestId,
        scheduledAt: interview!.scheduledAt.toISOString(),
        durationMinutes: interview!.durationMinutes,
        type: interview!.type,
        round: interview!.round,
        participantNames: await resolveNames(requestedInterviewerIds),
      },
    })
    bus.publish({
      type: 'ActivityRecorded',
      payload: { activity: activitySnapshot({ ...activity, occurredAt: activity.occurredAt }) },
    })

    if (!isReschedule && previousStatus === undefined && candidate.stage === 'SCREENING') {
      await db.candidate.update({
        where: { id: candidate.id },
        data: { stage: 'INTERVIEW' },
      })
      const stageActivity = await db.activity.create({
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
      bus.publish({
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
      bus.publish({
        type: 'ActivityRecorded',
        payload: { activity: activitySnapshot({ ...stageActivity, occurredAt: stageActivity.occurredAt }) },
      })
    }

    const view = await buildInterviewKitView(interview!.id)
    if (!view.ok) {
      return { ok: false, error: view.error }
    }
    return { ok: true, data: { interviewId: interview!.id, kit: view.data } }
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

// -----------------------------------------------------------------------------
// View builder (also used by getInterviewKitAction)
// -----------------------------------------------------------------------------

import { findInterviewWithQuestions } from '../repositories/interview-repository'

export async function buildInterviewKitView(
  interviewId: string
): Promise<{ ok: true; data: InterviewKitView } | { ok: false; error: { code: string; message: string; retryable?: boolean; details?: unknown } }> {
  try {
    const interview = await findInterviewWithQuestions(interviewId)
    if (!interview) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }
    const snapshot = interview.kitSnapshot as InterviewKitOutput | null
    const candidateName = `${interview.candidate.firstName} ${interview.candidate.lastName}`

    const scorecard = snapshot?.scorecardCriteria
      ? scorecardSnapshotToView(snapshot.scorecardCriteria)
      : []

    const questions = interview.questions.map(kitQuestionToView)
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
          recommendedType: (snapshot?.overview.recommendedType as InterviewKitView['overview']['recommendedType'] | undefined) ?? interview.type,
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
