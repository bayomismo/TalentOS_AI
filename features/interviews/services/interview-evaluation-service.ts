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
import { InterviewStatus } from '@prisma/client'
import { computeScoring } from './interview-scoring-service'
import { findInterviewForEvaluation, createEvaluation } from '../repositories/evaluation-repository'
import { transitionInterviewStatus } from '@/lib/interviews/transition'
import type { SubmitEvaluationInput } from '../types'
import type { InterviewKitOutput } from '@/lib/ai/schemas/interview-kit.schema'

/**
 * True when the database refused the write because of a UNIQUE
 * constraint (Prisma P2002). The one-evaluation-per-interviewer rule is
 * enforced by `@@unique([interviewId, evaluatorId])`, so a concurrent
 * submission from the same interviewer arrives here as a constraint
 * violation — which must be a clean, typed error, never a 500.
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const code = (err as { code?: unknown }).code
  if (code !== 'P2002') return false
  const meta = (err as { meta?: { target?: unknown } }).meta
  const target = Array.isArray(meta?.target) ? meta?.target.join(',') : String(meta?.target ?? '')
  // Only treat it as the evaluation guard when it is the constraint we
  // care about; any other unique violation is a real error.
  return target.includes('interviewId') && target.includes('evaluatorId')
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

    // Sprint 9: use the provided evaluatorId (from the auth context in the
    // action layer) instead of guessing via getDefaultActorId. Falls back to
    // the org admin for local scripts that call the service directly.
    const actorId = input.evaluatorId ?? (await getDefaultActorId(interview.candidate.organizationId))

    // -----------------------------------------------------------------------
    // Audit P1-06 — ONE evaluation per INTERVIEWER per interview.
    //
    // The old guard counted EVERY evaluation of the interview, so a panel
    // interview was structurally impossible: the second interviewer was
    // told "An evaluation was already submitted for this interview.
    // Delete the existing one first" — and no delete flow existed.
    //
    // The database now enforces the same rule
    // (`@@unique([interviewId, evaluatorId])`), and this guard turns the
    // constraint violation into a clean, typed error instead of a 500.
    // -----------------------------------------------------------------------
    const ownEvaluation = interview.evaluations.find(e => e.evaluatorId === actorId)
    if (ownEvaluation) {
      return {
        ok: false,
        error: {
          code: 'ALREADY_SUBMITTED',
          message:
            'You have already submitted an evaluation for this interview. ' +
            'Each interviewer submits one evaluation per interview.',
          retryable: false,
        },
      }
    }

    // A cancelled or no-show interview cannot be evaluated — the session
    // did not happen.
    if (interview.status === 'CANCELLED' || interview.status === 'NO_SHOW') {
      return {
        ok: false,
        error: {
          code: 'INTERVIEW_NOT_ACTIVE',
          message: `This interview is ${interview.status.toLowerCase().replace('_', ' ')} and cannot be evaluated.`,
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

    let evaluation
    try {
      evaluation = await createEvaluation({
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
    } catch (err) {
      // The unique constraint is the real guard — the check above is only
      // a fast path. A concurrent submission from the same interviewer
      // must be a clean, typed refusal, not a 500.
      if (isUniqueConstraintViolation(err)) {
        return {
          ok: false,
          error: {
            code: 'ALREADY_SUBMITTED',
            message:
              'You have already submitted an evaluation for this interview. ' +
              'Each interviewer submits one evaluation per interview.',
            retryable: false,
          },
        }
      }
      throw err
    }

    // -----------------------------------------------------------------------
    // The interview is COMPLETED once the FIRST evaluation lands — a
    // later panel member must not move `completedAt` again.
    // -----------------------------------------------------------------------
    const wasFirstEvaluation = interview.evaluations.length === 0
    if (wasFirstEvaluation) {
      const completed = await db.$transaction(async (tx) => {
        // A panel member may submit their evaluation for an interview
        // that was never formally started: the session obviously
        // happened, so the interview goes SCHEDULED → IN_PROGRESS →
        // COMPLETED inside one transaction.
        if (interview.status === 'SCHEDULED' || interview.status === 'RESCHEDULED') {
          const started = await transitionInterviewStatus(tx, {
            interviewId: interview.id,
            toStatus: InterviewStatus.IN_PROGRESS,
            startedAt: evaluation.submittedAt,
          })
          if (!started.ok) return started
        }
        return transitionInterviewStatus(tx, {
          interviewId: interview.id,
          toStatus: InterviewStatus.COMPLETED,
          completedAt: evaluation.submittedAt,
        })
      })
      if (!completed.ok) {
        return {
          ok: false,
          error: {
            code: completed.error.code,
            message: completed.error.message,
            retryable: false,
          },
        }
      }
    }

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
    // The interview is completed by the FIRST evaluation. A panel
    // member submitting later does not re-complete it (and does not move
    // `completedAt`).
    if (wasFirstEvaluation) {
      bus.publish({
        type: 'InterviewCompleted',
        payload: {
          interviewId: interview.id,
          candidateId: interview.candidateId,
          completedAt: evaluation.submittedAt.toISOString(),
        },
      })
    }
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
