/**
 * Sprint 10 — Offer eligibility (pure, testable).
 *
 * PART 3: a candidate becomes eligible for an offer only after a
 * recorded human final decision of SELECTED. AI recommendation,
 * interview score, or AI Decision Brief are NOT sufficient.
 *
 * PART 31 (updated): an active offer (DRAFT, PENDING_APPROVAL, APPROVED,
 * ISSUED, ACCEPTED) for the same candidate + hiring request blocks
 * creation of another offer. Terminal historical statuses (DECLINED,
 * WITHDRAWN, EXPIRED, plus legacy SENT/UNDER_REVIEW) allow a new offer
 * with the prior offer preserved.
 */

import { CandidateDecision, DecisionValue, OfferStatus, type Candidate } from '@prisma/client'
import { isActiveOfferStatus } from './state-machine'

export type EligibilityFailureCode =
  | 'CANDIDATE_NOT_FOUND'
  | 'CANDIDATE_NOT_IN_ORG'
  | 'NO_HUMAN_DECISION'
  | 'DECISION_NOT_SELECTED'
  | 'HIRING_REQUEST_MISMATCH'
  | 'ACTIVE_OFFER_EXISTS'

export type EligibilityResult =
  | { ok: true }
  | { ok: false; code: EligibilityFailureCode; message: string; blockingOfferId?: string }

export interface CandidateForEligibility {
  id: string
  organizationId: string
}

export interface DecisionForEligibility {
  candidateId: string
  hiringRequestId: string
  decision: DecisionValue
}

export interface ActiveOfferForEligibility {
  id: string
  candidateId: string
  hiringRequestId: string
  status: OfferStatus
}

/**
 * Pure check: is the candidate eligible to have an offer created for the
 * given hiring request, given the latest human decision and the existing
 * offers?
 *
 * The caller is responsible for fetching the latest CandidateDecision row
 * and any existing offers — this function does not hit the database.
 */
export function checkOfferEligibility(input: {
  candidate: CandidateForEligibility
  hiringRequestId: string
  hiringRequestOrganizationId: string
  latestDecision: DecisionForEligibility | null
  existingOffers: ActiveOfferForEligibility[]
}): EligibilityResult {
  if (!input.candidate) {
    return { ok: false, code: 'CANDIDATE_NOT_FOUND', message: 'Candidate not found.' }
  }
  if (input.candidate.organizationId !== input.hiringRequestOrganizationId) {
    return {
      ok: false,
      code: 'CANDIDATE_NOT_IN_ORG',
      message: 'Candidate and hiring request are not in the same organization.',
    }
  }
  if (!input.latestDecision) {
    return {
      ok: false,
      code: 'NO_HUMAN_DECISION',
      message:
        'A human final decision of SELECTED is required before an offer can be created.',
    }
  }
  if (input.latestDecision.hiringRequestId !== input.hiringRequestId) {
    return {
      ok: false,
      code: 'HIRING_REQUEST_MISMATCH',
      message: 'The recorded decision is for a different hiring request.',
    }
  }
  if (input.latestDecision.decision !== DecisionValue.SELECTED) {
    return {
      ok: false,
      code: 'DECISION_NOT_SELECTED',
      message: `Candidate is not selected (decision = ${input.latestDecision.decision}).`,
    }
  }
  // Duplicate active offer guard.
  // A new offer is blocked if there is ANY active offer for the same
  // (candidate, hiringRequest) pair. Accepted offers are also active by
  // policy (PART 31 clarification).
  const blocking = input.existingOffers.find(
    o =>
      o.candidateId === input.candidate.id &&
      o.hiringRequestId === input.hiringRequestId &&
      isActiveOfferStatus(o.status),
  )
  if (blocking) {
    return {
      ok: false,
      code: 'ACTIVE_OFFER_EXISTS',
      message: `An active offer already exists for this candidate and hiring request (status = ${blocking.status}).`,
      blockingOfferId: blocking.id,
    }
  }
  return { ok: true }
}

// Re-export so callers don't need to import two places
export { isActiveOfferStatus }
