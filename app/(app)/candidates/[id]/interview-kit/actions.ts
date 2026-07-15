'use server'

/**
 * Sprint 8 — back-compat re-export shim.
 *
 * The Sprint 7 implementation lived in this file. It has been refactored
 * into `features/interviews/` and the public API is now exported from
 * `features/interviews/index.ts`. This file exists ONLY so existing
 * imports (`from '.../interview-kit/actions'`) keep working.
 *
 * New consumers should import from `@/features/interviews`.
 */

export {
  generateInterviewKitAction,
  createInterviewAction,
  submitEvaluationAction,
  markInterviewQuestionAskedAction,
  markInterviewStartedAction,
  getInterviewKitAction,
  getCandidateInterviewsAction,
  getInterviewCenterAction,
} from '@/features/interviews'

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
} from '@/features/interviews'
