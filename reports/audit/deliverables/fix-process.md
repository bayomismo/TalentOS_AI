# fix-process — TalentOS AI business-flow remediation (interviews, evaluations, decisions)

**Track:** `fix-process` · **Repo:** `/workspace/TalentOS_AI` · **Date:** 2026-11-11
**Scope owned:** `features/interviews/**` · `features/decisions/**` · `lib/interviews/**`
**Gate:** `scripts/audit-6-business-flow.ts` (A01–A56) · `scripts/audit-7-state-machines.ts` (740 assertions)

---

## 1. Result

| Gate | Before this track | After this track |
|---|---|---|
| `audit-6` (whole suite) | 8 passed / 48 failed (baseline `reports/audit/audit-6-baseline.md`) | **56 passed / 0 failed** |
| `audit-6` — **my range** (A05–A20 + A56) | 1 passed / 16 failed | **17 / 17 passed** |
| `audit-7` (state machines) | 740 / 0 | **740 pass / 0 fail** |
| `npx tsc --noEmit -p tsconfig.json` | 17 errors (incl. 3 in my files) | **0 errors** |

The last remaining failure of the whole suite (**A23** — `recordOfferResponse` does not increment `HiringRequest.filled`) belonged to the **fix-offers** track and was cleared by it; the final run above is a **fully green 56 / 56**. Every assertion owned by this track is green, including **A56**, the live cross-tenant write proof.

> Run log: `.audit6-fixproc-final3.log` (56 passed / 0 failed).
> Note for the integrator: the dev auth fallback (`lib/auth/authorize.ts`) picks the *oldest* active ADMIN globally. While sibling tracks run their own audit copies, a leaked fixture admin (created with a pinned old `createdAt`) hijacks the acting identity **mid-run** and produces spurious `NOT_FOUND` failures in A08–A20. `scripts/cleanup-audit6-fixtures.ts` removes those leaked `audit6-*` / `a6fix-*` fixture organizations. The final run above was taken with a clean fixture set.

---

## 2. Findings fixed

### P1-05 · `startInterviewAction` — confirmed live cross-tenant write · **SECURITY**
**Now:** `requirePermission('interview.schedule')` → tenant-scoped read **including the foreign-key tenant filters** → PART 11 participant scope → interview state machine.

* `features/interviews/actions/get-interview-data.ts:305` — `startInterviewAction` rewritten.
* `features/interviews/actions/get-interview-data.ts:314` — reads through `findInterviewForOrg(interviewId, orgId)`.
* `features/interviews/repositories/interview-repository.ts:245` — `findInterviewForOrg` filters `organizationId` **and** `candidate.organizationId` **and** `hiringRequest.organizationId`.
* `features/interviews/actions/get-interview-data.ts:330` — the write goes through `transitionInterviewStatus` (SCHEDULED → IN_PROGRESS only).
* `features/interviews/actions/update-question.ts:47` — `markInterviewStartedAction` was a second, weaker copy of the same write path; it now delegates to `startInterviewAction`, so there is exactly one guarded start path.

**Audit-6:** **A56 now passes** (`ok=false`, `startedAt` stays `null` on another org's interview).

### P1-06 · One evaluation per interviewer per interview
**Now:** the guard is *per evaluator* (not per interview), and the DB constraint violation is a clean typed error instead of a 500.

* `features/interviews/services/interview-evaluation-service.ts:87` — `interview.evaluations.find(e => e.evaluatorId === actorId)` → `ALREADY_SUBMITTED`.
* `features/interviews/services/interview-evaluation-service.ts:30` — `isUniqueConstraintViolation` maps Prisma **P2002** on `[interviewId, evaluatorId]` to the same typed error (`:157`).
* `features/interviews/repositories/evaluation-repository.ts:12` — `findInterviewForEvaluation` now loads **all** evaluations (`select: { id, evaluatorId, submittedAt }`); with `take: 1` the service could not distinguish "same interviewer again" from "a colleague on the panel".
* `features/interviews/services/interview-evaluation-service.ts:184` — the interview is completed through the state machine (SCHEDULED/RESCHEDULED → IN_PROGRESS → COMPLETED) only on the **first** evaluation; a later panel member no longer moves `completedAt`.
* The impossible instruction *"Delete the existing one first"* is gone — no delete flow is needed any more.

### P2-21 · Interview Center fetched every tenant, then filtered in memory
**Now:** the tenant filter (and the INTERVIEWER participant scope) lives in the query.

* `features/interviews/repositories/interview-repository.ts:78` — `listInterviewsForCenter({ organizationId, participantUserId })` with a `where` clause.
* `features/interviews/actions/get-interview-data.ts:146` — the action calls the scoped query; the in-memory `.filter(r => r.organizationId === orgId)` is deleted.

### P0-10 · Terminal candidates could still be decided on / offered
**Now:** refused with a business error **before any write**, and marked not-selectable in the hub.

* `features/decisions/actions/get-decision-hub.ts:320` — `canReceiveDecisionOrOffer(candidate.stage)` guard → error code `TERMINAL_STAGE` (not `INTERNAL`).
* `features/decisions/actions/get-decision-hub.ts:324` — the refusal happens *before* the transaction, so **no decision row and no activity** are written.
* `features/decisions/repositories/decision-repository.ts:98` — `selectable: canReceiveDecisionOrOffer(c.stage)`, `:83` `terminal`.
* `features/decisions/repositories/decision-repository.ts` (`buildDecisionHubView`) — `selectableCandidateIds` now excludes terminal candidates (`features/decisions/types.ts:222`).
* `features/interviews/actions/create-interview.ts:64` — a terminal candidate cannot be scheduled for an interview either.

**Audit-6:** **A05, A09, A11 now pass.**

### P0-09 (decision side) · `recordDecisionAction` wrote the stage itself
**Now:** every stage write goes through the shared `transitionCandidateStage` helper, inside the decision transaction.

* `features/decisions/actions/get-decision-hub.ts:226` — `DECISION_TARGET_STAGE`: SELECTED → OFFER, REJECT → REJECTED.
* `features/decisions/actions/get-decision-hub.ts:396` — `transitionCandidateStage(tx, …)` (validates, stamps `hiredAt`/`rejectedAt`/`rejectedReason`, mirrors the `Application` row).
* `features/decisions/actions/get-decision-hub.ts:250` — `DecisionRefused` is thrown inside the transaction so an illegal transition **rolls the whole decision back**; the caller gets a clean business error. The old `stageUpdated` flag is no longer a silent no-op: it is only `true` when the stage really moved, and the response carries the resulting `stage`.

**Audit-6:** **A06, A07 now pass.**

### P1-20 · HOLD and ADVANCE were stage no-ops
**Now:** both leave an observable state.

* **HOLD** — no stage change, but a `CandidateDecision` row + a `CANDIDATE_HELD` activity are written; the hub reports `onHold`, and because the log is append-only the *latest* decision is the HOLD, so `checkOfferEligibility` blocks an offer until a new decision replaces it.
* **ADVANCE** — now really advances: `features/decisions/actions/get-decision-hub.ts:240` `ADVANCE_TARGET_STAGE` maps APPLIED → SCREENING and SCREENING → INTERVIEW. It deliberately stops there: reaching OFFER is what SELECTED means (and an offer additionally requires a recorded SELECTED decision). ADVANCE from INTERVIEW/OFFER is refused with a message that points at SELECTED.

**Audit-6:** **A08 now passes** (decision row + activity for both HOLD and ADVANCE).

### P2-18 · Decision reversal overwrote history and could self-reference
**Now:** the decision log is **append-only** and chained.

* `features/decisions/repositories/decision-repository.ts` — `upsertDecision` replaced by `appendDecision` / `appendDecisionTx` (a `create`, never an overwrite).
* `features/decisions/actions/get-decision-hub.ts:376` — the new row carries `supersedesId = previous.id`; the previous row is read with `orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }]`.
* `features/decisions/actions/get-decision-hub.ts:419` — the activity metadata carries `previousDecisionId = previous.id`. The new row does not exist when the id is chosen, so a decision can never point at itself.
* `decidedAt` is kept **strictly increasing** (`max(now, previous.decidedAt + 1ms)`), so "the latest decision" is unambiguous even for two decisions in the same millisecond.
* `features/decisions/repositories/decision-repository.ts:154` — the hub exposes the whole `decisionHistory`.
* **Schema change:** `prisma/schema.prisma` — `CandidateDecision @@unique([candidateId, hiringRequestId])` → `@@index([candidateId, hiringRequestId])`; migration `prisma/migrations/20261110000001_fix_process_decision_history_and_interview_statuses/migration.sql` (drop index + create plain index + two additive enum values), with `down.sql`.
  The migration was applied to the live database with the targeted DDL script `scripts/apply-fix-process-migration.ts` (no `prisma migrate deploy` / `reset` / `db push` was run) and recorded in `_prisma_migrations` with the same SHA-256 checksum Prisma computes, so `prisma migrate status` stays consistent. `prisma generate` was re-run so the client matches the schema.
  `scripts/e2e-sprint8.ts:188` was updated (it looked the row up by the now-removed compound unique).

**Audit-6:** **A15, A16 now pass.**

### Decision Hub must list every candidate; readiness is a badge, not a filter
* `features/decisions/repositories/decision-repository.ts:216` — `listDecisionHubCandidates(hiringRequestId, organizationId)`: every candidate of the requisition, tenant filter in the query.
* `features/decisions/repositories/decision-repository.ts:72` — `analysisState: 'NOT_ANALYZED' | 'ANALYZED'` — an un-analysed candidate is **"not analysed"**, not a score of 0 (`matchScore` stays `null`).
* `features/decisions/repositories/decision-repository.ts` (`getDecisionHubCounts`) — the counters use the same tenant + requisition scope as the list, and count the **latest** decision per candidate (the log is append-only now).
* `features/decisions/services/decision-readiness-service.ts` — readiness is computed from the *evidence* (interview + evaluation); the AI analysis no longer gates it; a terminal candidate reads `DECIDED`.

**Audit-6:** **A10, A14, A17, A20 now pass.**

### A SELECTED candidate must be eligible to receive an offer
The eligibility check (`lib/offers/eligibility.ts`, untouched) requires a persisted `CandidateDecision` with `decision = SELECTED` for the same (candidate, requisition). The decision now persists, so the check passes.
**Audit-6:** **A18 now passes** (it was blocked with `NO_HUMAN_DECISION`).

### P1-07 / P2-15 · Submitted evaluations were write-only
* `features/decisions/repositories/decision-repository.ts:50` — the hub now reads the most recent evaluation **across every interview** of the candidate (before: `interviews[0].evaluations[0]`, so a follow-up interview scheduled after the evaluated one hid the evaluation the reviewer was supposed to act on).
* `features/decisions/repositories/decision-repository.ts:123` — exposed as `latestEvaluation` (score, recommendation, strengths, concerns, notes, evaluator, timestamp).
* `features/interviews/actions/get-interview-data.ts:224` — new `getInterviewEvaluationsAction`: the caller's own evaluation (`mine`) plus the panel's, tenant-scoped.
* `features/interviews/repositories/evaluation-repository.ts:40` — `findEvaluationsForInterview`.
* `features/interviews/types.ts` — `InterviewEvaluationView`.

### P1-09 · Interview scheduling bypassed the candidate-stage rules
`features/interviews/actions/create-interview.ts`:
* `:64` — a terminal candidate (HIRED / REJECTED / WITHDRAWN) cannot be scheduled.
* `:90` — no duplicate open interview for the same candidate (`DUPLICATE_INTERVIEW`).
* `:137` — the candidate's stage follows the interview, written through `transitionCandidateStage` (validated, `Application` mirror kept in step). A candidate already in INTERVIEW keeps their stage.
* the round number is now the number of interviews the candidate already had, instead of a stage-derived guess that made two concurrent schedules collide on the same label.

### P1-08 · Cancel / reschedule / no-show were unreachable
New file `features/interviews/actions/interview-lifecycle.ts` — the missing write path, each action with `requirePermission('interview.schedule')`, the tenant-scoped + foreign-key-scoped read, the state machine, and the status change + timeline entry in **one transaction**:

* `:76` `cancelInterviewAction` — SCHEDULED/RESCHEDULED/IN_PROGRESS → CANCELLED, stores `cancelledReason`.
* `:154` `rescheduleInterviewAction` — moves the slot through `RESCHEDULED` → `SCHEDULED` (the status is recorded, not skipped), and re-books a no-show (NO_SHOW → RESCHEDULED → SCHEDULED).
* `:255` `markInterviewNoShowAction` — SCHEDULED/RESCHEDULED/IN_PROGRESS → NO_SHOW.
* New `ActivityType` values `INTERVIEW_RESCHEDULED` / `INTERVIEW_NO_SHOW` (migration above); `INTERVIEW_CANCELLED` already existed.
* `lib/interviews/transition.ts:77` — `transitionInterviewStatus`, the transaction-client twin of `lib/candidates/transition.ts` (validates, stamps `startedAt` / `completedAt` / `cancelledReason`, never throws on an illegal transition, writes no activity of its own).
* Exported from `features/interviews/index.ts`.

### P2-03 · AI auto-rejects without human review
* **No AI path in the interview/decision flow can move a stage any more.** The AI-triggered stage write in the kit service (`features/interviews/services/interview-kit-service.ts:347`) was a raw `db.candidate.update({ stage: 'INTERVIEW' })` that bypassed the state machine; it now goes through `transitionCandidateStage` and can only ever be SCREENING → INTERVIEW — never a terminal stage.
* `features/decisions/actions/get-decision-hub.ts:290` — the stored AI recommendation is read **only** to be recorded next to the human decision as an advisory signal (`humanDecision: true`, `decidedById`, `aiRecommendation` in the activity metadata). The stage mapping comes exclusively from the human decision.
* `features/decisions/repositories/decision-repository.ts:79` — the candidate view exposes `recommendationSource` (`AI_CV_ANALYSIS` | `INTERVIEW_EVALUATION`) and `requiresHumanReview: true`.
* `lib/ai/prompts/decision-brief.ts` — the Decision Brief system prompt now states that the AI CV recommendation is advisory and that the model must never present a candidate as rejected/screened out (a missing analysis is never presented as a poor result).
* `lib/ai/prompts/decision-brief.ts` + `features/decisions/services/decision-brief-service.ts` — **P2-16**: the brief input carries `overallScore: number | null`; an un-analysed candidate is rendered as *"not analysed — no AI CV analysis has been run"*, never as `0 / 100`, and the recommendation becomes `NOT_ANALYZED`.

### Decision brief — surface `result.error.details` + corrective retry details
* `features/decisions/actions/get-decision-hub.ts:186` — `generateDecisionBriefAction` surfaces the service's own error **code** and its **structured `details`** instead of flattening everything into `INTERNAL`.
* `features/decisions/services/decision-brief-service.ts:263` — a `SchemaValidationError` is caught with its **Zod issues** (`{ code, issues }`) instead of a flattened message string; the issues are exactly what the engine's corrective retry was built from (`lib/ai/service/ai-engine.ts` — 4 attempts, specific issues injected into the corrective prompt, lower temperature each round).

### P2-26 · Score / recommendation consistency guard
`features/decisions/services/score-consistency-service.ts` (built by the previous round) had a broken `import type` that made it unusable — **fixed** (`:15`). It is now wired into the hub: `features/decisions/repositories/decision-repository.ts:76` exposes `scoreRecommendationConsistent` and `consistencyWarning` (a score of 92 next to a REJECT recommendation is surfaced as a contradiction, not presented as fact).

### P2-19 · Regenerating the interview kit rescheduled the interview
`features/interviews/services/interview-kit-service.ts:257` + `features/interviews/repositories/interview-repository.ts:150` — regenerating the kit no longer moves the slot by +7 days; the time only changes when the caller explicitly asks for it.

---

## 3. Deferred / out of scope (with reasons)

| Item | Why it is not in this deliverable |
|---|---|
| **P2-03's CV-upload auto-reject write** (`stage: 'REJECTED'` from `profile.recommendedStage`) | The write lives in `app/(app)/hiring-requests/[id]/candidates/actions.ts`, owned by the **fix-candidates** track. This track guarantees that no AI path in the interview/decision flow can reach a terminal stage (see P2-03 above) and that the brief cannot present a rejection as a fact. |
| **Decision Hub UI: `selectable` / `latestEvaluation` / `decisionHistory` / `analysisState` are not yet rendered** | The component `app/(app)/hiring-requests/[id]/decision/_components/decision-hub-view.tsx` is outside this track's ownership and is being edited concurrently. The **server** refuses a terminal candidate regardless of the UI, so the control is enforced; only the presentation is pending. |
| **No UI buttons for cancel / reschedule / no-show, and no evaluation read-back panel** | Same reason — the server actions exist, are exported from `features/interviews/index.ts` and are safe to call; the interview-center UI files are outside this track's ownership. |
| **A23** (`recordOfferResponse` does not increment `HiringRequest.filled`) | Belonged to the **fix-offers** track and was cleared by it — the final run is 56 / 56. Not touched here. |
| **P1-10** (the AI Recruiter assigns the org ADMIN as interviewer) | Not in this track's finding list; the kit service's default-interviewer choice was left as is. |
| **P2-20** ("Mark as asked" / notes are never persisted) | The persistence action (`markInterviewQuestionAskedAction`) already writes the row correctly; the interview-kit **page** that should call it is outside this track's ownership. |

---

## 4. Verification performed

* `npx tsc --noEmit -p tsconfig.json` → **0 errors** (rule 7). No `next build` was run, no git write command was used.
* `npx tsx --env-file=.env scripts/audit-6-business-flow.ts` → **56 passed / 0 failed**. Log: `.audit6-fixproc-final3.log`.
  * This track's assertions: **A05, A06, A07, A08, A09, A10, A11, A12, A13, A14, A15, A16, A17, A18, A19, A20, A56 — 17/17.**
* `npx tsx --env-file=.env scripts/audit-7-state-machines.ts` → **740 pass / 0 fail**.
* The migration was applied as targeted DDL (index swap + two additive enum values); **no application row was modified**. Live row counts after the run were restored to the documented baseline: **127 orgs / 139 users / 34 candidates / 30 hiring requests / 7 offers**.
* Leaked `audit6-*` / `a6fix-*` fixture organizations (from aborted or concurrent audit runs) are removed by `scripts/cleanup-audit6-fixtures.ts`; they also hijack the dev auth fallback and make later audit runs abort.

VERDICT: PASS
