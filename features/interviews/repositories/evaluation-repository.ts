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
      evaluations: { take: 1, orderBy: { submittedAt: 'desc' } },
    },
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
