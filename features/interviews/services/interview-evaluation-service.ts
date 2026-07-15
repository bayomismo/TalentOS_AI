/**
 * Sprint 8 — Interview Evaluation service.
 *
 * Orchestrates the structured evaluation flow:
 *  - Validate scores against the persisted scorecard
 *  - Compute the deterministic interview score (via the scoring service)
 *  - Persist the evaluation
 *  - Mark the interview COMPLETED
 *  - Publish events + activities
 *
 * Server actions are thin wrappers around this service.
 */

import { db } from '@/lib/db'
import { getEventBus } from '@/lib/events'
import { computeScoring } from './interview-scoring-service'
import { findInterviewForEvaluation, createEvaluation } from '../repositories/evaluation-repository'
import { markInterviewCompleted } from '../repositories/interview-repository'
import type { SubmitEvaluationInput } from '../types'
import type { InterviewKitOutput } from '@/lib/ai/schemas/interview-kit.schema'

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

export async function submitEvaluationService(input: SubmitEvaluationInput & { evaluatorId?: string }): Promise<
  { ok: true; data: { evaluationId: string; interviewScore: number } } |
  { ok: false; error: { code: string; message: string; retryable?: boolean; details?: unknown } }
> {
  const bus = getEventBus()
  try {
    const interview = await findInterviewForEvaluation(input.interviewId)
    if (!interview) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }
    if (interview.evaluations.length > 0) {
      return {
        ok: false,
        error: {
          code: 'ALREADY_SUBMITTED',
          message: 'An evaluation was already submitted for this interview. Delete the existing one first.',
          retryable: false,
        },
      }
    }
    const snapshot = (interview as unknown as { kitSnapshot: InterviewKitOutput | null }).kitSnapshot
    if (!snapshot) {
      return {
        ok: false,
        error: {
          code: 'NO_KIT',
          message: 'No interview kit is attached to this interview. Generate the kit first.',
          retryable: false,
        },
      }
    }

    const scoring = computeScoring(snapshot, input.criterionScores)
    if (!scoring.ok) {
      return {
        ok: false,
        error: {
          code: scoring.error.code,
          message: scoring.error.message,
          retryable: false,
          details: 'details' in scoring.error ? scoring.error.details : undefined,
        },
      }
    }

    // Sprint 9: use the provided evaluatorId (from the auth context in the
    // action layer) instead of guessing via getDefaultActorId. Falls back to
    // the org admin for local scripts that call the service directly.
    const actorId = input.evaluatorId ?? (await getDefaultActorId(interview.candidate.organizationId))
    const evaluation = await createEvaluation({
      interviewId: interview.id,
      evaluatorId: actorId,
      overallScore: scoring.data.overallScore,
      interviewScore: scoring.data.interviewScore,
      criterionScores: scoring.data.criterionScores,
      strengths: input.strengths,
      weaknesses: input.concerns,
      overallNotes: input.overallNotes,
      recommendation: input.recommendation,
      summary: input.overallNotes.slice(0, 400),
    })

    await markInterviewCompleted(interview.id)

    const activity = await db.activity.create({
      data: {
        organizationId: interview.candidate.organizationId,
        type: 'EVALUATION_SUBMITTED',
        actorId,
        candidateId: interview.candidateId,
        hiringRequestId: interview.hiringRequestId,
        interviewId: interview.id,
        title: `Evaluation submitted — ${scoring.data.interviewScore}/100`,
        description: `Recommendation: ${input.recommendation}`,
        metadata: {
          interviewScore: scoring.data.interviewScore,
          overallScore: scoring.data.overallScore,
          recommendation: input.recommendation,
        },
      },
    })

    const evaluator = await db.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true } })
    bus.publish({
      type: 'InterviewEvaluationSubmitted',
      payload: {
        interviewId: interview.id,
        candidateId: interview.candidateId,
        evaluatorName: evaluator ? `${evaluator.firstName} ${evaluator.lastName}` : 'Unknown',
        overallScore: scoring.data.overallScore,
        interviewScore: scoring.data.interviewScore,
        recommendation: input.recommendation,
        submittedAt: evaluation.submittedAt.toISOString(),
      },
    })
    bus.publish({
      type: 'InterviewCompleted',
      payload: {
        interviewId: interview.id,
        candidateId: interview.candidateId,
        completedAt: new Date().toISOString(),
      },
    })
    bus.publish({
      type: 'ActivityRecorded',
      payload: { activity: activitySnapshot({ ...activity, occurredAt: activity.occurredAt }) },
    })

    return { ok: true, data: { evaluationId: evaluation.id, interviewScore: scoring.data.interviewScore } }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message: 'Failed to submit evaluation.',
        retryable: true,
        details: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

// -----------------------------------------------------------------------------
// Dev fallback (LOCAL SCRIPTS ONLY)
// -----------------------------------------------------------------------------
async function getDefaultActorId(orgId: string): Promise<string> {
  const user = await db.user.findFirst({
    where: { organizationId: orgId, role: 'ADMIN', status: 'ACTIVE', disabledAt: null, passwordHash: { not: null } },
    select: { id: true },
  })
  if (user) return user.id
  const any = await db.user.findFirst({ where: { organizationId: orgId }, select: { id: true } })
  if (!any) throw new Error('No user in organization. Run pnpm db:seed first.')
  return any.id
}
