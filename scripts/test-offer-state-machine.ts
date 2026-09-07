/**
 * Sprint 10 — Offer state machine unit tests.
 *
 * Tests every documented transition (valid + invalid). Pure, no DB.
 * Run: ./node_modules/.bin/tsx scripts/test-offer-state-machine.ts
 */

import {
  validateTransition,
  allowedNextStatuses,
  isTerminalStatus,
  isActiveOfferStatus,
} from '../lib/offers/state-machine'
import { OfferStatus } from '@prisma/client'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', name); pass++ }
  else { console.log('  ✗', name, detail ?? ''); fail++ }
}

console.log('A. Valid transitions')

const valid: Array<[OfferStatus, OfferStatus]> = [
  [OfferStatus.DRAFT, OfferStatus.PENDING_APPROVAL],
  [OfferStatus.PENDING_APPROVAL, OfferStatus.APPROVED],
  [OfferStatus.PENDING_APPROVAL, OfferStatus.DRAFT],
  [OfferStatus.APPROVED, OfferStatus.ISSUED],
  [OfferStatus.ISSUED, OfferStatus.ACCEPTED],
  [OfferStatus.ISSUED, OfferStatus.DECLINED],
  [OfferStatus.ISSUED, OfferStatus.WITHDRAWN],
  [OfferStatus.ISSUED, OfferStatus.EXPIRED],
]
for (const [from, to] of valid) {
  const r = validateTransition(from, to)
  check(`${from} → ${to} succeeds`, r.ok)
  if (r.ok) check(`${from} → ${to} next status = ${to}`, r.nextStatus === to)
}

console.log('\nB. Invalid transitions')

const invalid: Array<[OfferStatus, OfferStatus, string]> = [
  [OfferStatus.DRAFT, OfferStatus.ACCEPTED, 'must fail (no approval or issuance)'],
  [OfferStatus.ACCEPTED, OfferStatus.DRAFT, 'must fail (terminal)'],
  [OfferStatus.DECLINED, OfferStatus.APPROVED, 'must fail (terminal)'],
  [OfferStatus.DECLINED, OfferStatus.ACCEPTED, 'must fail (terminal)'],
  [OfferStatus.WITHDRAWN, OfferStatus.ISSUED, 'must fail (terminal)'],
  [OfferStatus.EXPIRED, OfferStatus.DRAFT, 'must fail (terminal)'],
  [OfferStatus.DRAFT, OfferStatus.APPROVED, 'must fail (must go through PENDING_APPROVAL)'],
  [OfferStatus.DRAFT, OfferStatus.ISSUED, 'must fail (must go through APPROVAL + ISSUED)'],
  [OfferStatus.PENDING_APPROVAL, OfferStatus.ISSUED, 'must fail (must be APPROVED first)'],
  [OfferStatus.PENDING_APPROVAL, OfferStatus.ACCEPTED, 'must fail'],
  [OfferStatus.APPROVED, OfferStatus.ACCEPTED, 'must fail (must be ISSUED first)'],
  [OfferStatus.APPROVED, OfferStatus.DRAFT, 'must fail (can only be ISSUED)'],
  [OfferStatus.ISSUED, OfferStatus.APPROVED, 'must fail (must be ISSUED → response)'],
  [OfferStatus.ISSUED, OfferStatus.PENDING_APPROVAL, 'must fail (no return path from ISSUED)'],
  [OfferStatus.ACCEPTED, OfferStatus.WITHDRAWN, 'must fail (terminal)'],
  [OfferStatus.DRAFT, OfferStatus.DRAFT, 'must fail (no self-transition)'],
  [OfferStatus.ACCEPTED, OfferStatus.ACCEPTED, 'must fail (no self-transition)'],
]
for (const [from, to, reason] of invalid) {
  const r = validateTransition(from, to)
  check(`${from} → ${to} ${reason}`, !r.ok)
  if (!r.ok) check(`${from} → ${to} code = INVALID_TRANSITION`, r.code === 'INVALID_TRANSITION')
}

console.log('\nC. Helper functions')

check('allowedNextStatuses(DRAFT) = [PENDING_APPROVAL]',
  allowedNextStatuses(OfferStatus.DRAFT).length === 1 &&
  allowedNextStatuses(OfferStatus.DRAFT)[0] === OfferStatus.PENDING_APPROVAL)
check('allowedNextStatuses(PENDING_APPROVAL) contains APPROVED and DRAFT',
  allowedNextStatuses(OfferStatus.PENDING_APPROVAL).length === 2)
check('allowedNextStatuses(APPROVED) = [ISSUED]',
  allowedNextStatuses(OfferStatus.APPROVED).length === 1 &&
  allowedNextStatuses(OfferStatus.APPROVED)[0] === OfferStatus.ISSUED)
check('isTerminalStatus(ACCEPTED)', isTerminalStatus(OfferStatus.ACCEPTED))
check('isTerminalStatus(DECLINED)', isTerminalStatus(OfferStatus.DECLINED))
check('isTerminalStatus(WITHDRAWN)', isTerminalStatus(OfferStatus.WITHDRAWN))
check('isTerminalStatus(EXPIRED)', isTerminalStatus(OfferStatus.EXPIRED))
check('!isTerminalStatus(DRAFT)', !isTerminalStatus(OfferStatus.DRAFT))
check('!isTerminalStatus(PENDING_APPROVAL)', !isTerminalStatus(OfferStatus.PENDING_APPROVAL))
check('!isTerminalStatus(APPROVED)', !isTerminalStatus(OfferStatus.APPROVED))
check('!isTerminalStatus(ISSUED)', !isTerminalStatus(OfferStatus.ISSUED))

console.log('\nD. Active-status guard (PART 31)')

check('isActiveOfferStatus(DRAFT)', isActiveOfferStatus(OfferStatus.DRAFT))
check('isActiveOfferStatus(PENDING_APPROVAL)', isActiveOfferStatus(OfferStatus.PENDING_APPROVAL))
check('isActiveOfferStatus(APPROVED)', isActiveOfferStatus(OfferStatus.APPROVED))
check('isActiveOfferStatus(ISSUED)', isActiveOfferStatus(OfferStatus.ISSUED))
check('isActiveOfferStatus(ACCEPTED) [PART 31: must block]', isActiveOfferStatus(OfferStatus.ACCEPTED))
check('!isActiveOfferStatus(DECLINED)', !isActiveOfferStatus(OfferStatus.DECLINED))
check('!isActiveOfferStatus(WITHDRAWN)', !isActiveOfferStatus(OfferStatus.WITHDRAWN))
check('!isActiveOfferStatus(EXPIRED)', !isActiveOfferStatus(OfferStatus.EXPIRED))

console.log('\nE. Backward-compat with legacy SENT/UNDER_REVIEW')

check('SENT → ACCEPTED allowed (legacy path)', validateTransition(OfferStatus.SENT, OfferStatus.ACCEPTED).ok)
check('SENT → DECLINED allowed (legacy path)', validateTransition(OfferStatus.SENT, OfferStatus.DECLINED).ok)
check('UNDER_REVIEW → ACCEPTED allowed (legacy path)', validateTransition(OfferStatus.UNDER_REVIEW, OfferStatus.ACCEPTED).ok)
check('SENT → PENDING_APPROVAL must fail (legacy does not enter new flow)',
  !validateTransition(OfferStatus.SENT, OfferStatus.PENDING_APPROVAL).ok)

console.log(`\n=== ${pass} passed, ${fail} failed ===`)
process.exit(fail > 0 ? 1 : 0)
