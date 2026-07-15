/**
 * Sprint 8 — public API for the `interviews` feature.
 *
 * This is the single import surface that other features / pages should
 * use. It re-exports types, server actions, and the key mappers +
 * scoring service.
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

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
  InterviewType,
  InterviewStatus,
  ApplicationStage,
  QuestionPurpose,
  QuestionDifficulty,
  EvaluationRecommendation,
} from './types'

// -----------------------------------------------------------------------------
// Server actions
// -----------------------------------------------------------------------------

export { generateInterviewKitAction } from './actions/generate-interview-kit'
export { createInterviewAction } from './actions/create-interview'
export { submitEvaluationAction } from './actions/submit-evaluation'
export {
  markInterviewQuestionAskedAction,
  markInterviewStartedAction,
} from './actions/update-question'
export {
  getInterviewKitAction,
  getCandidateInterviewsAction,
  getInterviewCenterAction,
} from './actions/get-interview-data'

// -----------------------------------------------------------------------------
// Service-level exports (for advanced consumers and tests)
// -----------------------------------------------------------------------------

export { computeScoring } from './services/interview-scoring-service'
export { generateInterviewKitService } from './services/interview-kit-service'
export { submitEvaluationService } from './services/interview-evaluation-service'
export {
  kitQuestionToView,
  scorecardSnapshotToView,
  midpointIndicator,
  purposeToQuestionType,
  resolveInterviewType,
} from './mappers/interview-mappers'
