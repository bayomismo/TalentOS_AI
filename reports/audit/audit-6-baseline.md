# audit-6 — Business-flow regression gate · BASELINE (before the fixes)

**Run:** 2026-11-10 15:06 · audit6-1794323115211
**Command:** `npx tsx --env-file=.env scripts/audit-6-business-flow.ts`
**Raw log:** `.audit6-run.log` (repo root)
**Result: 8 passed, 48 failed** — this is the *before* picture, captured against the live
database **before** any of the business-flow fixes were applied.

The suite asserts BUSINESS OUTCOMES (what the database ends up containing), not that a function
returns `ok`. It is the gate every sibling fix track is measured against.

---

## Why so many failures (read this before judging them)

Two categories of failure, and they are very different:

### 1. Real, reproduced defects — the audit findings, confirmed live (39 assertions)

These are the audit's P0/P1 findings re-proven against production data. Several carry numbers
that make them undeniable:

| Assertion | Live evidence | Audit finding |
|---|---|---|
| A01 | `moveCandidateStageAction` accepted `APPLIED → HIRED` (illegal skip) and wrote the stage | **P0-09** |
| A02 | `HIRED → APPLIED` resurrection succeeded and overwrote the stage | **P0-09** |
| A04 | bulk move set `stage=HIRED` but `hiredAt=null` | **P2-05** |
| A29 | `draftContent` is projected **outside** the `canComp` gate (index 2292 < guard 2493) | **P1-01** |
| A33 | public apply attached to a **DRAFT** requisition, and to the wrong one of two | **P1-11 / P2-31** |
| A36 | rate limit uses a server-derived IP **and still prefers** the client header | **P2-08** |
| A37 | the `/onboarding/done` completion path **never looks at `onboardingStep`** | **P0-08** |
| A38 | a caller still discards the transition result with `.catch(() => null)` | **P1-21** |
| A39 | `onboardingStatus=COMPLETED` with `country=null timezone=null industry=null` | **P1-21** |
| A40 | accept-invite **threw** `account_already_active` instead of returning an error | **P1-22** |
| A41 | an expired invitation was listed with `status=PENDING` | **P2-24** |
| A42 | no mailbox ownership verification and no documented limitation | **P1-24** |
| A43 | a metric `change` value is still a hardcoded literal | **P2-02** |
| A44 | the "Avg. Time to Hire" value is still a hardcoded number of days | **P2-02** |
| A45 | analytics hire count reported `NaN` against **4** actual HIRED candidates | **P0-01** |
| A46 | `HiringRequest.filled = 0` against **4** actual HIRED candidates | **P0-02** |
| A47 | funnel sum **38** for **18** candidates (double-counted cumulative stages) | **P2-14** |
| A48 | `rejected=applied withdrawn=applied applied=applied` | **P2-01** |
| A53 | **no** candidate UI component references `parsedText` | **P0-04** |
| A55 | bare `catch {}` in `app/(public)/jobs/[slug]/apply-action.ts` | **P0-03** |
| A56 | `startInterviewAction` returned `ok=true` for a **cross-tenant** interview | **P1-05** |

### 2. Blocked by the not-yet-applied migration (9 assertions)

The suite printed this warning at startup:

> ⚠ SCHEMA DRIFT: the database is behind the generated Prisma client — missing
> `CandidateDecision.supersedesId`, `Offer.supersededAt`, `Application` (table). Assertions that
> touch those columns will fail with a database error until the migration is applied.

Affected: **A21–A30** (offer lifecycle / hire-on-accept — they read `Offer.supersededAt` and the
`Application` table), plus **A34** (public apply creates an `Application` row) and **A52** (email
outbox records a delivery status — `EmailOutbox.provider` does not exist yet).

These are **expected to pass once the integration gate applies**
`prisma/migrations/20261110000000_audit_business_flow_fixes/migration.sql`. They are counted as
failures in this baseline only because the migration has not been deployed yet — not because the
behaviour is wrong.

**The integration gate must apply the migration BEFORE the final `audit-6` run**, or the offer
track (P0-01, P0-02, P0-05) cannot be verified.

---

## Full baseline table

| ID | Assertion | Baseline |
|---|---|---|
| A01 | `moveCandidateStageAction` rejects APPLIED → HIRED | ✗ |
| A02 | `moveCandidateStageAction` rejects HIRED → APPLIED | ✗ |
| A03 | `moveCandidateStageAction` to HIRED sets stage + `hiredAt` | ✓ |
| A04 | bulk move sets the same lifecycle timestamps | ✗ |
| A05 | `recordDecisionAction` on a terminal candidate returns an error | ✗ (`code=INTERNAL`) |
| A06 | `recordDecisionAction` SELECTED moves the stage to OFFER | ✗ |
| A07 | `recordDecisionAction` REJECT moves to REJECTED + `rejectedAt` | ✗ |
| A08 | HOLD / ADVANCE leave an observable state | ✗ |
| A09 | Decision Hub marks terminal candidates NOT selectable | ✗ |
| A10 | Decision Hub still lists every candidate | ✗ (missing 14) |
| A11 | a refused decision writes no decision row and no activity | ✗ |
| A12 | a SELECTED decision is persisted as a `CandidateDecision` row | ✗ |
| A13 | the timeline records a CANDIDATE_SELECTED activity | ✗ |
| A14 | an unanalysed candidate reads "not analysed", not score 0 | ✗ |
| A15 | — | ✗ (earlier step threw) |
| A16 | a decision never points at itself as its own previous decision | ✗ |
| A17 | the Decision Hub's total count matches what it lists | ✗ |
| A18 | a SELECTED candidate is eligible to receive an offer | ✗ (`NO_HUMAN_DECISION`) |
| A19 | a decision for a candidate in another org is refused | ✓ |
| A20 | the Decision Hub only lists the requested hiring request's candidates | ✗ |
| A21–A28 | offer lifecycle / hire-on-accept | ✗ (migration pending) |
| A29 | `getOfferDetailAction` does NOT return `draftContent` without comp permission | ✗ |
| A30 | the offer letter is readable back after a reload | ✗ (migration pending) |
| A31 | public apply does NOT change an existing terminal candidate's stage | ✓ |
| A32 | public apply does NOT overwrite an existing candidate's identity fields | ✓ |
| A33 | public apply attaches to a deterministically-chosen requisition | ✗ |
| A34 | public apply creates an `Application` row with `consentAt` | ✗ (migration pending) |
| A35 | public apply rejects when the bound requisition is closed or filled | ✗ |
| A36 | rate limit keyed on a server-derived IP | ✗ |
| A37 | `/onboarding/done` does NOT complete onboarding from an incomplete step | ✗ |
| A38 | an onboarding step transition failure is surfaced, not swallowed | ✗ |
| A39 | an org cannot be fully onboarded with no company configuration | ✗ |
| A40 | accept-invite returns an error, not a crash | ✗ |
| A41 | the invitation list does not show expired invitations as active | ✗ |
| A42 | invitation acceptance verifies mailbox ownership (or documents the limit) | ✗ |
| A43 | the dashboard contains NO hardcoded change/trend values | ✗ |
| A44 | the dashboard has no hardcoded "Avg. Time to Hire" | ✗ |
| A45 | the analytics hire count matches actual HIRED candidates | ✗ (`NaN` vs 4) |
| A46 | the hiring-request `filled` value equals actual HIRED candidates | ✗ (0 vs 4) |
| A47 | funnel denominators do not double-count | ✗ (38 vs 18) |
| A48 | the candidate list renders REJECTED/WITHDRAWN distinctly | ✗ |
| A49 | a rejected candidate is not shown with an "applied" badge | ✓ |
| A50 | the reports page contains no mock data where real data exists | ✓ |
| A51 | `isEmailDeliveryConfigured()` reports the configured state | ✓ |
| A52 | an email send records a delivery status visible to an admin | ✗ (migration pending) |
| A53 | the CV parsed text IS rendered on the candidate profile | ✗ |
| A54 | CV file bytes are not silently discarded without a visible signal | ✓ |
| A55 | no email send site swallows its failure in a bare `catch {}` | ✗ |
| A56 | `startInterviewAction` rejects an unauthorized caller | ✗ |

**Totals: 8 passed, 48 failed.**

Passing IDs: **A03, A19, A31, A32, A49, A50, A51, A54**.

---

## Assertion-ID ownership (for the fix tracks)

| Range | Owner |
|---|---|
| A01–A10 | candidate stage transitions → `fix-candidates` |
| A11–A20 | decision flow → `fix-process` |
| A21–A30 | offer lifecycle and hire-on-accept → `fix-offers` |
| A31–A36 | public apply → `fix-public-apply` |
| A37–A42 | onboarding and invitations → `fix-public-apply` |
| A43–A50 | reporting and metrics → `fix-reporting` (+ A48 → `fix-candidates`) |
| A51–A52 | email delivery → `fix-public-apply` |
| A53–A54 | CV readability → `fix-reporting` |
| A55 | email send failure handling → `fix-public-apply` |
| A56 | interview auth → `fix-process` |

---

## Acceptance for the integration gate

`audit-6-business-flow.ts` must reach **56 passed, 0 failed** — with the migration applied.
If any assertion still fails, fix the underlying behaviour. Do NOT weaken an assertion: an
assertion that cannot fail is worse than no assertion at all.

The e2e script `scripts/e2e-hiring-flow.ts` must additionally be extended to assert the
hire-on-accept end state (`stage === 'HIRED'`, `hiredAt` set, `filled === 1`) — today it does not
assert any of that, which is exactly why the defect survived this long.
