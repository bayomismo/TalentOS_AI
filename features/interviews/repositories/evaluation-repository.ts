/**
 * Sprint 8 — Interview Evaluation repository.
 *
 * Prisma access for `InterviewEvaluation` and the small pieces of the
 * Interview / Candidate chain that the evaluation flow needs.
 */

import { db } from '@/lib/db'
import type { EvaluationRecommendation } from '@prisma/client'
import type { SubmitEvaluationInput } from '../types'

export async function findInterviewForEvaluation(interviewId: string) {
  return db.interview.findUnique({
    where: { id: interviewId },
    include: {
      candidate: {
        select: { id: true, organizationId: true, hiringRequestId: true, firstName: true, lastName: true },
      },
      // Sprint 19 (audit P1-06) — EVERY evaluation, not just the newest
      // one. The guard below is per evaluator: "has THIS interviewer
      // already submitted for this interview?". With `take: 1` the
      // service could not tell "the same interviewer submitted twice"
      // from "a colleague on the panel submitted".
      evaluations: {
        orderBy: { submittedAt: 'desc' },
        select: { id: true, evaluatorId: true, submittedAt: true },
      },
    },
  })
}

/**
 * Audit P1-07 — read back the evaluations of one interview.
 *
 * The evaluator's own evaluation, plus (for a privileged caller) the
 * evaluations of the rest of the panel. The service used to be
 * write-only: an interviewer could not read back what they submitted,
 * so a typo in a score was permanent.
 */
export async function findEvaluationsForInterview(interviewId: string) {
  return db.interviewEvaluation.findMany({
    where: { interviewId },
    orderBy: { submittedAt: 'desc' },
    include: { evaluator: { select: { firstName: true, lastName: true } } },
  })
}

export interface CreateEvaluationRow {
  interviewId: string
  evaluatorId: string
  overallScore: number
  interviewScore: number
  criterionScores: SubmitEvaluationInput['criterionScores']
  strengths: string
  weaknesses: string
  overallNotes: string
  recommendation: EvaluationRecommendation
  summary: string
}

export async function createEvaluation(row: CreateEvaluationRow) {
  return db.interviewEvaluation.create({
    data: {
      interviewId: row.interviewId,
      evaluatorId: row.evaluatorId,
      overallScore: row.overallScore,
      interviewScore: row.interviewScore,
      criterionScores: row.criterionScores as object,
      strengths: row.strengths,
      weaknesses: row.weaknesses,
      overallNotes: row.overallNotes,
      recommendation: row.recommendation,
      summary: row.summary,
    },
  })
}
