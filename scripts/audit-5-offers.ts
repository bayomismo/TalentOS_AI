/**
 * Test the offer state machine: every valid transition should work,
 * every invalid one should be rejected.
 */
import { validateTransition, isActiveOfferStatus, allowedNextStatuses } from '../lib/offers/state-machine'
import { OfferStatus } from '@prisma/client'

let pass = 0, fail = 0
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}

function main() {
  console.log('=== Offer state machine ===\n')

  // All valid forward transitions
  console.log('[1] Valid forward transitions')
  ok('DRAFT → PENDING_APPROVAL',
    validateTransition(OfferStatus.DRAFT, OfferStatus.PENDING_APPROVAL).ok)
  ok('PENDING_APPROVAL → APPROVED',
    validateTransition(OfferStatus.PENDING_APPROVAL, OfferStatus.APPROVED).ok)
  ok('PENDING_APPROVAL → DRAFT (return for changes)',
    validateTransition(OfferStatus.PENDING_APPROVAL, OfferStatus.DRAFT).ok)
  ok('APPROVED → ISSUED',
    validateTransition(OfferStatus.APPROVED, OfferStatus.ISSUED).ok)
  ok('ISSUED → ACCEPTED',
    validateTransition(OfferStatus.ISSUED, OfferStatus.ACCEPTED).ok)
  ok('ISSUED → DECLINED',
    validateTransition(OfferStatus.ISSUED, OfferStatus.DECLINED).ok)
  ok('ISSUED → WITHDRAWN',
    validateTransition(OfferStatus.ISSUED, OfferStatus.WITHDRAWN).ok)
  ok('ISSUED → EXPIRED',
    validateTransition(OfferStatus.ISSUED, OfferStatus.EXPIRED).ok)
  console.log('')

  // Invalid transitions
  console.log('[2] Invalid transitions')
  ok('DRAFT → ISSUED (skip approval)',
    !validateTransition(OfferStatus.DRAFT, OfferStatus.ISSUED).ok)
  ok('DRAFT → ACCEPTED (skip everything)',
    !validateTransition(OfferStatus.DRAFT, OfferStatus.ACCEPTED).ok)
  ok('ACCEPTED → anything (terminal)',
    !validateTransition(OfferStatus.ACCEPTED, OfferStatus.DRAFT).ok)
  ok('ACCEPTED → DECLINED (terminal)',
    !validateTransition(OfferStatus.ACCEPTED, OfferStatus.DECLINED).ok)
  ok('DECLINED → anything (terminal)',
    !validateTransition(OfferStatus.DECLINED, OfferStatus.ACCEPTED).ok)
  ok('PENDING_APPROVAL → ISSUED (skip approved)',
    !validateTransition(OfferStatus.PENDING_APPROVAL, OfferStatus.ISSUED).ok)
  ok('APPROVED → DRAFT (cannot go back to draft)',
    !validateTransition(OfferStatus.APPROVED, OfferStatus.DRAFT).ok)
  ok('Same state (DRAFT → DRAFT)',
    !validateTransition(OfferStatus.DRAFT, OfferStatus.DRAFT).ok)
  console.log('')

  // Active offer status
  console.log('[3] Active offer status (blocks creating new offer)')
  ok('DRAFT is active', isActiveOfferStatus(OfferStatus.DRAFT))
  ok('PENDING_APPROVAL is active', isActiveOfferStatus(OfferStatus.PENDING_APPROVAL))
  ok('APPROVED is active', isActiveOfferStatus(OfferStatus.APPROVED))
  ok('ISSUED is active', isActiveOfferStatus(OfferStatus.ISSUED))
  ok('ACCEPTED is active', isActiveOfferStatus(OfferStatus.ACCEPTED))
  ok('DECLINED is not active', !isActiveOfferStatus(OfferStatus.DECLINED))
  ok('WITHDRAWN is not active', !isActiveOfferStatus(OfferStatus.WITHDRAWN))
  ok('EXPIRED is not active', !isActiveOfferStatus(OfferStatus.EXPIRED))
  console.log('')

  // Allowed next
  console.log('[4] Allowed next statuses')
  ok('DRAFT → [PENDING_APPROVAL]',
    JSON.stringify(allowedNextStatuses(OfferStatus.DRAFT)) === JSON.stringify([OfferStatus.PENDING_APPROVAL]))
  ok('ACCEPTED → [] (terminal)',
    allowedNextStatuses(OfferStatus.ACCEPTED).length === 0)
  ok('ISSUED → [ACCEPTED, DECLINED, WITHDRAWN, EXPIRED]',
    allowedNextStatuses(OfferStatus.ISSUED).length === 4)

  console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
  if (fail > 0) process.exit(1)
}
main()
