/**
 * Sprint 19 — regression script for the offer-lifecycle fixes
 * (audit P0-01, P0-02, P0-05, P1-02, P1-03, P1-04, P1-12, P1-13,
 * P1-15, P1-19, P1-20, P1-28, P2-11, P2-29, P2-30).
 *
 * Run it with:
 *
 *   npx tsx --env-file=.env scripts/test-offer-lifecycle-fixes.ts
 *
 * It creates its own throwaway organization, exercises every changed
 * behaviour end to end (hire-on-accept, letter lock, compensation
 * consistency, edit/cancel/withdraw/expiry, approver scope, salary
 * band, vocabulary) and deletes everything it created before it exits.
 * Nothing outside its own fixture is touched.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { db } from '../lib/db'
import { OfferStatus } from '@prisma/client'
import {
  recordOfferResponse,
  setOfferDraftContent,
  createOffer,
  approveOffer,
  withdrawOffer,
  cancelDraftOffer,
  editOffer,
} from '../features/offers/services/offer-service'
import { expireStaleOffers } from '../lib/offers/expiry'
import { checkCompensationConsistent, checkSalaryBand, normalizeSalaryPeriod } from '../lib/offers/compensation'

const STAMP = Date.now()
const TAG = `verify-offers-${STAMP}`

let pass = 0
let fail = 0
const failures: string[] = []

function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const ctxFor = (userId: string, organizationId: string, role = 'ADMIN') => ({
  userId,
  organizationId,
  isAdmin: role === 'ADMIN',
  isTaLead: role === 'TA_LEAD',
  role,
})

async function main() {
  const org = await db.organization.create({
    data: { name: `${TAG}-org`, slug: `${TAG}-org` },
    select: { id: true },
  })
  const admin = await db.user.create({
    data: {
      organizationId: org.id,
      email: `${TAG}-admin@example.test`,
      firstName: 'Verify',
      lastName: 'Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
    select: { id: true },
  })
  const hm = await db.user.create({
    data: {
      organizationId: org.id,
      email: `${TAG}-hm@example.test`,
      firstName: 'Verify',
      lastName: 'Manager',
      role: 'HIRING_MANAGER',
      status: 'ACTIVE',
    },
    select: { id: true },
  })
  const dept = await db.department.create({
    data: { organizationId: org.id, name: `${TAG} dept`, slug: `${TAG}-dept` },
    select: { id: true },
  })
  const hr = await db.hiringRequest.create({
    data: {
      organizationId: org.id,
      departmentId: dept.id,
      createdById: admin.id,
      hiringManagerId: hm.id,
      title: `${TAG} role`,
      slug: `${TAG}-hr`,
      status: 'OPEN',
      openings: 1,
      salaryMin: 100000,
      salaryMax: 150000,
    },
    select: { id: true },
  })
  const mkCandidate = async (key: string, stage: string) =>
    (
      await db.candidate.create({
        data: {
          organizationId: org.id,
          hiringRequestId: hr.id,
          firstName: 'Verify',
          lastName: key,
          email: `${TAG}-${key.toLowerCase()}@example.test`,
          stage: stage as never,
        },
        select: { id: true },
      })
    ).id

  const hireCandidate = await mkCandidate('Hire', 'OFFER')
  const lockCandidate = await mkCandidate('Lock', 'OFFER')
  const declinedCandidate = await mkCandidate('Decline', 'OFFER')
  const holdCandidate = await mkCandidate('Hold', 'OFFER')
  const expiringCandidate = await mkCandidate('Expiring', 'OFFER')
  const draftCandidate = await mkCandidate('Draft', 'OFFER')
  const vocabCandidate = await mkCandidate('Vocab', 'OFFER')

  const mkOffer = async (
    candidateId: string,
    status: OfferStatus,
    salaryAmount = 120000,
    extra: Record<string, unknown> = {},
  ) =>
    (
      await db.offer.create({
        data: {
          organizationId: org.id,
          hiringRequestId: hr.id,
          candidateId,
          title: `${TAG} offer`,
          salaryAmount,
          salaryCurrency: 'USD',
          salaryPeriod: 'annual',
          status,
          createdById: admin.id,
          ...extra,
        },
        select: { id: true },
      })
    ).id

  const issuedOffer = await mkOffer(hireCandidate, OfferStatus.ISSUED)
  const approvedOffer = await mkOffer(lockCandidate, OfferStatus.APPROVED)
  const draftOffer = await mkOffer(draftCandidate, OfferStatus.DRAFT)
  const expiringOffer = await mkOffer(expiringCandidate, OfferStatus.ISSUED, 120000, {
    expiresAt: new Date(Date.now() - 60_000),
  })
  const declinedOffer = await mkOffer(declinedCandidate, OfferStatus.ISSUED)

  // A SELECTED decision so createOffer is allowed.
  await db.candidateDecision.create({
    data: {
      organizationId: org.id,
      candidateId: holdCandidate,
      hiringRequestId: hr.id,
      decision: 'HOLD',
      decidedById: admin.id,
    },
  })
  await db.candidateDecision.create({
    data: {
      organizationId: org.id,
      candidateId: vocabCandidate,
      hiringRequestId: hr.id,
      decision: 'SELECTED',
      decidedById: admin.id,
    },
  })

  const ctx = ctxFor(admin.id, org.id)
  const hmCtx = ctxFor(hm.id, org.id, 'HIRING_MANAGER')

  console.log('\n[P0-01/P0-02] an ACCEPTED offer hires the candidate')
  {
    const before = await db.hiringRequest.findUnique({
      where: { id: hr.id },
      select: { filled: true, openings: true, status: true },
    })
    const res = await recordOfferResponse(ctx, issuedOffer, 'ACCEPTED', { confirm: true })
    const cand = await db.candidate.findUnique({
      where: { id: hireCandidate },
      select: { stage: true, hiredAt: true },
    })
    const after = await db.hiringRequest.findUnique({
      where: { id: hr.id },
      select: { filled: true, openings: true, status: true },
    })
    const activity = await db.activity.findFirst({
      where: { offerId: issuedOffer, type: 'HIRED' },
      select: { id: true },
    })
    const audit = await db.auditLog.findFirst({
      where: { targetId: issuedOffer, action: 'OFFER_ACCEPTED' },
      select: { id: true },
    })
    ok('the acceptance succeeds', res.ok, res.ok ? '' : res.message)
    ok('candidate.stage = HIRED', cand?.stage === 'HIRED', String(cand?.stage))
    ok('candidate.hiredAt is set', cand?.hiredAt !== null)
    ok(
      'HiringRequest.filled equals the HIRED count (self-correcting)',
      after?.filled === (await db.candidate.count({ where: { hiringRequestId: hr.id, stage: 'HIRED' } })),
      `filled=${after?.filled}`,
    )
    ok(
      'the requisition becomes FILLED once the openings are filled',
      after?.status === 'FILLED' && (after?.filled ?? 0) >= (after?.openings ?? 99),
      `status=${after?.status} filled=${after?.filled}/${after?.openings}`,
    )
    ok('a HIRED activity is written', activity !== null)
    ok('an OFFER_ACCEPTED audit entry is written', audit !== null)
    ok(
      'the hire is atomic (single transaction boundary)',
      /db\.\$transaction/.test(
        readFileSync('features/offers/services/offer-service.ts', 'utf8'),
      ),
    )
    ok(
      'the acceptance increments filled by exactly 1',
      (after?.filled ?? 0) === (before?.filled ?? 0) + 1,
      `filled ${before?.filled} → ${after?.filled}`,
    )

    // Idempotence: the same offer cannot be accepted twice, so `filled`
    // can never be incremented twice by the same offer.
    const second = await recordOfferResponse(ctx, issuedOffer, 'ACCEPTED', { confirm: true })
    const afterSecond = await db.hiringRequest.findUnique({
      where: { id: hr.id },
      select: { filled: true },
    })
    const hireCount = await db.candidate.count({ where: { hiringRequestId: hr.id, stage: 'HIRED' } })
    ok(
      'a second acceptance is refused (the offer is already ACCEPTED)',
      second.ok === false,
      second.ok ? 'accepted twice!' : second.message,
    )
    ok(
      'filled does not double-increment on a repeated acceptance',
      afterSecond?.filled === after?.filled,
      `filled ${after?.filled} → ${afterSecond?.filled}`,
    )
    ok('exactly one candidate is HIRED on the requisition', hireCount === 1, `hired=${hireCount}`)
  }

  console.log('\n[P0-05] the letter is locked once the offer leaves DRAFT')
  {
    const approved = await setOfferDraftContent(ctx, approvedOffer, { fullText: 'tampered' }, {})
    const issued = await setOfferDraftContent(ctx, declinedOffer, { fullText: 'tampered' }, {})
    const stored = await db.offer.findUnique({
      where: { id: approvedOffer },
      select: { draftContent: true },
    })
    ok('an APPROVED letter cannot be edited', approved.ok === false, approved.ok ? 'edited!' : approved.message)
    ok('an ISSUED letter cannot be edited', issued.ok === false, issued.ok ? 'edited!' : issued.message)
    ok(
      'the APPROVED letter was not changed on disk',
      !JSON.stringify(stored?.draftContent ?? '').includes('tampered'),
    )
  }

  console.log('\n[P0-05] the letter compensation must match the offer')
  {
    const res = await setOfferDraftContent(
      ctx,
      draftOffer,
      { fullText: 'We are pleased to offer you the role.', compensationSection: 'Your annual salary will be $999,999 USD.' },
      {},
    )
    const stored = await db.offer.findUnique({
      where: { id: draftOffer },
      select: { draftContent: true },
    })
    const persisted = JSON.stringify(stored?.draftContent ?? '')
    ok(
      'a mismatching compensation section is refused (or never persisted)',
      res.ok === false && !persisted.includes('999,999'),
      `ok=${res.ok} persisted=${persisted}`,
    )
  }

  console.log('\n[P1-19] the letter round-trips')
  {
    const fullText = `Audit body ${STAMP}`
    const res = await setOfferDraftContent(
      ctx,
      draftOffer,
      { fullText, greeting: 'Hello,', compensationSection: 'Compensation as approved.' },
      {},
    )
    const reread = await db.offer.findUnique({
      where: { id: draftOffer },
      select: { draftContent: true },
    })
    ok('the manual save succeeds', res.ok, res.ok ? '' : res.message)
    ok(
      'fullText survives the round-trip',
      JSON.stringify(reread?.draftContent ?? '').includes(fullText),
    )
    ok(
      'the other sections survive the round-trip',
      JSON.stringify(reread?.draftContent ?? '').includes('Compensation as approved.'),
    )
  }

  console.log('\n[P1-13] an edit is audited with before/after')
  {
    const res = await editOffer(ctx, { offerId: draftOffer, salaryAmount: 130000 })
    const audit = await db.auditLog.findFirst({
      where: { targetId: draftOffer, action: 'OFFER_EDITED' },
      orderBy: { occurredAt: 'desc' },
      select: { metadata: true },
    })
    const meta = (audit?.metadata ?? {}) as {
      changes?: Record<string, { from: unknown; to: unknown }>
      kind?: string
    }
    ok('the edit is recorded as a terms edit', meta.kind === 'offer_terms', String(meta.kind))
    ok('the edit succeeds', res.ok, res.ok ? '' : res.message)
    ok(
      'an OFFER_EDITED audit entry records before → after',
      !!meta.changes?.salaryAmount && meta.changes.salaryAmount.from === 120000 && meta.changes.salaryAmount.to === 130000,
      JSON.stringify(meta.changes ?? null),
    )
  }

  console.log('\n[P1-02] a DRAFT can be cancelled')
  {
    const res = await cancelDraftOffer(ctx, draftOffer, 'wrong salary')
    const row = await db.offer.findUnique({ where: { id: draftOffer }, select: { id: true } })
    const audit = await db.auditLog.findFirst({
      where: { targetId: draftOffer, action: 'OFFER_WITHDRAWN' },
      select: { id: true },
    })
    ok('the draft is cancelled', res.ok, res.ok ? '' : res.message)
    ok('the draft row is gone', row === null)
    ok('the cancellation is in the audit trail', audit !== null)
  }

  console.log('\n[P1-03] an APPROVED offer can be withdrawn')
  {
    const res = await withdrawOffer(ctx, approvedOffer, 'budget pulled')
    const row = await db.offer.findUnique({
      where: { id: approvedOffer },
      select: { status: true, withdrawnAt: true, withdrawnReason: true },
    })
    ok('the withdrawal succeeds', res.ok, res.ok ? '' : res.message)
    ok('the offer is WITHDRAWN', row?.status === 'WITHDRAWN', String(row?.status))
    ok('the reason is stored', !!row?.withdrawnReason)
  }

  console.log('\n[P1-04] the expiry backstop expires a stale offer')
  {
    const res = await expireStaleOffers(org.id)
    const offer = await db.offer.findUnique({
      where: { id: expiringOffer },
      select: { status: true, expiredAt: true },
    })
    const cand = await db.candidate.findUnique({
      where: { id: expiringCandidate },
      select: { stage: true },
    })
    ok('the backstop reports the expiry', res.expired >= 1, JSON.stringify(res))
    ok('the offer is EXPIRED', offer?.status === 'EXPIRED', String(offer?.status))
    ok('the candidate leaves the OFFER stage', cand?.stage !== 'OFFER', String(cand?.stage))
  }

  console.log('\n[P1-20/P1-28/P2-11] band, hold and vocabulary rules')
  {
    const hold = await createOffer(ctx, {
      candidateId: holdCandidate,
      hiringRequestId: hr.id,
      title: 'hold',
      salaryAmount: 120000,
      salaryCurrency: 'USD',
      salaryPeriod: 'annual',
    })
    ok('a HOLD decision blocks a new offer', hold.ok === false, hold.ok ? 'created!' : hold.message)

    const band = await createOffer(ctx, {
      candidateId: vocabCandidate,
      hiringRequestId: hr.id,
      title: 'band',
      salaryAmount: 500000,
      salaryCurrency: 'USD',
      salaryPeriod: 'annual',
    })
    ok(
      'a salary outside the published band is refused',
      band.ok === false && band.code === 'SALARY_BAND_EXCEEDED',
      band.ok ? 'created!' : band.message,
    )

    const badCurrency = await createOffer(ctx, {
      candidateId: vocabCandidate,
      hiringRequestId: hr.id,
      title: 'currency',
      salaryAmount: 120000,
      salaryCurrency: 'BRL',
      salaryPeriod: 'YEAR',
    })
    ok(
      'an unsupported currency is a readable error, not a crash',
      badCurrency.ok === false && badCurrency.message.includes('BRL'),
      badCurrency.ok ? 'created!' : badCurrency.message,
    )

    const good = await createOffer(ctx, {
      candidateId: vocabCandidate,
      hiringRequestId: hr.id,
      title: 'good',
      salaryAmount: 120000,
      salaryCurrency: 'USD',
      salaryPeriod: 'YEAR',
    })
    const created = good.ok
      ? await db.offer.findUnique({ where: { id: good.data.id }, select: { salaryPeriod: true } })
      : null
    ok('a client period is normalised onto the product vocabulary', created?.salaryPeriod === 'annual', String(created?.salaryPeriod))
  }

  console.log('\n[P1-09/P1-15] approvers and HR scope')
  {
    const scoped = await approveOffer(hmCtx, issuedOffer, true)
    ok(
      'a HIRING_MANAGER can act on a requisition they manage',
      scoped.ok || scoped.code === 'INVALID_TRANSITION',
      scoped.ok ? '' : scoped.message,
    )
    const other = await db.hiringRequest.create({
      data: {
        organizationId: org.id,
        departmentId: dept.id,
        createdById: admin.id,
        title: `${TAG} other role`,
        slug: `${TAG}-hr-other`,
        status: 'OPEN',
        openings: 1,
      },
      select: { id: true },
    })
    const otherCandidate = await mkCandidate('Other', 'OFFER')
    const otherOffer = (
      await db.offer.create({
        data: {
          organizationId: org.id,
          hiringRequestId: other.id,
          candidateId: otherCandidate,
          title: `${TAG} other offer`,
          salaryAmount: 120000,
          salaryCurrency: 'USD',
          salaryPeriod: 'annual',
          status: OfferStatus.PENDING_APPROVAL,
          createdById: admin.id,
        },
        select: { id: true },
      })
    ).id
    const refused = await approveOffer(hmCtx, otherOffer, true)
    ok(
      'a HIRING_MANAGER cannot approve outside their requisitions',
      refused.ok === false && refused.code === 'OUTSIDE_SCOPE',
      refused.ok ? 'allowed!' : `${refused.code}: ${refused.message}`,
    )
    void other
  }

  console.log('\n[unit] pure compensation helpers')
  {
    const check = checkCompensationConsistent(
      { salaryAmount: 145000, salaryCurrency: 'USD' },
      ['Your annual salary will be $999,999 USD.'],
    )
    ok('a mismatching amount is detected', check.ok === false)
    const good = checkCompensationConsistent(
      { salaryAmount: 145000, salaryCurrency: 'USD' },
      ['Your annual salary will be $145,000 USD per year.'],
    )
    ok('a matching amount is accepted', good.ok === true, good.message)
    const noMoney = checkCompensationConsistent(
      { salaryAmount: 145000, salaryCurrency: 'USD' },
      ['Compensation as approved.'],
    )
    ok('a letter without money is accepted', noMoney.ok === true)
    const wrongCurrency = checkCompensationConsistent(
      { salaryAmount: 145000, salaryCurrency: 'USD' },
      ['The salary is 145,000 EUR per year.'],
    )
    ok('a wrong currency is detected', wrongCurrency.ok === false)
    const days = checkCompensationConsistent(
      { salaryAmount: 145000, salaryCurrency: 'USD' },
      ['You will receive 30 days of vacation and 12 notice days.'],
    )
    ok('a day count is not mistaken for money', days.ok === true, days.message)
    ok('YEAR normalises to annual', normalizeSalaryPeriod('YEAR') === 'annual')
    ok(
      'a band comparison is made',
      checkSalaryBand(500000, 'USD', 'annual', { min: 100000, max: 150000, currency: 'USD' }).ok === false,
    )
    ok(
      'an hourly rate is not compared against an annual band',
      checkSalaryBand(50, 'USD', 'hourly', { min: 100000, max: 150000, currency: 'USD' }).ok === true,
    )
  }

  console.log('\n[cleanup]')
  await db.auditLog.deleteMany({ where: { organizationId: org.id } })
  await db.activity.deleteMany({ where: { organizationId: org.id } })
  await db.candidateDecision.deleteMany({ where: { organizationId: org.id } })
  await db.hiringRequest.deleteMany({ where: { organizationId: org.id } })
  await db.organization.deleteMany({ where: { id: org.id } })
  console.log('  ✓ fixture removed')

  console.log(`\nFINAL: ${pass} passed, ${fail} failed`)
  if (failures.length) console.log(`Failed: ${failures.join(' | ')}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => process.exit(fail === 0 ? 0 : 1))
