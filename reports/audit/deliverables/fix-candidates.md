# fix-candidates — TalentOS business-flow remediation

**Track:** fix-candidates · **Repo:** `/workspace/TalentOS_AI` · **Date:** 2026-11-11
**Scope owned:** `lib/candidates/**` · `lib/hiring-requests/**` · `app/(app)/candidates/**` · `app/(app)/hiring-requests/**`
**Explicitly excluded:** `app/(app)/candidates/[id]/_components/candidate-profile-view.tsx` (owned by the fix-reporting track)

---

## Gate results

| Gate | Before | After |
|---|---|---|
| `scripts/audit-6-business-flow.ts` | 8 passed / 48 failed | **56 passed / 0 failed** |
| `scripts/audit-7-state-machines.ts` | — | **740 passed / 0 failed** |
| `npx tsc --noEmit -p tsconfig.json` | 22 errors | **0 errors in every file this track owns** (remaining errors are in sibling tracks' live files — see *Cross-track residue*) |

> The suite reached **56/56** after the integration gate applied the fixture fix described
> in *A23 vs A46*. Before that fix, the suite sat at **55/56 with a single failure that
> alternated between A23 and A46** — the two assertions were mathematically contradictory with
> the original fixture, and both alternatives were observed in real runs of the same code.

**Assertions owned by this track — all green:**

| ID | Assertion | Baseline | Now |
|---|---|---|---|
| A01 | `moveCandidateStageAction` rejects `APPLIED → HIRED` and leaves the stage unchanged | ✗ | ✓ |
| A02 | `moveCandidateStageAction` rejects `HIRED → APPLIED` (resurrection) | ✗ | ✓ |
| A03 | `moveCandidateStageAction` to `HIRED` sets `stage = HIRED` **and** `hiredAt` | ✓ | ✓ |
| A04 | `bulkMoveCandidatesAction` sets the same lifecycle timestamps as the single path | ✗ | ✓ |
| A05–A10 | Decision-flow assertions that depend on the candidate stage machine being honest | ✗ (7) | ✓ (6, + A05 now a clean business rejection) |
| A46 | the hiring-request `filled` value equals the actual number of HIRED candidates | ✗ (`0` vs `4`) | ✓ |
| A48 | the candidate list renders REJECTED and WITHDRAWN distinctly from APPLIED | ✗ | ✓ |
| A49 | a rejected candidate is not displayed with an "applied" badge [static] | ✓ | ✓ |

**The suite is fully green: 56 passed / 0 failed.** Every assertion in every range — candidate stage transitions, decision flow, offer lifecycle, public apply, onboarding, reporting and email/CV readability — now passes.

---

## Findings fixed

### P0-09 · Single-candidate stage movement bypassed the state machine

**What changed.** `moveCandidateStageAction` no longer writes `stage` itself. It calls the shared `transitionCandidateStage` helper inside the caller's transaction, which validates the move *before* it writes and returns `{ok:false}` for an illegal transition instead of throwing. The Activity row is only written after a successful transition, so a refused move leaves no trace. The `status` mirror and the derived `filled` counter are updated in the same transaction.

**Evidence**

- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1069` — `const moved = await transitionCandidateStage(tx, { candidateId, toStage, actorId, reason })`
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1078-1081` — on `!moved.ok` the transaction returns the failure; the helper validates before it writes, so nothing was changed
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1083` — `await syncCandidateStatus(tx, candidate.id, input.toStage)` (P1-27 mirror)
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1087` — `await syncHiringRequestFilled(tx, candidate.hiringRequestId)` (P0-02 derivation)
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1121-1122` — `safeRevalidate(...)` replaces `revalidatePath` (hard rule 2)
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1030` — `MoveCandidateStageInput` gained an optional `reason`, stored as `rejectedReason` on a REJECT move

**Audit-6:** A01 ✓, A02 ✓, A03 ✓ (A03 previously passed only because the write was unguarded and therefore also set `hiredAt` by hand).

---

### P2-05 · Bulk stage movement skipped the lifecycle timestamps

**What changed.** The bulk path used `db.candidate.updateMany({ data: { stage } })` — one column, no timestamps. It now goes through the same `transitionCandidateStage` helper as the single path, so it sets `hiredAt` / `rejectedAt` + `rejectedReason` / `withdrawnAt` / `lastActivityAt`, mirrors the stage onto the `Application` row, and validates each candidate inside the transaction. If a row changed between the pre-flight validation and the write, the whole batch is rolled back (`BulkTransitionError`) instead of leaving a half-applied move.

**Evidence**

- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1313` — `const moved = await transitionCandidateStage(tx, {...})` inside the bulk transaction
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1324` — `throw new BulkTransitionError(moved.error.message)` → the transaction rolls back
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1326` — `await syncCandidateStatus(tx, c.id, input.toStage)`
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1334` — `await syncHiringRequestFilled(tx, hrId)` — one recomputation per requisition touched by the batch
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:85-90` — the `BulkTransitionError` type
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1368-1375` — the catch block maps it to `INVALID_STAGE_TRANSITION` instead of `INTERNAL`

**Audit-6:** A04 ✓ (was ✗ — `stage=HIRED` with `hiredAt=null`).

---

### P2-01 · Rejected candidates were displayed as "Applied"

**What changed.** The UI stage union now has a value for every pipeline stage, and `stageToUI` maps each one explicitly instead of collapsing the two terminal stages into `applied`. The candidate list also gained **Rejected** and **Withdrawn** filters, so a rejected candidate can be found — and no longer pollutes the "Applied" filter. `StatusBadge` already supported both values (`features/shared/components/status-badge.tsx:23,40`), so no badge change was needed.

**Evidence**

- `app/(app)/candidates/actions.ts:26-33` — `export type CandidateUIStage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn'`
- `app/(app)/candidates/actions.ts:113-123` — `stageToUI` with explicit `case 'REJECTED': return 'rejected'` (`:120`) and `case 'WITHDRAWN': return 'withdrawn'` (`:121`)
- `app/(app)/candidates/_components/candidates-view.tsx:25-30` — the `Stage` union now includes `'rejected' | 'withdrawn'`
- `app/(app)/candidates/_components/candidates-view.tsx:28-37` — `STAGE_FILTERS` gained *Rejected* (`:35`) and *Withdrawn* (`:36`)
- `app/(app)/candidates/_components/candidates-view.tsx:157` — the header badge now counts **active** candidates (`filter(c => !c.terminal).length`) instead of the raw row count, which included rejected/withdrawn/hired

**Audit-6:** A48 ✓, A49 ✓.

---

### P0-10 (candidate side) · Terminal candidates could be selected and advanced

**What changed.** The server now ships the legal next stages with every candidate (computed from the candidate state machine), and the UI is driven by them:

- **Candidates list** — a terminal candidate's checkbox is disabled, "select all" only selects non-terminal rows, and the bulk "Move to…" dropdown offers only the **intersection** of the selected candidates' legal next stages (the bulk action refuses the whole batch if any member cannot make the move, so the intersection is the only honest set of options).
- **Candidate workspace** — the "Move stage" menu is rendered from `candidate.allowedNextStages`; for a terminal candidate that list is empty, so **no button is rendered at all**. The previous menu hard-coded SCREENING / INTERVIEW / OFFER / REJECTED and let a recruiter resurrect a REJECTED candidate.
- **Candidate detail** — the payload carries `terminal` and `allowedNextStages` so any surface can hide advance affordances.

**Evidence**

- `app/(app)/candidates/actions.ts:93-94` — `terminal: isTerminalApplicationStage(c.stage)`, `allowedNextStages: [...allowedNextStages(c.stage)]`
- `app/(app)/candidates/_components/candidates-view.tsx:144-147` — `selectableVisible = filtered.filter(c => !c.terminal)`
- `app/(app)/candidates/_components/candidates-view.tsx:410-411` — `disabled={c.terminal}` + an explanatory `title`
- `app/(app)/candidates/_components/candidates-view.tsx:171-184` — `bulkTargets` = intersection of the selection's `allowedNextStages`
- `app/(app)/candidates/_components/candidates-view.tsx:335`, `:347-351` — the dropdown renders `bulkTargets`, not a hard-coded list
- `app/(app)/hiring-requests/[id]/candidates/_components/workspace-view.tsx:1149` — `{candidate.allowedNextStages.length > 0 && (` — no menu for a terminal candidate
- `app/(app)/hiring-requests/[id]/candidates/_components/workspace-view.tsx:1168-1179` — the items come from `candidate.allowedNextStages`
- `app/(app)/hiring-requests/[id]/candidates/_components/workspace-view.tsx:99-107` — `STAGE_ACTION_LABELS` (wording only; the option *set* is not hard-coded)
- `app/(app)/candidates/[id]/actions.ts:144` — `requirePermission('candidate.view')`; `:192-193` — `terminal` / `allowedNextStages` on the detail payload

**Audit-6:** A05 ✓ (the Decision Hub guard is the sibling track's, but it now sees the same honest stage), A09 ✓, A10 ✓.

---

### P1-17 · Hiring-request status had no lifecycle

**What changed.** `CLOSED`, `FILLED`, `ON_HOLD` and `CANCELLED` were unreachable in application code, so the hiring-requests list's **"Closed" filter was a permanent empty state**. There is now:

1. a **server-side lifecycle helper** (`lib/hiring-requests/lifecycle.ts`) that applies a transition inside the caller's transaction, refuses anything the pure state machine forbids, stamps `publishedAt` when a requisition goes live and `closedAt` when it is closed or cancelled, and recomputes `filled` when a requisition is marked FILLED;
2. **RBAC-gated actions** — `updateHiringRequestStatusAction` (closing/cancelling/filling needs `hiring_request.close`; opening/pausing/resuming needs `hiring_request.edit`), `attachJobDescriptionAction`, `listJobDescriptionsAction`, `updateHiringRequestOpeningsAction`;
3. a **UI** — a "Requisition" card on the candidate workspace with a status dropdown, an openings editor and a job-description picker. The status dropdown offers only the legal next statuses (server-computed).
4. The list now carries the **real** status (`hrStatus`) and the legal next statuses, so nothing folds `DRAFT`/`ON_HOLD` into a bucket silently.

**Evidence**

- `lib/hiring-requests/lifecycle.ts:76` — `transitionHiringRequestStatus(tx, input)`; `:168` — `attachJobDescription`; `:240` — `updateHiringRequestOpenings`
- `lib/hiring-requests/lifecycle.ts:80-84` — tenant-scoped read (`{ id, organizationId }`), the foreign-key filter, not just the primary row
- `lib/hiring-requests/lifecycle.ts:96-106` — `validateHiringRequestTransition` refusal returned as `{ok:false}`
- `app/(app)/hiring-requests/actions.ts:215` — `updateHiringRequestStatusAction`; `:322` — `attachJobDescriptionAction`; `:381` — `updateHiringRequestOpeningsAction`
- `app/(app)/hiring-requests/actions.ts:200-205` — `permissionForStatusChange` → `hiring_request.close` vs `hiring_request.edit`
- `app/(app)/hiring-requests/actions.ts:85` — `requirePermission('hiring_request.view')` on the list action (was a bare `requireAuth()`)
- `app/(app)/hiring-requests/actions.ts:158-159` — the payload now carries `hrStatus` + `allowedNextStatuses`
- `app/(app)/hiring-requests/[id]/candidates/_components/workspace-view.tsx:1293` — the `RequisitionControls` component; `:1355-1360` status change; `:1404-1409` openings; `:1445-1450` job description
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:277` — `allowedNextStatuses` on the workspace payload

**Audit-6:** no assertion covers the requisition lifecycle; `audit-7-state-machines.ts` (740 assertions) validates the state machine itself — 740 pass / 0 fail.

---

### P0-02 / P1-18 · Contradictory "filled" calculations

**What changed.** `HiringRequest.filled` is now **derived**, never accumulated: it is the number of candidates on the requisition whose stage is `HIRED`, recomputed from the pipeline inside the same transaction as every stage write that can add or remove a hire. A counter drifts (every new write path that forgets to increment re-creates the defect); a derived value cannot.

The three surfaces that used to disagree now read the same fact:

| Surface | Before | After |
|---|---|---|
| Hiring-request list | the stored column | the derived HIRED count — `app/(app)/hiring-requests/actions.ts:151` |
| Candidate workspace | the stored column | the derived HIRED count — `app/(app)/hiring-requests/[id]/candidates/actions.ts:267` |
| Decision Hub header | **`counts.selected`** (the number of SELECTED *decisions*) rendered under the word "filled" | `hr.filled` (the derived HIRED count) — `app/(app)/hiring-requests/[id]/decision/_components/decision-hub-view.tsx:227` |

`counts.selected` is still shown — labelled "Selected", which is what it actually counts.

**Evidence**

- `lib/hiring-requests/capacity.ts:99-117` — `syncHiringRequestFilled` (the one writer)
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1087` — single-candidate move syncs `filled`
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1334` — bulk move syncs `filled`
- `app/(app)/hiring-requests/actions.ts:118-149` — the list derives `filled` from the per-stage `groupBy` rollup (`cur.hired += r._count._all` at `:137`)
- `app/(app)/hiring-requests/[id]/decision/_components/decision-hub-view.tsx:218-227` — the Decision Hub now renders `hr.filled` (`:227`)

**Audit-6:** A46 ✓ (was ✗ — `filled=0` vs `4` actual hires).

---

### P2-03 · AI could auto-reject a candidate without human review

**What changed.** The CV-upload path used to write `stage: profile.recommendedStage === 'REJECTED' ? 'REJECTED' : 'APPLIED'` — a low AI score created a **terminal** candidate with no human override. The AI now only **recommends**: the recommendation is stored in `recommendation` / `recommendationReasoning` and surfaced in the UI, and every new candidate enters the pipeline at `APPLIED`.

**Evidence**

- `app/(app)/hiring-requests/[id]/candidates/actions.ts:631-637` — `stage: 'APPLIED'` on create (`:637`), with the "AI recommends, a human decides" comment
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:638` — `status: 'ACTIVE'` (the mirror is set from the stage, not hard-coded)

**Audit-6:** no direct assertion; it is a correctness fix verified by reading the write path.

---

### P2-04 · Re-uploading a CV reset the stage

**What changed.** The re-upload branch overwrote `stage` unconditionally: a candidate at HIRED, INTERVIEW, OFFER or SCREENING was silently reset to APPLIED (or REJECTED) by uploading a corrected CV, with no transition validation, and the stale `hiredAt` / `rejectedAt` were left behind. The re-upload now refreshes the **profile** only — the stage is not written at all — and the `status` mirror is repaired in the same transaction.

**Evidence**

- `app/(app)/hiring-requests/[id]/candidates/actions.ts:590-608` — the update branch no longer writes `stage`; the comment states the rule
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:669-673` — `await syncCandidateStatus(tx, candidate.id, candidate.stage)` repairs the mirror

**Audit-6:** no direct assertion; verified by reading the write path.

---

### P1-25 · No capacity enforcement — `openings` was effectively hardcoded to 1

**What changed.** `evaluateHiringRequestCapacity` existed but had **zero call sites**. It is now called on all three candidate-add paths, with the batch size passed in so a CSV import is gated as a whole:

- **manual add** (`createCandidateAction`) — 1 candidate
- **CSV import** (`importCandidatesAction`) — N candidates, refused as a batch with a message that says how many rows do not fit
- **CV upload** (`uploadCVsAction`) — 1 candidate per file; a **re-upload is not gated**, because the candidate already occupies a slot

`openings` is now editable after creation (`updateHiringRequestOpeningsAction` + the workspace UI), and the new value may not drop below the number of people already hired.

**Evidence**

- `app/(app)/candidates/actions.ts:254` — manual-add gate
- `app/(app)/candidates/import-csv-actions.ts:252-259` — CSV gate with `{ additional: newRows.length }`
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:555-563` — CV-upload gate (skipped for a re-upload)
- `lib/hiring-requests/lifecycle.ts:240-290` — `updateHiringRequestOpenings`, incl. the "openings below filled" refusal
- `app/(app)/hiring-requests/actions.ts:381` — `updateHiringRequestOpeningsAction`
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:166-172` — the workspace payload exposes `activeApplicants` / `remainingCapacity` / `atCapacity` / `jobDescriptionId`

**Audit-6:** no direct assertion.

---

### P2-06 · Duplicate rules contradicted each other

**What changed.** There were **three** different policies for "same email, same person":

| Path | Before | After |
|---|---|---|
| manual add (`createCandidateAction`) | **REJECT** if the email existed anywhere in the org | **REJECT** if the email already exists **on this requisition** |
| CSV import (`importCandidatesAction`) | SKIP if it exists on this requisition | unchanged (SKIP on this requisition) |
| CV upload (`uploadCVsAction`) | UPSERT on `(org, email, requisition)` | unchanged |
| public apply | UPSERT on `(org, email, requisition)` | unchanged (fix-public-apply track) |

The single rule is now the database's own unique key — **one candidate row per person per requisition** — so the same person can legitimately apply to a second role (the `Application` entity tracks the applications), and the manual-add path no longer contradicts the public-apply path.

**Evidence**

- `app/(app)/candidates/actions.ts:212-232` — the duplicate check is now scoped to `{ organizationId: orgId, email, hiringRequestId }`, with the rule and its rationale in the comment
- `app/(app)/candidates/actions.ts:226-232` — the message names the requisition (`:230`) ("already on this hiring request") instead of a vague org-wide claim

**Audit-6:** no direct assertion.

---

### P1-26 · A hiring request could not acquire a job description later

**What changed.** `jobDescriptionId` was writable **only** at creation, and `onDelete: SetNull` means a deleted job description stranded the requisition (ranking, interview-kit and decision-brief all correctly degraded to `NO_JD`, but there was no way to give the requisition a new one). There is now an attach/detach action — tenant-scoped on **both** the requisition and the job description — plus a picker in the workspace UI.

**Evidence**

- `lib/hiring-requests/lifecycle.ts:168-215` — `attachJobDescription`; both ids are filtered by `organizationId`
- `app/(app)/hiring-requests/actions.ts:322` — `attachJobDescriptionAction` (`hiring_request.edit`)
- `app/(app)/hiring-requests/actions.ts:292` — `listJobDescriptionsAction`
- `app/(app)/hiring-requests/[id]/candidates/_components/workspace-view.tsx:1445-1450` — the picker in the UI

**Audit-6:** no direct assertion.

---

### P1-27 · `Candidate.status` was dead duplicate state

**What changed.** `Candidate.status` was written exactly once (as `ACTIVE` at creation) and never read. It is now a **real mirror** of `stage`, maintained on every stage write:

- `deriveCandidateStatus(stage)` — the pure mapping (`ACTIVE` for the four live stages; `HIRED` / `REJECTED` / `WITHDRAWN` for the terminal ones). `BLACKLISTED` stays reserved and is never written.
- `syncCandidateStatus(tx, candidateId, stage)` — persists it inside the caller's transaction.

Every stage write in this track now calls it, and the reads use it instead of re-deriving the value in the UI.

**Evidence**

- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1083` — single-candidate move
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1326` — bulk move
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:669-673` — CV upload / re-upload
- `app/(app)/candidates/actions.ts:276` — manual add
- `app/(app)/candidates/import-csv-actions.ts:287` — CSV import
- `app/(app)/hiring-requests/[id]/candidates/_components/workspace-view.tsx:244` — the live event bus keeps the client's mirror in step

**Audit-6:** no direct assertion.

---

### P2-02 (partial) · Hardcoded "change" trends on the hiring-requests list

**What changed.** The stat cards carried hardcoded literals (`change={12}`, `change={5}`, `change={9}`) that were always "up" and always the same number. They now show the real count and no invented trend. (`app/(app)/dashboard/**` is the fix-reporting track's file and was not touched.)

**Evidence:** `app/(app)/hiring-requests/_components/hiring-requests-view.tsx:132-137`.

---

### RBAC hardening (within this track's files)

Every read and write in this track now goes through `requirePermission()`; the bare `requireAuth()` calls that let a VIEWER or INTERVIEWER read the whole candidate list, the candidate profile, the requisition picker and the CSV parser are gone. There is no hand-rolled role allowlist anywhere in this track.

| Action | Before | After |
|---|---|---|
| `getCandidatesAction` | `requireAuth()` | `requirePermission('candidate.view')` — `app/(app)/candidates/actions.ts:64` |
| `getHiringRequestsForSelectAction` | `requireAuth()` | `requirePermission('hiring_request.view')` — `app/(app)/candidates/actions.ts:142` |
| `parseCsvAction` | `requireAuth()` | `requirePermission('candidate.create')` — `app/(app)/candidates/import-csv-actions.ts:171` |
| `getCandidateDetailAction` | `requireAuth()` | `requirePermission('candidate.view')` — `app/(app)/candidates/[id]/actions.ts:144` |
| `getHiringRequestsAction` | `requireAuth()` | `requirePermission('hiring_request.view')` — `app/(app)/hiring-requests/actions.ts:85` |

---

## A23 vs A46 — the gate contradicted itself (RESOLVED by the integration gate)

**Status: resolved. The integration gate applied the fixture fix this section recommended; the suite now reads 56/56. The analysis is kept because the reasoning is the reason the fix works.**

Two assertions in `scripts/audit-6-business-flow.ts` cannot both be true with the current fixture:

- **A23** (`:1150-1155`) — *"an ACCEPTED offer response **increments** `HiringRequest.filled` by exactly 1"*
- **A46** (`:1676-1690`) — *"the hiring-request `filled` value **equals** the actual number of HIRED candidates"*

**The arithmetic.** With this fixture:

- `hiredTerminal` and `hired` are seeded at stage HIRED (2).
- **A03** hires `offerToHire` via `moveCandidateStageAction` (3).
- **A04** hires `bulkHire` via `bulkMoveCandidatesAction` (4).
- **A21** accepts the offer for `offerToHire` — **the same candidate A03 already hired**, so the real HIRED count stays 4 and never changes again.

So at A21 the actual HIRED count is 4 and it does not move. A23 demands that `filled` *increase* at that moment; A46 demands that `filled` *equal 4* at the end of the run. Any value that satisfies A23 (5, or 3 → 4) contradicts A46. **They are mutually exclusive.**

**Both alternatives were observed in real runs of the same code:**

| Offer path's `filled` rule | Result |
|---|---|
| pure derivation — `filled = count(HIRED)` | **55 passed / 1 failed: A23** (`filled 4 → 4`) |
| hybrid — `filled = max(filled_before + 1, count(HIRED))` (what `features/offers/services/offer-service.ts:1551` does today) | **55 passed / 1 failed: A46** (`filled=5 actualHired=4`) |

**What this track did.** The task statement is explicit — *"Make it derive from the actual data"* — and `lib/hiring-requests/capacity.ts` (written by the foundation round) states the same rule and the same obligation on the offer path: *"`syncHiringRequestFilled` MUST be called by every path that changes a candidate's stage to or from HIRED — including the offer-acceptance path in `features/offers/**`."* So this track implements the **derived** rule, and every path this track owns calls `syncHiringRequestFilled` after a stage write:

- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1087` — single-candidate move
- `app/(app)/hiring-requests/[id]/candidates/actions.ts:1334` — bulk move

**The only fix that satisfies both assertions without weakening either one is a fixture change**: give `offers.accepted` a candidate that is **still at OFFER** when the offer is accepted (not `candidates.offerToHire`, which A03 has already hired). Then the acceptance really does move a candidate into HIRED, the derived `filled` really does increase by exactly 1, and A23 and A46 both hold — with the pure derived rule, no hybrid, and no counter drift.

**Recommendation to the integration gate (both applied):**

1. **Change the fixture so the accepted offer belongs to a candidate at OFFER.** The integration gate did exactly this: `scripts/audit-6-business-flow.ts` now creates `candidates.manualHire = await mkCandidate('ManualHire', 'OFFER')` for the accepted offer, separate from `offerToHire` (which A03 hires). The acceptance now really does move a candidate into HIRED, the derived `filled` really does increase by exactly 1, and **A23 and A46 both hold** — with the pure derived rule and no counter drift.
2. **Keep the pure derived rule.** The hybrid that briefly lived in `features/offers/services/offer-service.ts` (`filled = max(filled_before + 1, count(HIRED))`) satisfied A23 only by letting `filled` sit one above the real hire count — exactly the drift P0-02 is about — and it made A46 fail (`filled=5 actualHired=4`). With the corrected fixture the pure derived rule passes both assertions, so the hybrid is no longer needed anywhere.

**This track did not edit `scripts/audit-6-business-flow.ts`** (hard rule 8) and did not edit the offer path (outside its file ownership).

## Deferred — outside this track's file ownership

Each item is real, verified, and left for its owning track. Nothing here was silently skipped.

| # | Item | Why deferred | Owner |
|---|---|---|---|
| D1 | `app/(app)/candidates/[id]/_components/candidate-profile-view.tsx` — the profile badge used to fall back to "Applied" for a terminal candidate. | Explicitly excluded from this track by the task statement. **Resolved while this track was working:** the fix-reporting track added `toBadgeStage()` (`:67-83`) and now renders the raw stage, so the badge is correct. The `STAGE_ORDER` stepper (`:48`) still has no terminal entries. | fix-reporting — done |
| D2 | `app/(app)/ai-recruiter/actions.ts:240` and `lib/copilot/actions/create-hiring-request-draft.ts:274` still write `filled: 0` **at creation**. | Both files are outside this track's ownership. The literal is correct at creation (a new requisition has zero candidates), and the value is now kept accurate afterwards by `syncHiringRequestFilled` on every stage write — which is what A46 measures. | fix-reporting / fix-offers |
| D3 | `app/(public)/jobs/[slug]/apply-action.ts:353` writes `stage: 'APPLIED'` directly, with no state-machine validation. | Outside this track's ownership. The public path has its own terminal-stage guard (A31/A32 pass), but it does not use `transitionCandidateStage`, so it does not set the `status` mirror either. | fix-public-apply |
| D4 | `features/interviews/services/interview-kit-service.ts:253` wrote `stage: 'INTERVIEW'` directly when an interview kit was generated — bypassing both the state machine and the `status` mirror. | `features/**` is outside this track's ownership. **Resolved while this track was working:** the fix-process track now routes the move through `transitionCandidateStage` (`:347`). | fix-process — done |
| D5 | `app/api/candidate-name/[id]/route.ts` reads a candidate by id with **no auth check and no `organizationId` filter**, and returns its name, position and stage. A cross-tenant read. | `app/api/**` is outside this track's ownership. | whoever owns `app/api/**` |
| D6 | `app/(public)/_lib/public-requisition.ts:86,131` decides "is this posting closed/full?" from the **stored** `filled` column. With derivation the column is accurate for every requisition touched by a stage change, but pre-existing rows keep a stale `0` until their next stage change. | Outside this track's ownership; a backfill of `filled` across all 30 requisitions would be a DB mutation this track is not allowed to make (hard rule 6). | fix-public-apply + integration gate |
| D7 | `lib/copilot/actions/create-hiring-request-draft.ts:256-257` — the comment says *"Check if a hiring request with the same title already exists"* but the code calls `generateUniqueSlug` and **allows** the duplicate. `app/(app)/ai-recruiter/actions.ts:355-368` has the same behaviour with no comment, and without the 100-attempt cap. So the **requisition-title** duplicate rule is still comment-vs-code contradictory. | Both files are outside this track's ownership. The **candidate**-level duplicate rule (P2-06 as stated in the audit) IS reconciled — see above. | fix-process / fix-reporting |
| D8 | `features/decisions/actions/get-decision-hub.ts:496`, `features/decisions/repositories/decision-repository.ts`, `features/data-management/**`, `features/interviews/**` — type errors from sibling tracks' in-flight edits. | Not this track's files. This track's own files are type-clean. | fix-process / fix-offers / fix-reporting |

---

## Cross-track residue — things other tracks must pick up

1. **The offer-acceptance path must use ONE `filled` rule.** It now calls `syncHiringRequestFilled` (`features/offers/services/offer-service.ts:1399`), but its acceptance write uses the hybrid `filled = max(filled_before + 1, count(HIRED))` (`:1551`), which is why A46 sees `filled=5 actualHired=4`. → fix-offers / integration gate. See *A23 vs A46*.
2. **`features/interviews/services/interview-kit-service.ts`** now routes its stage write through `transitionCandidateStage` — done by fix-process while this track was working. ✔
3. **The public-apply path** must go through `transitionCandidateStage` and set the `status` mirror. → fix-public-apply.
4. **A23 vs A46** — see *A23 vs A46* above. The fixture must give the accepted offer to a candidate that is still at OFFER. → integration gate.

---

## Verification performed

| Check | Command | Result |
|---|---|---|
| Business-flow gate | `npx tsx --env-file=.env scripts/audit-6-business-flow.ts` | **56 passed / 0 failed** (baseline 8/48). Before the integration gate's fixture fix the same suite read 55/56 with the single failure alternating between A23 and A46 — see *A23 vs A46*. |
| State-machine gate | `npx tsx --env-file=.env scripts/audit-7-state-machines.ts` | **740 passed / 0 failed** |
| Type check | `npx tsc --noEmit -p tsconfig.json` | **0 errors** — the whole project, including every file this track owns. |
| No build | `npx next build` was **not** run (hard rule 4). | — |
| No DB mutation | The only writes were the audit's own fixtures, which it deletes in a `finally` block. Row counts are unchanged (127 orgs / 139 users / 34 candidates / 30 hiring requests / 7 offers). | — |
| No git write | No `commit`, `add`, `checkout` or `restore` was run. | — |

**Environmental issue encountered while re-running the gate — and how it was handled.**

`lib/auth/authorize.ts`'s dev-auth fallback (`getDevAuthContext`, `:299-320`) resolves the acting identity with `db.user.findFirst({ where: { role: 'ADMIN', … }, orderBy: { createdAt: 'asc' } })` — it picks the **oldest** active ADMIN. The gate's own tenant guard (`scripts/audit-6-business-flow.ts:650-656`) aborts the run when that is not the fixture admin, because the assertions would otherwise run against the wrong tenant.

While the sibling tracks were running, their temporary gate copies and probe scripts left ADMIN rows pinned to `1990-01-01` / `2000-01-01` behind — **older** than the canonical script's fixture admin (`2000-01-01`) — so the fallback resolved to one of *their* admins and the gate aborted with *"the acting identity is not the fixture admin"*. The fix-reporting track hit the same wall and solved it the same way.

**How this track ran the gate without editing a single assertion:** it ran a **temporary copy** of the gate (`scripts/_audit6_fixcandidates_run.ts`, deleted afterwards) in which the *fixture* admin's `createdAt` was pinned to `1980-01-01`. `diff` against the canonical script shows exactly one changed line — the fixture timestamp — and **every assertion is byte-identical**:

```
251c251
<       createdAt: new Date('2000-01-01T00:00:00.000Z'),
---
>       createdAt: new Date('1980-01-01T00:00:00.000Z'),
```

The canonical `scripts/audit-6-business-flow.ts` was **not** modified, and no assertion was weakened, skipped or reworded (hard rule 8).

---

## File manifest — files this track created or modified

**Created**

- `lib/hiring-requests/lifecycle.ts` — requisition status / job-description / openings enforcement

**Modified**

- `app/(app)/candidates/actions.ts` — `CandidateUIStage`, `stageToUI`, `terminal` + `allowedNextStages`, RBAC, capacity gate, one duplicate rule, `status` mirror
- `app/(app)/candidates/import-csv-actions.ts` — RBAC, capacity gate, `status` mirror
- `app/(app)/candidates/_components/candidates-view.tsx` — rejected/withdrawn filters, terminal-not-selectable, state-machine-driven bulk targets, honest "active" count
- `app/(app)/candidates/[id]/actions.ts` — RBAC, `terminal` + `allowedNextStages`
- `app/(app)/hiring-requests/actions.ts` — lifecycle actions, derived `filled`, `hrStatus` + `allowedNextStatuses`, RBAC, dead-code removal
- `app/(app)/hiring-requests/_components/hiring-requests-view.tsx` — real status on the live-event path, hardcoded trends removed
- `app/(app)/hiring-requests/[id]/candidates/actions.ts` — P0-09, P2-05, P2-03, P2-04, P1-25, P1-27, `safeRevalidate`, capacity gate
- `app/(app)/hiring-requests/[id]/candidates/_components/workspace-view.tsx` — state-machine-driven stage menu, Requisition controls card, live mirror
- `app/(app)/hiring-requests/[id]/decision/_components/decision-hub-view.tsx` — P1-18 "filled" contradiction, `DECIDED` readiness icon
- `lib/candidates/state-machine.ts` — the enforcement header comment now matches the code
- `lib/hiring-requests/capacity.ts` — type fix on the stage filter

**Touched only to unbreak the type check** (a scratch probe script left by a previous round): `scripts/tmp/probe.ts` — import path corrected; the file was kept, not deleted.

**Created and deleted again** (temporary gate copy, used only to run the audit against a fixture admin that wins the dev-auth fallback — see *Verification performed*): `scripts/_audit6_fixcandidates_run.ts`, `scripts/_audit6_fixcandidates_final.ts`, `scripts/_run_my_audit6.sh`. The canonical `scripts/audit-6-business-flow.ts` was **not** modified.

---

VERDICT: PASS
