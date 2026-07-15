/**
 * Sprint 8 — back-compat re-export shim.
 *
 * The Sprint 7 implementation lived in this file. It has been refactored
 * into `features/interviews/` and the public API is now exported from
 * `features/interviews/index.ts`. This file exists ONLY so existing
 * imports (`from '.../interview-kit/actions'`) keep working.
 *
 * New consumers should import from `@/features/interviews`.
 *
 * No 'use server' here — the underlying action modules inside
 * `features/interviews/actions/*.ts` carry that directive, so Next.js
 * still wires them up as server actions at the import site.
 */

export { generateInterviewKitAction } from '@/features/interviews/actions/generate-interview-kit'
export { createInterviewAction } from '@/features/interviews/actions/create-interview'
export { submitEvaluationAction } from '@/features/interviews/actions/submit-evaluation'
export {
  markInterviewQuestionAskedAction,
  markInterviewStartedAction,
} from '@/features/interviews/actions/update-question'
export {
  getInterviewKitAction,
  getCandidateInterviewsAction,
  getInterviewCenterAction,
} from '@/features/interviews/actions/get-interview-data'

export type {
  ActionResult,
  KitQuestionView,
  KitScorecardView,
  InterviewKitView,
  CandidateInterviewListItem,
  InterviewCenterData,
  GenerateInterviewKitInput,
  CreateInterviewInput,
  MarkQuestionAskedInput,
  SubmitEvaluationInput,
  InterviewKitOutput,
} from '@/features/interviews/types'
