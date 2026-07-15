/**
 * Sprint 8 — Interview feature mappers.
 *
 * Pure functions that convert Prisma rows to view models. No I/O — testable
 * in isolation.
 */

import type { InterviewType } from '@prisma/client'
import {
  extractQuestionMeta,
  type InterviewKitOutput,
} from '@/lib/ai/schemas/interview-kit.schema'
import type {
  KitQuestionView,
  KitScorecardView,
} from '../types'

/**
 * Convert a persisted InterviewQuestion row to the UI view model.
 * The Follow-up / Difficulty trailers are extracted from
 * `strongAnswerIndicators` on the fly (the row stored at write time
 * already has them split out into dedicated columns, but we re-parse
 * for safety in case the data came from a different write path).
 */
export function kitQuestionToView(
  q: {
    id: string
    order: number
    purpose: import('@prisma/client').QuestionPurpose
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
  const extracted = extractQuestionMeta(q.strongAnswerIndicators ?? '')
  return {
    id: q.id,
    order: q.order,
    purpose: q.purpose,
    category: q.category,
    question: q.question,
    whyThisQuestion: q.whyThisQuestion ?? '',
    strongAnswer: q.strongAnswerIndicators ?? '',
    redFlags: q.redFlags ?? '',
    difficulty: q.difficulty,
    suggestedFollowUp: q.suggestedFollowUp ?? extracted.suggestedFollowUp,
    askedAt: q.askedAt ? q.askedAt.toISOString() : null,
    notes: q.notes,
  }
}

/**
 * Convert the denormalized scorecard snapshot into a UI view, with a
 * deterministic "meets expectations" indicator computed as the midpoint
 * between the poor and excellent indicators.
 */
export function scorecardSnapshotToView(
  criteria: NonNullable<InterviewKitOutput['scorecardCriteria']>
): KitScorecardView[] {
  return criteria.map(c => ({
    name: c.name,
    description: c.description,
    weight: c.weight,
    poorIndicator: c.indicators.poor,
    meetsIndicator: midpointIndicator(c.indicators.poor, c.indicators.excellent),
    excellentIndicator: c.indicators.excellent,
  }))
}

function trimPeriod(s: string): string {
  return s.endsWith('.') ? s.slice(0, -1) : s
}

/**
 * Cheap, deterministic midpoint text between two indicator strings.
 * The real midpoint is the interviewer's judgment — we just give a
 * reasonable sentence in between so the UI has something to display.
 */
export function midpointIndicator(poor: string, excellent: string): string {
  return `Solid, on-target evidence across most criteria; not yet at the bar where ${trimPeriod(excellent.toLowerCase())}.`
}

/**
 * Map a `QuestionPurpose` to the closest existing `QuestionType`. The
 * old `QuestionType` enum (TECHNICAL/BEHAVIORAL/etc.) is kept for
 * backwards compatibility with the UI; the new `QuestionPurpose` is
 * the canonical field going forward.
 */
export function purposeToQuestionType(
  p: import('@prisma/client').QuestionPurpose
): 'TECHNICAL' | 'BEHAVIORAL' | 'SITUATIONAL' | 'CULTURAL' | 'CASE_STUDY' | 'SYSTEM_DESIGN' | 'CODING' {
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

/**
 * Resolves the canonical interview type from the AI's recommendation.
 * Falls back to the existing interview's type, then `TECHNICAL`.
 */
export function resolveInterviewType(
  kitRecommended: InterviewKitOutput['overview']['recommendedType'] | undefined,
  existing: InterviewType | undefined
): InterviewType {
  if (kitRecommended && isInterviewType(kitRecommended)) return kitRecommended
  return existing ?? 'TECHNICAL'
}

function isInterviewType(s: string): s is InterviewType {
  return [
    'PHONE_SCREEN',
    'TECHNICAL',
    'BEHAVIORAL',
    'PANEL',
    'ONSITE',
    'FINAL',
    'CULTURE_FIT',
    'CASE_STUDY',
  ].includes(s)
}
