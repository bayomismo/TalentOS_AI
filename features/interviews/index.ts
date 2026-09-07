/**
 * Server-side barrel for the `interviews` feature. Re-exports types and
 * actions, plus service-level helpers and mappers for advanced consumers
 * and tests. NOT intended to be imported from client components — the
 * service modules pull in Prisma. Use the per-action submodules for the
 * client-safe surface.
 */

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
