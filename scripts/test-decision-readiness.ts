/**
 * Local unit test for computeReadiness.
 */

import { computeReadiness, readinessFromCandidate } from '../features/decisions/services/decision-readiness-service'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++ }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++ }
}

function main() {
  console.log('\n=== computeReadiness unit tests ===\n')

  // No AI analysis
  ok('NOT_READY when no match analysis',
    computeReadiness({ hasMatchAnalysis: false, hasCompletedInterview: false, hasEvaluation: false }) === 'NOT_READY')
  ok('NOT_READY even with interview but no analysis',
    computeReadiness({ hasMatchAnalysis: false, hasCompletedInterview: true, hasEvaluation: true }) === 'NOT_READY')

  // AI analyzed but no interview
  ok('NEEDS_INTERVIEW when analysis but no interview',
    computeReadiness({ hasMatchAnalysis: true, hasCompletedInterview: false, hasEvaluation: false }) === 'NEEDS_INTERVIEW')
  ok('NEEDS_INTERVIEW when analysis + scheduled but not completed',
    computeReadiness({ hasMatchAnalysis: true, hasCompletedInterview: false, hasEvaluation: false }) === 'NEEDS_INTERVIEW')

  // Interview completed but no evaluation
  ok('AWAITING_EVALUATION when analysis + completed interview but no eval',
    computeReadiness({ hasMatchAnalysis: true, hasCompletedInterview: true, hasEvaluation: false }) === 'AWAITING_EVALUATION')

  // Full path
  ok('READY_FOR_REVIEW when analysis + completed + evaluated',
    computeReadiness({ hasMatchAnalysis: true, hasCompletedInterview: true, hasEvaluation: true }) === 'READY_FOR_REVIEW')

  // readinessFromCandidate convenience
  ok('readinessFromCandidate → NOT_READY for unanalyzed candidate',
    readinessFromCandidate({ matchScore: null }, null) === 'NOT_READY')
  ok('readinessFromCandidate → NEEDS_INTERVIEW for scheduled',
    readinessFromCandidate({ matchScore: 80 }, { status: 'SCHEDULED', completedAt: null, evaluations: [] }) === 'NEEDS_INTERVIEW')
  ok('readinessFromCandidate → AWAITING_EVALUATION for completed-no-eval',
    readinessFromCandidate({ matchScore: 80 }, { status: 'COMPLETED', completedAt: new Date(), evaluations: [] }) === 'AWAITING_EVALUATION')
  ok('readinessFromCandidate → READY_FOR_REVIEW for completed + eval',
    readinessFromCandidate({ matchScore: 80 }, { status: 'COMPLETED', completedAt: new Date(), evaluations: [{}] }) === 'READY_FOR_REVIEW')
  // In-progress interview is NOT completed
  ok('readinessFromCandidate → NEEDS_INTERVIEW for IN_PROGRESS (not yet completed)',
    readinessFromCandidate({ matchScore: 80 }, { status: 'IN_PROGRESS', completedAt: null, evaluations: [] }) === 'NEEDS_INTERVIEW')

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`)
  if (fail > 0) process.exit(1)
}

main()
