/**
 * Sprint 8 — public API for the Decision Hub feature.
 */

// Types
export type {
  ActionResult,
  DecisionReadiness,
  DecisionCandidateView,
  DecisionHubView,
  DecisionBriefSummary,
  ComparisonView,
  GenerateDecisionBriefInput,
  RecordDecisionInput,
  DecisionBriefOutput,
} from './types'

export { READINESS_LABEL, READINESS_COLOR } from './types'

// Server actions
export {
  getDecisionHubAction,
  getComparisonAction,
  logComparisonViewedAction,
  generateDecisionBriefAction,
  recordDecisionAction,
} from './actions/get-decision-hub'

// Services
export { computeReadiness, readinessFromCandidate } from './services/decision-readiness-service'
