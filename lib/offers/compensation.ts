/**
 * Sprint 19 — Offer compensation rules (audit P0-05, P1-20, P1-28, P2-11).
 *
 * FOUR small, pure rules that used to live nowhere:
 *
 *   1. SALARY VOCABULARY (P2-11). The database stores a `SalaryCurrency`
 *      enum and a free-text period. Clients did not agree with either:
 *      the Copilot accepted `salaryPeriod ∈ {HOUR, YEAR, MONTH, WEEK}`
 *      (the product uses `annual | monthly | hourly | weekly`) and
 *      currencies `BRL, MXN, SGD, HKD, NZD`, which are NOT members of the
 *      enum. The service cast the currency with `as never`, so Prisma
 *      threw an unhandled server error. Here the vocabulary is
 *      normalised and validated BEFORE the write, so an unknown value is
 *      a readable validation error instead of a 500.
 *
 *   2. COMPENSATION CONSISTENCY (P0-05). The approval control protects
 *      `offer.salaryAmount` — but the number the candidate reads lives in
 *      the letter. `setOfferDraftContent` accepted arbitrary client JSON
 *      and never compared the letter's money against the approved
 *      salary, so an APPROVED offer at $165k could be rewritten to
 *      "$250,000" through the letter body, with no re-approval and no
 *      audit event. `checkCompensationConsistent` refuses a letter whose
 *      money does not match the offer's own compensation fields.
 *
 *   3. SALARY BAND (P1-28). `HiringRequest.salaryMin` / `salaryMax` were
 *      never consulted anywhere in the offer flow: a recruiter could
 *      offer $500k against a $110k-$145k band and the approval step
 *      (which only checks WHO approves, never WHAT) would not catch it.
 *      `checkSalaryBand` compares the offer against the band.
 *
 *   4. HOLDS (P1-20). A candidate whose latest human decision is HOLD
 *      must not be offered. `describeDecisionHold` turns the decision
 *      into a message the recruiter can act on.
 *
 * Everything here is pure — no database, no `server-only` — so it can be
 * unit-tested and reused from the service, the Copilot and the UI.
 */

import { SalaryCurrency } from '@prisma/client'

// -----------------------------------------------------------------------------
// 1. Salary vocabulary
// -----------------------------------------------------------------------------

/** The salary periods the product uses. */
export const SALARY_PERIODS = ['annual', 'monthly', 'weekly', 'hourly'] as const
export type SalaryPeriod = (typeof SALARY_PERIODS)[number]

/**
 * Aliases accepted from clients, mapped onto the product's vocabulary.
 * The Copilot speaks `YEAR`; the product stores `annual`.
 */
const PERIOD_ALIASES: Record<string, SalaryPeriod> = {
  YEAR: 'annual',
  ANNUAL: 'annual',
  YEARLY: 'annual',
  MONTH: 'monthly',
  MONTHLY: 'monthly',
  WEEK: 'weekly',
  WEEKLY: 'weekly',
  HOUR: 'hourly',
  HOURLY: 'hourly',
}

/**
 * Normalises a client-supplied salary period onto the product's
 * vocabulary. Returns `null` for an unknown value — the caller must
 * refuse it rather than guess.
 */
export function normalizeSalaryPeriod(value: string | null | undefined): SalaryPeriod | null {
  if (!value) return null
  const key = String(value).trim().toUpperCase()
  return PERIOD_ALIASES[key] ?? null
}

/** The currencies the database can store. */
export const SUPPORTED_CURRENCIES: readonly string[] = Object.values(SalaryCurrency)

/**
 * Normalises a client-supplied currency onto the `SalaryCurrency` enum.
 *
 * Returns `null` for a currency the schema cannot store (BRL, MXN, …).
 * The caller must refuse it: silently rewriting it to `OTHER` would
 * make the letter say "BRL" while the column says "OTHER", which is
 * exactly the kind of compensation mismatch this module exists to stop.
 */
export function normalizeSalaryCurrency(
  value: string | null | undefined,
): SalaryCurrency | null {
  if (!value) return null
  const key = String(value).trim().toUpperCase()
  return (SUPPORTED_CURRENCIES as string[]).includes(key)
    ? (key as SalaryCurrency)
    : null
}

/** Human-readable message for an unsupported currency / period. */
export function unsupportedCurrencyMessage(value: string): string {
  return (
    `"${value}" is not a currency TalentOS can store. ` +
    `Supported currencies: ${SUPPORTED_CURRENCIES.join(', ')}.`
  )
}

export function unsupportedPeriodMessage(value: string): string {
  return (
    `"${value}" is not a salary period TalentOS understands. ` +
    `Supported periods: ${SALARY_PERIODS.join(', ')}.`
  )
}

// -----------------------------------------------------------------------------
// 2. Compensation consistency (P0-05)
// -----------------------------------------------------------------------------

export interface CompensationFacts {
  salaryAmount: number
  salaryCurrency: string
  bonusAmount?: number | null
  commissionAmount?: number | null
}

export interface CompensationCheck {
  ok: boolean
  /** Set when `ok` is false — says exactly what did not match. */
  message?: string
  /** The money amounts found in the letter. */
  found?: number[]
  /** The currency codes found in the letter. */
  currencies?: string[]
}

/**
 * Money in a letter: a currency symbol in front of the number, or a
 * number followed by an ISO currency code.
 *
 * Deliberately narrow. "30 days", "2026" and "0.05% equity" are NOT
 * money and must never be treated as a salary.
 */
const MONEY_RE =
  /([$€£¥₹])\s*(\d[\d,]*(?:\.\d+)?)|(\b\d[\d,]*(?:\.\d+)?)\s*([A-Z]{3})\b/g

/** ISO codes that are unambiguously money when they follow a number. */
const KNOWN_CODES = new Set([
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'INR', 'OTHER',
  'BRL', 'MXN', 'SGD', 'HKD', 'NZD', 'AED', 'EGP', 'SAR', 'ZAR',
])

/**
 * Extracts the money amounts and currency codes stated in a piece of
 * offer-letter text.
 */
export function extractMoney(text: string): { amounts: number[]; currencies: string[] } {
  const amounts: number[] = []
  const currencies: string[] = []
  if (!text) return { amounts, currencies }
  const re = new RegExp(MONEY_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const symbol = m[1]
    const symbolAmount = m[2]
    const codeAmount = m[3]
    const code = m[4]
    const raw = symbolAmount ?? codeAmount
    if (raw) {
      const value = Number(raw.replace(/,/g, ''))
      if (Number.isFinite(value)) amounts.push(value)
    }
    if (code && KNOWN_CODES.has(code)) currencies.push(code)
    // A bare symbol still tells us the currency family when the offer
    // currency is known; the symbol itself is not compared.
    void symbol
  }
  return { amounts, currencies }
}

/**
 * Checks the money stated in the offer letter against the offer's own
 * compensation fields.
 *
 * Rules:
 *   - every monetary amount in the text must equal the base salary, the
 *     bonus or the commission recorded on the offer;
 *   - an explicit ISO currency code must match the offer's currency.
 *
 * A letter that states no money at all is allowed — a recruiter may
 * write "Compensation as approved" and leave the number to the facts
 * panel.
 */
export function checkCompensationConsistent(
  facts: CompensationFacts,
  sections: Array<string | null | undefined>,
): CompensationCheck {
  const known = new Set<number>()
  if (Number.isFinite(facts.salaryAmount)) known.add(facts.salaryAmount)
  if (typeof facts.bonusAmount === 'number' && Number.isFinite(facts.bonusAmount)) {
    known.add(facts.bonusAmount)
  }
  if (typeof facts.commissionAmount === 'number' && Number.isFinite(facts.commissionAmount)) {
    known.add(facts.commissionAmount)
  }

  const amounts: number[] = []
  const currencies: string[] = []
  for (const section of sections) {
    if (!section) continue
    const found = extractMoney(section)
    amounts.push(...found.amounts)
    currencies.push(...found.currencies)
  }

  if (amounts.length === 0) return { ok: true, found: [], currencies: [] }

  const unknown = amounts.filter((a) => !known.has(a))
  if (unknown.length > 0) {
    const approved = [facts.salaryAmount, facts.bonusAmount, facts.commissionAmount]
      .filter((n): n is number => typeof n === 'number')
      .join(', ')
    return {
      ok: false,
      found: amounts,
      currencies,
      message:
        `The letter states a compensation amount (${unknown.join(', ')}) that does not match ` +
        `the approved offer terms (${approved} ${facts.salaryCurrency}). ` +
        'Update the offer terms first, or fix the letter — an approved offer cannot be ' +
        're-written through its letter body.',
    }
  }

  const offerCurrency = String(facts.salaryCurrency || '').toUpperCase()
  if (offerCurrency && offerCurrency !== 'OTHER') {
    const wrongCode = currencies.find((c) => c !== offerCurrency && c !== 'OTHER')
    if (wrongCode) {
      return {
        ok: false,
        found: amounts,
        currencies,
        message:
          `The letter states the compensation in ${wrongCode} but the offer is denominated in ` +
          `${offerCurrency}. Fix the letter or the offer terms before saving.`,
      }
    }
  }

  return { ok: true, found: amounts, currencies }
}

// -----------------------------------------------------------------------------
// 3. Salary band (P1-28)
// -----------------------------------------------------------------------------

export interface SalaryBand {
  min: number | null
  max: number | null
  currency: string | null
}

export interface SalaryBandCheck {
  ok: boolean
  /** Set when the offer is outside the band. */
  message?: string
  /** True when the comparison could not be made (different currency/period). */
  notComparable?: boolean
}

/**
 * Compares an offer's salary against the requisition's published band.
 *
 * The comparison is only made when the currency matches and the offer is
 * an annual salary — comparing an hourly rate against an annual band
 * would produce a confident, wrong answer.
 */
export function checkSalaryBand(
  salaryAmount: number,
  salaryCurrency: string,
  salaryPeriod: string,
  band: SalaryBand,
): SalaryBandCheck {
  if (band.min == null && band.max == null) return { ok: true }
  if (!band.currency || String(band.currency).toUpperCase() !== String(salaryCurrency).toUpperCase()) {
    return { ok: true, notComparable: true }
  }
  if (String(salaryPeriod).toLowerCase() !== 'annual') {
    return { ok: true, notComparable: true }
  }
  const low = band.min ?? Number.NEGATIVE_INFINITY
  const high = band.max ?? Number.POSITIVE_INFINITY
  if (salaryAmount >= low && salaryAmount <= high) return { ok: true }

  const range =
    band.min != null && band.max != null
      ? `${band.min.toLocaleString('en-US')} - ${band.max.toLocaleString('en-US')}`
      : band.min != null
        ? `at least ${band.min.toLocaleString('en-US')}`
        : `at most ${band.max!.toLocaleString('en-US')}`
  return {
    ok: false,
    message:
      `The offered salary (${salaryAmount.toLocaleString('en-US')} ${salaryCurrency}) is outside ` +
      `the published band for this requisition (${range} ${band.currency}).`,
  }
}

// -----------------------------------------------------------------------------
// 4. Holds (P1-20)
// -----------------------------------------------------------------------------

/**
 * Describes why an offer may not be created for a candidate whose latest
 * human decision is a HOLD. Returns `null` when the decision does not
 * block the offer.
 */
export function describeDecisionHold(decision: string | null | undefined): string | null {
  if (!decision) return null
  const value = String(decision).toUpperCase()
  if (value === 'HOLD') {
    return 'This candidate is on hold — a HOLD decision blocks any new offer until it is lifted.'
  }
  if (value === 'ADVANCE') {
    return 'This candidate is only ADVANCED, not SELECTED — a final SELECTED decision is required before an offer.'
  }
  return null
}
