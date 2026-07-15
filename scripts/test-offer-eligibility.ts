/**
 * Sprint 10 — Offer eligibility unit tests.
 *
 * Pure, no DB. Tests the deterministic SELECTED-gate + duplicate-active
 * guard (PART 3 + PART 31).
 */

import { checkOfferEligibility, isActiveOfferStatus } from '../lib/offers/eligibility'
import { OfferStatus, DecisionValue } from '@prisma/client'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', name); pass++ }
  else { console.log('  ✗', name, detail ?? ''); fail++ }
}

const orgId = '00000000-0000-0000-0000-000000000001'
const candidate = { id: 'c1', organizationId: orgId }
const hrId = '00000000-0000-0000-0000-00000000000a'

console.log('A. SELECTED-gate (PART 3)')

let r = checkOfferEligibility({
  candidate,
  hiringRequestId: hrId,
  hiringRequestOrganizationId: orgId,
  latestDecision: null,
  existingOffers: [],
})
check('A.1 no decision → not eligible', !r.ok && r.code === 'NO_HUMAN_DECISION')

r = checkOfferEligibility({
  candidate,
  hiringRequestId: hrId,
  hiringRequestOrganizationId: orgId,
  latestDecision: { candidateId: 'c1', hiringRequestId: hrId, decision: DecisionValue.ADVANCE },
  existingOffers: [],
})
check('A.2 ADVANCE decision → not eligible', !r.ok && r.code === 'DECISION_NOT_SELECTED')

r = checkOfferEligibility({
  candidate,
  hiringRequestId: hrId,
  hiringRequestOrganizationId: orgId,
  latestDecision: { candidateId: 'c1', hiringRequestId: hrId, decision: DecisionValue.HOLD },
  existingOffers: [],
})
check('A.3 HOLD decision → not eligible', !r.ok && r.code === 'DECISION_NOT_SELECTED')

r = checkOfferEligibility({
  candidate,
  hiringRequestId: hrId,
  hiringRequestOrganizationId: orgId,
  latestDecision: { candidateId: 'c1', hiringRequestId: hrId, decision: DecisionValue.REJECT },
  existingOffers: [],
})
check('A.4 REJECT decision → not eligible', !r.ok && r.code === 'DECISION_NOT_SELECTED')

r = checkOfferEligibility({
  candidate,
  hiringRequestId: hrId,
  hiringRequestOrganizationId: orgId,
  latestDecision: { candidateId: 'c1', hiringRequestId: hrId, decision: DecisionValue.SELECTED },
  existingOffers: [],
})
check('A.5 SELECTED decision → eligible', r.ok)

r = checkOfferEligibility({
  candidate,
  hiringRequestId: hrId,
  hiringRequestOrganizationId: orgId,
  latestDecision: { candidateId: 'c1', hiringRequestId: 'other-hr', decision: DecisionValue.SELECTED },
  existingOffers: [],
})
check('A.6 SELECTED for different HR → not eligible', !r.ok && r.code === 'HIRING_REQUEST_MISMATCH')

console.log('\nB. Duplicate-active-offer guard (PART 31)')

const baseInput = {
  candidate,
  hiringRequestId: hrId,
  hiringRequestOrganizationId: orgId,
  latestDecision: { candidateId: 'c1', hiringRequestId: hrId, decision: DecisionValue.SELECTED },
}

r = checkOfferEligibility({ ...baseInput, existingOffers: [
  { id: 'o1', candidateId: 'c1', hiringRequestId: hrId, status: OfferStatus.DRAFT },
]})
check('B.1 active DRAFT blocks', !r.ok && r.code === 'ACTIVE_OFFER_EXISTS')

r = checkOfferEligibility({ ...baseInput, existingOffers: [
  { id: 'o1', candidateId: 'c1', hiringRequestId: hrId, status: OfferStatus.PENDING_APPROVAL },
]})
check('B.2 active PENDING_APPROVAL blocks', !r.ok && r.code === 'ACTIVE_OFFER_EXISTS')

r = checkOfferEligibility({ ...baseInput, existingOffers: [
  { id: 'o1', candidateId: 'c1', hiringRequestId: hrId, status: OfferStatus.APPROVED },
]})
check('B.3 active APPROVED blocks', !r.ok && r.code === 'ACTIVE_OFFER_EXISTS')

r = checkOfferEligibility({ ...baseInput, existingOffers: [
  { id: 'o1', candidateId: 'c1', hiringRequestId: hrId, status: OfferStatus.ISSUED },
]})
check('B.4 active ISSUED blocks', !r.ok && r.code === 'ACTIVE_OFFER_EXISTS')

r = checkOfferEligibility({ ...baseInput, existingOffers: [
  { id: 'o1', candidateId: 'c1', hiringRequestId: hrId, status: OfferStatus.ACCEPTED },
]})
check('B.5 ACCEPTED blocks (PART 31 clarification)', !r.ok && r.code === 'ACTIVE_OFFER_EXISTS')

console.log('\nC. Historical terminal offers do NOT block')

const historical = [
  OfferStatus.DECLINED,
  OfferStatus.WITHDRAWN,
  OfferStatus.EXPIRED,
  OfferStatus.SENT,         // legacy
  OfferStatus.UNDER_REVIEW, // legacy
]
for (const status of historical) {
  r = checkOfferEligibility({ ...baseInput, existingOffers: [
    { id: 'o1', candidateId: 'c1', hiringRequestId: hrId, status },
  ]})
  check(`C.${status} does NOT block (eligible to retry)`, r.ok)
}

console.log('\nD. Offers for other (candidate, HR) pairs do not affect eligibility')

r = checkOfferEligibility({ ...baseInput, existingOffers: [
  { id: 'o1', candidateId: 'c1', hiringRequestId: 'OTHER_HR', status: OfferStatus.ACCEPTED },
]})
check('D.1 offer for different HR is ignored', r.ok)

r = checkOfferEligibility({ ...baseInput, existingOffers: [
  { id: 'o1', candidateId: 'OTHER_CANDIDATE', hiringRequestId: hrId, status: OfferStatus.ACCEPTED },
]})
check('D.2 offer for different candidate is ignored', r.ok)

console.log('\nE. Cross-tenant is caught')

r = checkOfferEligibility({
  candidate: { id: 'c1', organizationId: 'OTHER_ORG' },
  hiringRequestId: hrId,
  hiringRequestOrganizationId: orgId,
  latestDecision: { candidateId: 'c1', hiringRequestId: hrId, decision: DecisionValue.SELECTED },
  existingOffers: [],
})
check('E.1 candidate in other org → CANDIDATE_NOT_IN_ORG', !r.ok && r.code === 'CANDIDATE_NOT_IN_ORG')

console.log(`\n=== ${pass} passed, ${fail} failed ===`)
process.exit(fail > 0 ? 1 : 0)
