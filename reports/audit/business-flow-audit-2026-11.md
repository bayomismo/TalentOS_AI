# TalentOS AI — Business Flow Logic Audit

**Date:** 2026-11
**Scope:** Hiring request & candidate lifecycle · Interview → evaluation → decision · Offer creation → approval → issuance → response → hire · Onboarding, org/team admin, invitations · Public applications & postings · Dashboard, analytics, reporting
**Method:** Read-only static trace (schema → server action → service → UI), four parallel deep-dives plus a personal verification pass on every P0/P1 claim.
**Code state at audit time:** `93b0e99` — **no production code was modified during this audit.**

---

## How to read this report

Severity is **business impact**, not code smell.

| Severity | Meaning |
|---|---|
| **P0** | The product silently loses money, data, or a hire. A real customer hits this in normal use. |
| **P1** | A control the org believes it has is not actually enforced. Usually visible only in edge cases. |
| **P2** | The flow completes but reports/UX misrepresent what happened. |
| **P3** | Architectural smell or deferred item. |

Every finding below carries a `file:line` citation. Claims marked **✓ verified** were independently re-checked by me against the source at the cited lines.

---

## Executive summary

The audit found **80 defects** across the eight audited flows: **10 P0, 28 P1, 33 P2, 9 P3**. The headline is not the defect count — it's the *shape* of the problem:

**TalentOS has a well-built skeleton with the connective tissue missing.** Every individual component works in isolation: the offer state machine is correctly enforced, the candidate state machine exists and is correctly written, the invitation token is properly hashed and single-use, the last-ADMIN guard is solid, tenant isolation is applied consistently on nearly every query. But the *transitions between components* were never wired.

The result is a product where **the happy path renders beautifully and the business state never advances.**

The three clearest examples:

1. **An accepted offer hires nobody.** The candidate is never marked `HIRED`, `hiredAt` is never set, `HiringRequest.filled` is never incremented — because `filled` is only ever written as `0`. Meanwhile `HiringRequestStatus.FILLED` exists, and analytics count `stage: 'HIRED'`, which nothing in the offer flow ever produces. **A recruiter accepts an offer and the system records zero hires, forever.**

2. **No email is ever sent.** The Resend branch in `lib/email/index.ts` is entirely commented out; the provider is unconditionally `LocalOutboxProvider`, which writes a `PENDING` row. There is no drainer, no cron, no `RESEND_API_KEY`. Every notification — public-application alerts, team invitations, **password resets**, interview reminders, offer letters — is a no-op in production, swallowed by a bare `catch {}`. The public applicant is explicitly promised *"we will review your application and reach out by email."*

3. **No recruiter can ever read a CV.** `MemoryStorage` keeps bytes in-process only ("discarded when the function is recycled"). `parsedText` is written to the DB and **read nowhere in the entire UI** — verified: zero `.tsx` references. `storageUrl` is a synthetic `memory://` string and is **never linked**. The candidate profile shows a filename, a file type, a size, and a date. That is all. The highest-intent signal in a hiring funnel is unusable, and it fails *silently* — the upload path returns `ok`.

**A caveat on the count:** several of these compound. F-01 (email) and F-14 (CV unreadable) are each individually fatal to the public-apply funnel, and the funnel is the top of the marketing site's conversion path.

---

## P0 findings — the product loses money, data, or hires

### P0-01 · An accepted offer hires nobody ✓ verified
**`features/offers/services/offer-service.ts:596-637`**

`recordOfferResponse('ACCEPTED')` writes `offer.acceptedAt` and `offer.status`. It does **not** write `candidate.stage = 'HIRED'`, `candidate.hiredAt`, `candidate.status = 'HIRED'`, `HiringRequest.filled`, or an `ActivityType.HIRED` row.

The only `HIRED` write in the codebase is a manual pipeline drag (`app/(app)/hiring-requests/[id]/candidates/actions.ts:937-947`).

**Impact:** `HiringRequest.filled` stays `0` on every requisition forever (`app/(app)/dashboard/actions.ts:150`, `app/(app)/hiring-requests/actions.ts:98`). `HiringRequestStatus.FILLED` is unreachable. "Hires" analytics stay at 0 (`app/(app)/analytics/actions.ts:102`). The offer pipeline reports an acceptance with no corresponding hire. The recruiter must manually drag a card to make the system reflect reality — and if they don't, the data is wrong forever.

The UI even hedges about it: *"The candidate's stage **may** update to HIRED if defined"* (`app/(app)/offers/[id]/page.tsx:379`) — it is not defined.

---

### P0-02 · `HiringRequest.filled` is permanently zero ✓ verified
**`app/(app)/ai-recruiter/actions.ts:231`**

`filled` is written in exactly one place in the entire application: `filled: 0` at requisition creation. Repo-wide grep for an increment returns **zero hits** in `app/`, `features/`, `lib/`.

**Impact:** the "Open Positions → filled" display on the dashboard and the hiring-requests list is decorative. Combined with P0-01, no accepted offer and no manual drag ever moves this number. Capacity planning is impossible.

---

### P0-03 · No email is ever delivered ✓ verified
**`lib/email/index.ts:26-37` (provider) · `lib/email/local-outbox.ts:32-46` (sink) · `vercel.json` (no drainer)**

The provider-selection block is commented out:
```ts
// const providerName = process.env.EMAIL_PROVIDER
// if (providerName === 'resend' && process.env.RESEND_API_KEY) { ... }
cached = new LocalOutboxProvider()
```
`LocalOutboxProvider.send()` inserts a row with `status: 'PENDING'`. The file's own comment: *"Until then, rows just accumulate."* The only cron in `vercel.json` is `/api/cron/interview-reminders`.

**Impact — every notification in the product is a no-op:**
- New-public-application alerts to admins (`app/(public)/jobs/[slug]/apply-action.ts:311-345`) → **the hiring team is never told an applicant arrived**
- Team invitations (`lib/onboarding/actions.ts:230-241`)
- **Password resets** (`app/(auth)/actions.ts:110-121`) → a locked-out user can never recover
- Offer letters and interview reminders

Each send site wraps the call in a bare `catch {}`, so failures are invisible. The public applicant is promised email contact at `app/(public)/jobs/[slug]/applied/page.tsx:66-68`.

**Note:** this was a known deferral (Resend was listed as P3). But it is not a cosmetic deferral — it silently disables a third of the product's business flows. It should be reclassified as P0 or the flows that depend on it should be marked unavailable in the UI.

---

### P0-04 · No recruiter can read a CV — bytes are discarded, parsed text is never rendered ✓ verified
**`lib/storage/memory-storage.ts` (bytes) · `app/(app)/candidates/[id]/_components/candidate-profile-view.tsx:457-482` (UI)**

This is broader than the public-apply path:

- `MemoryStorage` keeps bytes in a `Map` inside the serverless instance. Its own doc comment: *"Bytes live only in the Lambda's memory and are discarded when the function is recycled."*
- The internal upload path calls `storage.put(...)` (`app/(app)/hiring-requests/[id]/candidates/actions.ts:361-364`), which returns a `memory://` URL. The bytes are gone on recycle.
- The public path doesn't even call `storage.put` — it writes a **synthetic** URL directly: `storageUrl: \`memory://public-apply/${candidate.id}/${parsedCV.fileName}\`` (`app/(public)/jobs/[slug]/apply-action.ts:275`).
- `parsedText` **is** persisted. It is **never rendered anywhere.** Verified: zero `.tsx` references to `parsedText` across `app/` and `components/`.
- `storageUrl` is **never linked.** Verified: zero `.tsx` references.
- The candidate profile renders filename, type, size, date. Nothing else.

**Impact:** every candidate in the product — internal *and* public — shows the recruiter a filename. The parsed text exists in a DB column no screen reads. The recruiter must ask the candidate to resend their CV. This is the single largest business gap in the product, and it fails silently because the upload path returns `ok`.

**Fix:** render `parsedText` in the candidate profile immediately (one component, one day), and separately decide on durable storage (Vercel Blob) — but the parsed-text render is the P0 part.

---

### P0-05 · Approved compensation can be rewritten through the letter body, with no re-approval and no audit ✓ verified
**`features/offers/services/offer-service.ts:290-302` (write path) · `app/(app)/offers/[id]/page.tsx:256, :261-264` (UI)**

The column-level guard is **sound**: `editOffer` rejects any non-`DRAFT` offer (`offer-service.ts:240-242`), and `APPROVED → DRAFT` is not a legal edge. So you genuinely cannot approve $165k and then edit the column to $250k.

But the money the candidate reads lives in the letter, and the letter is not protected:
```ts
if (status === ACCEPTED || DECLINED || WITHDRAWN || EXPIRED) → INVALID_TRANSITION   // APPROVED and ISSUED pass
```
`setOfferDraftContent` accepts arbitrary client JSON as the letter body, never cross-checks `draftContent.compensationSection` against `offer.salaryAmount`, never resets status, and when `aiGenerated: false` writes **no Activity and no AuditLog** (the `if (meta.aiGenerated)` guard at `:303` skips it).

**Exploit chain:** DRAFT @ $165k → TA_LEAD approves → recruiter edits the letter's compensation paragraph to "$250,000" → Save letter → **status stays APPROVED, no re-approval, no audit event**. The facts panel still shows $165,000, so the approver's own screen looks consistent.

**Impact:** the compensation-approval control is bypassable through the artifact rather than the column — exactly the scenario the control exists to prevent, relocated.

---

### P0-06 · Public re-application resets terminal candidates and overwrites recruiter-curated data ✓ verified
**`app/(public)/jobs/[slug]/apply-action.ts:206-240`**

The public path writes `stage: 'APPLIED'` directly on both the create and update branches (`:236-237`, `:256-257`). It imports **no** state machine.

Notably, `lib/candidates/state-machine.ts:25-26` carries a comment claiming the opposite:
> *"Sprint 18 audit: the bulk-move action **and the public-apply action** both go through this validator before persisting."*

They do not. The bulk-move action does; the public-apply action does not. The comment is false and will mislead the next reader.

`REJECTED`, `WITHDRAWN` and `HIRED` are terminal (`lib/candidates/state-machine.ts:55-59`), yet the update writes straight over them — and does **not** clear `rejectedAt` / `hiredAt`, leaving rows in contradictory states like `status=ACTIVE, stage=APPLIED, rejectedAt=<date>`.

**Impact:** a rejected (or hired, or withdrawn) candidate re-applies through the same public link and silently re-enters the top of the pipeline. The rejection decision is undone with no recruiter action. Funnel analytics then double-count or drop the hire. The update also overwrites recruiter-curated fields: name, phone, location, links, `summary` (cover letter) and `source` (`'Public: …'` replaces `Referral`/`LinkedIn`).

---

### P0-07 · Anyone can overwrite a real candidate's record by knowing their email ✓ verified
**`app/(public)/jobs/[slug]/apply-action.ts:206-240`**

The endpoint is unauthenticated and keys on `(organizationId, email, hiringRequestId)`. On a hit it takes the **update** branch and overwrites identity/contact fields. There is **no email-ownership proof** (no verification token, no OTP) and **no per-email rate limit** — the only limit is per-IP.

**Impact:** anyone who knows a candidate's email and the company's public job URL can submit an application under that email and rewrite the real candidate's record — name, phone, location, portfolio links, cover letter — and push a rejected candidate back to `APPLIED` (P0-06). This is candidate-data tampering and pipeline poisoning, and it is repeatable because the limit is per-IP only.

**Fix:** stop mutating the existing candidate row on re-apply. Create an `Application` record (P1-16) and never overwrite identity fields from an unauthenticated path.

---

### P0-08 · `/onboarding/done` permanently bricks workspace creation ✓ verified
**`app/onboarding/done/page.tsx:20-25` · `app/onboarding/layout.tsx:25-38` · `lib/onboarding/transitions.ts:53-62` · `lib/onboarding/provision.ts:107-113` · `lib/onboarding/signup.ts:88-97`**

`/onboarding/done` completes onboarding for **any** authenticated user with no check of `onboardingStep`:
```ts
if (!isFullyOnboarded(snap)) {
  if (snap.organizationId) {
    await completeOnboarding({ userId: session.user.id, organizationId: snap.organizationId })
  }
}
```
`completeOnboarding` sets **both** `User.onboardingStatus` **and** `Organization.onboardingStatus` to `COMPLETED` (`lib/onboarding/transitions.ts:53-62`). At signup the only org the user has is the **placeholder** org (`"First Last's Workspace"`, slug `personal-…`). `provisionWorkspace` then refuses:
```ts
if (currentOrg && currentOrg.onboardingStatus === 'COMPLETED') throw new Error('ALREADY_HAS_ORG')
```

**Reachability confirmed.** The onboarding layout only redirects users who are *already* fully onboarded (`app/onboarding/layout.tsx:31-33`):
```ts
if (isFullyOnboarded(snap)) { redirect('/dashboard') }
```
It does **not** gate the current step. A user whose `onboardingStep` is `ACCOUNT_CREATED` or `ORG_PENDING` passes the layout check, reaches the done page, and completes onboarding against the placeholder org.

**Impact:** a brand-new signup who navigates directly to `/onboarding/done` is dropped into the throwaway placeholder org, told onboarding is complete, and from then on **every attempt to create a real workspace fails** with *"You already belong to an organization."* There is no other org-creation path and no support escape hatch. The tenant signup is dead on arrival, and the org is permanently named `First Last's Workspace` with a `personal-*` slug.

---

### P0-09 · Single-candidate stage movement bypasses the state machine ✓ verified
**`app/(app)/hiring-requests/[id]/candidates/actions.ts:918-947`**

```ts
import { validateStageTransition, ... } from '@/lib/candidates/state-machine'   // line 26 — imported
...
data: { stage: input.toStage, ... }                                            // line 941 — never validated
```

The validator is imported and **never called**. Any stage can be written to any stage, including out of terminal states. The UI dropdown (`workspace-view.tsx:1107-1162`) offers those illegal transitions.

**Impact:** the Sprint 18 state machine is decorative on the single-candidate path. Every invariant it encodes — no resurrection of rejected candidates, no reversing a hire — can be violated by dragging one card.

**This is the highest-leverage P0 fix in the codebase: one function call.**

---

### P0-10 · Terminal candidates can still receive decisions and offers ✓ verified
**`features/decisions/actions/get-decision-hub.ts:211-228`**

No terminal-stage eligibility guard. A candidate in `REJECTED`, `WITHDRAWN` or `HIRED` still appears in the Decision Hub, can be `SELECTED`, and can be issued an offer.

Compounding this, `recordDecisionAction` silently no-ops the stage write when the transition is illegal — it sets a `stageUpdated` flag, then **never reads it**, and the UI only checks `r.ok`. The user sees *"Candidate selected"* while the stage never moved.

> ⚠️ **This particular defect is mine.** I introduced the `stageUpdated` flag earlier today in commit `09d4dbb`. The intent was right; the implementation silently swallowed the failure. It needs fixing as part of P0-10, and the flag needs to be surfaced as an error, not ignored.

**Impact:** a rejected candidate can be selected and offered; a hired candidate can be offered again. The UI reports success in both cases.

---

## P1 findings — controls the org believes exist, but don't

### P1-01 · Compensation leaks to roles explicitly denied compensation ✓ verified
**`features/offers/actions/offer-actions.ts:235` (projection) vs `:241-251` (the comp gate)**

```ts
draftContent: offer.draftContent,     // ← projected unconditionally, OUTSIDE the canComp block
...
if (r.canComp) { detail.salaryAmount = ...; detail.bonusAmount = ...; }
```
`VIEWER` has `offer.view` but **not** `offer.view_compensation` (`lib/auth/permissions.ts:114-122`). But `draftContent.compensationSection` states the salary in prose, and `app/(app)/offers/[id]/page.tsx:224-283` renders the letter card unconditionally.

**Impact:** the `offer.view_compensation` boundary — a headline fairness/privacy control — is defeated for every user without it. Any read-only account reads every candidate's salary by opening the offer page. `reports/sprint-10-report.md:244` claims comp is stripped "from the list projection and detail projection." It is not.

---

### P1-02 · `DRAFT` is a trap: no edit UI, no cancel, and the only escape is wired to the wrong action ✓ verified
**`app/(app)/offers/[id]/page.tsx:31, :303-305` · `features/offers/actions/offer-actions.ts:324-331`**

`editOfferAction` is imported and **never called** — a DRAFT offer cannot be corrected in the UI. There is no delete/cancel path. And "Return for changes" calls `doAction('submit')` → `submitOfferForApprovalAction` → attempts `PENDING_APPROVAL → PENDING_APPROVAL` → fails with *"Already in status PENDING_APPROVAL"*.

The correct action `returnOfferForChangesAction` exists and is **never imported by any page** — dead code.

**Impact:** a draft with a wrong salary can only be *approved and issued* — the compensation error is discovered at the worst moment — or abandoned in DRAFT forever, where it permanently blocks a replacement offer for that candidate (DRAFT is an active status) and shows up in the "Draft" metric forever.

---

### P1-03 · `APPROVED` is a one-way dead end
**`lib/offers/state-machine.ts:57-59` · `features/offers/services/offer-service.ts:522-528`**

`ALLOWED[APPROVED] = [ISSUED]` — nothing else. No `APPROVED → WITHDRAWN`, no `→ EXPIRED`, no `→ DRAFT`.

**Impact:** if the budget is pulled or the candidate accepts elsewhere after approval, the offer cannot be cancelled. It stays APPROVED, keeps the candidate in "active offer" state (blocking a new offer), and is never counted in the accepted/declined metrics — a permanently invisible zombie.

---

### P1-04 · Offer expiry is not automatic; `EXPIRED` is unreachable
**`vercel.json:12-19` · `features/offers/services/offer-service.ts:630-634` · `features/offers/actions/offer-actions.ts:408-424`**

No cron, no UI control, and no read-time check compares `expiresAt` to now. `recordOfferResponse('EXPIRED')` performs no date validation, so an offer can be expired months early — or accepted long after expiry.

Meanwhile `acceptanceRate = accepted / (issued + accepted)` **excludes DECLINED/WITHDRAWN/EXPIRED from the denominator**.

**Impact:** an org that issues 10 offers and receives 10 declines reports a *null* acceptance rate (never 0%); one acceptance plus nine declines reports **100%**. Expired offers inflate `issued` forever and remain eligible to be recorded as accepted.

---

### P1-05 · `startInterviewAction` has no authorization check ✓ verified
**`features/interviews/actions/get-interview-data.ts:210-225`**

```ts
export async function startInterviewAction(interviewId: string) {
  const interview = await db.interview.findUnique({ where: { id: interviewId }, ... })
  // ← no requirePermission, no organizationId filter
```
Zero auth check. No `requirePermission`, no org filter.

**Impact:** any authenticated user in any tenant can mutate any interview's state by guessing/harvesting an ID. This is a cross-tenant write.

---

### P1-06 · Panel interviews are structurally impossible ✓ verified
**`features/interviews/services/interview-evaluation-service.ts:46-62` · `prisma/schema.prisma` (InterviewEvaluation)**

```ts
if (interview.evaluations.length > 0) {
  return { ok: false, code: 'ALREADY_SUBMITTED',
    message: 'An evaluation was already submitted for this interview. Delete the existing one first.' }
}
```
The guard counts **all** evaluations, and the schema has `@@index([interviewId])` with **no** `@@unique([interviewId, evaluatorId])`.

**Impact:** one evaluation per interview, globally. Panel interviews cannot be used. Worse, the error tells the user to *"Delete the existing one first"* — **and no user-accessible delete or edit flow exists.** The instruction is impossible to follow.

---

### P1-07 · Submitted evaluations are write-only
**`features/interviews/types.ts:103-106`**

Interviewers cannot read back their submitted evaluation, so a typo in a score is permanent.

**Impact:** evaluation quality depends on the interviewer's first submission being right. Combined with P1-06, a mistaken score blocks the interview from being evaluated at all.

---

### P1-08 · Interview cancellation, reschedule, and no-show are unreachable
**`features/interviews/actions/create-interview.ts:51-66`**

`InterviewStatus.CANCELLED` and `cancelledReason` exist in the schema, but no working transition path writes them.

**Impact:** a candidate cancels, no-shows, or the panel reschedules — none of it is recorded. The interview stays `SCHEDULED` forever and the reminders keep firing.

---

### P1-09 · Interview scheduling bypasses candidate-stage rules
**`features/interviews/actions/create-interview.ts:51-66`**

No candidate-stage eligibility check, no duplicate-interview guard, and **the candidate's stage is not advanced**. `round` is derived as `candidate.stage === 'SCREENING' ? 1 : 2` — so a candidate already in `INTERVIEW` always gets round 2, and two concurrent schedules collide on the same round label.

**Impact:** you can schedule an interview for a `REJECTED` or `HIRED` candidate. The pipeline board and the interview list disagree about where the candidate is.

---

### P1-10 · The AI Recruiter's org-ADMIN is assigned as interviewer
**`features/interviews/services/interview-kit-service.ts`**

Kit generation picks the org's ADMIN as the default interviewer rather than the requisition's hiring manager.

**Impact:** the admin who approves offers is also the one evaluating candidates — separation of duties is weakened by default, with no user-visible indication.

---

### P1-11 · Public posting is decoupled from the requisition
**`app/(app)/job-library/actions.ts:391-430` · `app/(public)/jobs/[slug]/apply-action.ts:108-136`**

The toggle writes `publicEnabled/publicSlug/publicPostedAt` on the **`JobDescription`** and never checks that a `HiringRequest` exists. Every Job Library card — **including pure templates with no requisition** — gets a "Share" button. But apply resolves the requisition at request time with `take: 1` and **no `orderBy`**, over statuses `DRAFT|OPEN|ON_HOLD`.

**Impact:**
- Publishing a template produces a **live public job page** whose Apply button 404s — a dead end on the employer's careers page.
- Conversely, when the requisition closes, the public page keeps advertising the role and the applicant hits a 404 or "closed".
- With multiple requisitions per JD (two cities, two departments), applicants are assigned **nondeterministically**.

---

### P1-12 · The approval escape hatch fires while a real approver exists
**`features/offers/services/offer-service.ts:545-571` · `lib/auth/permissions.ts:99`**

The "other approver" count looks only for `ADMIN` / `TA_LEAD`, but **`HIRING_MANAGER` also holds `offer.approve`**. In an org with 1 ADMIN + 1 HM, the ADMIN may self-approve despite a capable second approver existing.

The escape hatch is also not gated on the actor's role, yet is *always* logged as `OFFER_SELF_APPROVED_BY_ADMIN`; the docstring's `aiPromptVersion: 'SELF_APPROVED'` flag (`:534-536`) is **never persisted**, and the user-visible Activity row says only *"Offer approved"* — with no self-approval marker in the timeline the UI actually renders.

**Impact:** the control's core question ("is another approver available?") is answered against the wrong population, and the human-readable trail cannot distinguish a routine approval from an escape-hatch approval.

---

### P1-13 · Salary edits and letter saves are invisible in the audit trail
**`features/offers/services/offer-service.ts:266-273, :303-311` · `lib/auth/types.ts:116`**

Editing an offer's terms writes one Activity row titled *"Offer edited"* with **no description and no values**. Saving the letter by hand writes **no** Activity and **no** AuditLog. `AuditAction 'OFFER_EDITED'` is declared and never written anywhere.

**Impact:** the timeline shown to a reviewer cannot answer *"who changed the salary, from what to what, and when"* — and for letter edits it cannot answer *"was it changed at all."* Combined with P0-05, a post-approval compensation change leaves **no trace whatsoever**.

---

### P1-14 · The audit log is write-only, best-effort, and non-atomic
**`features/offers/services/offer-service.ts:485-501, :643-664` · `lib/auth/audit.ts:27-46`**

`audit.view` is granted to ADMIN/TA_LEAD, but **no page, action, or API reads the `AuditLog`** — the only consumer is a row *count* in the data-management service. Both trail writers are `try/catch`-swallowing and run **outside** any transaction with the business mutation.

**Impact:** "the audit log" is a table, not a feature. A transient DB error during an audit write silently drops the entry while the business change persists. Reconstructing "who did what" requires direct DB access.

---

### P1-15 · Approval and response recording have no hiring-request scope
**`features/offers/actions/offer-actions.ts:333-362`**

`HIRING_MANAGER` has `offer.approve`, `offer.record_response`, and `offer.view_compensation` **org-wide**. No offer action verifies that the HM owns the offer's requisition; `authorizeResource` is never called in `features/offers/**`.

**Impact:** a hiring manager can approve, and record an acceptance for, offers on **any** position in the org — including ones they also decide candidates for — collapsing the compensation-approval control into a single-person flow.

---

### P1-16 · One candidate row per job cannot model application history
**`prisma/schema.prisma:662` · `app/(public)/jobs/[slug]/apply-action.ts:206-218`**

The unique key is `(organizationId, email, hiringRequestId)`. Applying to a second role creates a second independent row — no shared profile, CV, skills, or history.

**Impact:** recruiters cannot see *"this person also applied for X"* → duplicate outreach and inflated pipeline counts. The same mutable row is then reused for re-applications (P0-06), which is why application history cannot be preserved.

**Fix:** introduce a separate `Application` entity — `Candidate` = person, `Application` = person's application to a requisition. This also solves P0-06 and P0-07 structurally.

---

### P1-17 · Hiring-request status has no lifecycle
**`prisma/schema.prisma` (HiringRequestStatus) · `app/(app)/ai-recruiter/actions.ts`**

`DRAFT` and `OPEN` are written. `ON_HOLD`, `CLOSED`, `FILLED` and `CANCELLED` are effectively unreachable.

**Impact:** the Hiring Requests **"Closed" filter returns zero production rows** — it is a permanent empty state that looks like a bug to every user. `FILLED` becomes reachable only via P0-01's fix.

---

### P1-18 · Contradictory "openings filled" calculations
**`app/(app)/hiring-requests/_components/hiring-requests-view.tsx` vs `features/decisions/actions/get-decision-hub.ts`**

The hiring-request UI uses `HiringRequest.filled`. The Decision Hub uses selected-decision count vs openings. Both are rendered as authoritative and can disagree.

**Impact:** two numbers for the same fact, on two screens, in the same session.

---

### P1-19 · The AI letter is invisible after reload, and the first save destroys it
**`app/(app)/offers/[id]/page.tsx:77` · `features/offers/services/offer-service.ts:426-435` · `lib/ai/schemas/offer-letter.schema.ts:17-28`**

The AI output schema has **no `fullText` key**, but the page initialises the editor from `draftContent?.fullText ?? ''`. After a reload the letter box is **empty** even though the header says "AI-generated draft on …". Editing and saving then replaces the structured AI sections with whatever `parseLetter` reconstructs from the now-empty text — and, per P1-13, that destruction is unlogged.

**Impact:** recruiters cannot read back the AI letter they generated; the obvious next action silently wipes the draft they were reviewing.

---

### P1-20 · `HOLD` and `ADVANCE` decisions are stage no-ops
**`features/decisions/actions/get-decision-hub.ts:236-…`**

`HOLD` records a decision without changing anything. `ADVANCE` advances nothing — the comment says stage transitions "are already done by bulkMoveCandidatesAction", which is a different action with a different permission model.

**Impact:** two of four decision buttons in the Decision Hub do not do what their labels say.

---

### P1-21 · Onboarding step transitions fail silently and validate nothing
**`lib/onboarding/actions.ts:99-102, :131-134, :249-252` · `lib/onboarding/transitions.ts:32-45`**

`transitionOnboardingStep` **returns** `{ ok: false, code: 'INVALID_TRANSITION' }` — but every caller discards it with `.catch(() => null)`, which never fires because nothing throws. The action still returns `ok: true`, so the UI advances while the stored step did not.

Nothing validates the org's real state: all company-step fields are optional/nullable, and `skipTeamInviteAction` advances to `TEAM_INVITED` with zero invitations.

**Impact:** an org can be "fully onboarded" with **no country, no timezone, no industry, no team** — while `onboardingStatus=COMPLETED` appears in every report. Interview reminders would be scheduled in the wrong timezone.

---

### P1-22 · Accept-invite crashes on the commonest real cases
**`lib/auth/invitation.ts:168-175` · `app/accept-invite/_components/_actions.ts:19-23`**

`acceptInvitation` **throws inside the transaction** for the two most common situations: the email already belongs to another org, or the account is already active. Neither the action nor the client has a `try/catch`, so the invitee gets an unhandled server error instead of a message.

**Impact:** inviting someone who already has a TalentOS account produces a crash and leaves the invitation PENDING.

---

### P1-23 · The Settings invite never emails the invitee, and there is no resend
**`lib/auth/invitation.ts:46-83` · `features/user-management/components/team-page.tsx:448-460`**

`createInvitation` does not send an email — only the onboarding path does (`lib/onboarding/actions.ts:230-241`). In Settings the admin is told to *"Copy the link below and send it to the new user."* When the 7-day TTL lapses there is **no resend** — only the hash is stored, so recovery means revoke → re-create → re-copy by hand.

---

### P1-24 · The invite token is a bearer credential for the invited mailbox
**`lib/auth/invitation.ts:116-166, :190-206`**

`acceptInvitation` takes only token + name + password. The account it creates uses `invitation.email` and grants `invitation.role`. `User.emailVerified` is **never set anywhere**. Anyone who obtains or is forwarded the invite link can set the password for the invited mailbox and occupy the seat — with whatever role was granted, including `ADMIN`.

---

### P1-25 · Candidate capacity is never enforced; openings are effectively hardcoded to 1
**`app/(app)/hiring-requests/[id]/candidates/actions.ts` (manual add, CSV, CV upload)**

No path checks whether the requisition has reached its openings, and openings are not editable after creation.

**Impact:** a requisition for 1 role can accumulate 40 candidates with no warning, and the "filled / openings" display never moves (P0-02).

---

### P1-26 · A hiring request cannot acquire a job description later
**`prisma/schema.prisma:544-548`**

`HiringRequest.jobDescriptionId` is nullable with `onDelete: SetNull`. A business-reset deletion leaves the HR without a JD. Ranking, interview-kit, and decision-brief services correctly return `NO_JD`, so AI features degrade rather than crash — but the requisition is stranded.

---

### P1-27 · `Candidate.status` is dead duplicate state
**`prisma/schema.prisma:113`**

`CandidateStatus` contains `ACTIVE`, `HIRED`, `REJECTED`, `WITHDRAWN`, `BLACKLISTED`. **Only `ACTIVE` is ever written.** No meaningful read or update exists anywhere. `BLACKLISTED` is entirely unimplemented.

**Impact:** a second, always-`ACTIVE` copy of stage state that nothing consumes — and a blacklist concept that looks available in the schema but is not implemented. Any future code trusting `status` will be wrong.

---

### P1-28 · No compensation-band check on offer creation
**`features/offers/services/offer-service.ts:178-203` · `prisma/schema.prisma:532-533`**

`salaryAmount` is never compared against the requisition's `salaryMin`/`salaryMax`, which are **never consulted anywhere in the offer flow**.

**Impact:** a recruiter can offer $500k against a $110k–$145k band, and the approval step — which only checks *who* approves, never *what* — will not catch it. There is no budget guardrail anywhere in the offer lifecycle.

---

## P2 findings — the flow completes but misreports

### P2-01 · Rejected candidates are displayed as "Applied" ✓ verified
**`app/(app)/candidates/actions.ts:66-78`**
```ts
case 'REJECTED':
case 'WITHDRAWN':
default:
  return 'applied'
```
**Impact:** a rejected candidate shows a green "Applied" badge in the global Candidates list. The UI's own type union has no `rejected`/`withdrawn` value, so the information cannot be represented.

---

### P2-02 · The dashboard fabricates trends and time-to-hire ✓ verified
**`app/(app)/dashboard/actions.ts:134-141`**
```ts
{ label: 'Open Positions', value: openPositions, change: 2, trend: 'up' },
{ label: 'Active Candidates', value: totalCandidates, change: 12, trend: 'up' },
{ label: 'Candidates Hired (YTD)', value: hired, change: 4, trend: 'up' },
{ label: 'Avg. Time to Hire', value: '23 days', change: -8, trend: 'up' },
```
The Hiring Requests view hardcodes `12`, `5`, `9` (`hiring-requests-view.tsx:128-130`).

**Impact:** the numbers are always "up" and always identical, regardless of reality. This directly contradicts the Sprint 17 rule that reports must not contain mock data where real data exists. `Avg. Time to Hire` is a hardcoded string, not a calculation.

---

### P2-03 · AI can auto-reject a candidate without human review
**`app/(app)/hiring-requests/[id]/candidates/actions.ts` (CV upload)**
```ts
stage: profile.recommendedStage === 'REJECTED' ? 'REJECTED' : 'APPLIED'
```
A low AI score creates a **terminal** candidate with no human override.

**Impact:** the AI is silently making a rejection decision. It should recommend, not decide.

---

### P2-04 · Re-uploading a CV can reset stage and overwrite candidate history
**`app/(app)/hiring-requests/[id]/candidates/actions.ts`**

**Impact:** a recruiter who re-uploads a corrected CV can move a candidate backwards without any transition validation, and replace the original CV record.

---

### P2-05 · Bulk stage movement skips lifecycle timestamps
**`app/(app)/hiring-requests/[id]/candidates/actions.ts`**

The single-candidate path sets `hiredAt` / `rejectedAt` / `withdrawnAt`; the bulk path does not consistently mirror them.

**Impact:** `hiredAt` is null on candidates hired via bulk move, so any future time-to-hire metric (see P2-02) is wrong even after P0-01 is fixed.

---

### P2-06 · Duplicate rules contradict each other
**`app/(public)/jobs/[slug]/apply-action.ts` vs `app/(app)/hiring-requests/[id]/candidates/actions.ts`**

Public apply allows one candidate row per job per email. `createCandidateAction` blocks the same email across the **entire organization**.

**Impact:** a candidate who applies publicly to a job cannot be manually added to another job in the same org — and gets a confusing error rather than a useful one.

---

### P2-07 · Consent is validated then discarded
**`app/(public)/jobs/[slug]/apply-action.ts:158-164`**

`if (input.consent !== 'on') return MISSING_CONSENT` is the only use of `consent`. **Nothing is persisted** — no column, no audit row, no activity metadata. `Candidate` has no `consentAt`, `consentText`, `privacy`, or `retention` field.

**Impact:** no record of what the applicant agreed to (GDPR Art. 7 accountability).

**Positive note:** no public route renders candidate rows, so enabling a job does **not** expose pre-existing candidates. That safety is accidental — it comes from the absence of a public candidate view, not from a designed control.

---

### P2-08 · Public rate limit is per-IP only, keyed on a client-settable header, and charged before validation
**`app/(public)/jobs/[slug]/apply-action.ts:83-84, :96-105` · `app/api/public/apply/route.ts:26-29` · `lib/auth/rate-limit.ts:27-38`**

The IP is the **first** value of `x-forwarded-for`, which on Vercel is **client-supplied** (the platform appends the real IP). If the header is absent, the key becomes the literal `'unknown'` — **every such applicant shares one global 5/hour bucket**. The limiter is in-memory per process, and the count is charged **before** the job lookup and validation.

**Impact:** a shared office NAT or university egress blocks every applicant behind it for an hour; conversely a bot mints unlimited buckets by rotating the header. Invalid submissions still burn the applicant's quota. No per-email limit exists.

**Recommendation:** use Vercel's `x-vercel-forwarded-for` (or `x-real-ip`), and add a per-email bucket.

---

### P2-09 · The public form advertises `.txt` CVs the server rejects
**`app/(public)/jobs/[slug]/apply/_components/public-apply-form.tsx:26-31` vs `lib/cv/validate.ts:62-74`**

The form accepts `text/plain` and says *"PDF, DOCX, or TXT — max 5MB"*, but `validateAndClassify` only recognises PDF/DOCX signatures. A `.txt` file throws `CVUnsupportedTypeError`. The error message says *"paste the text instead"* — but **there is no paste-CV-text field**; the only textarea is the cover letter.

**Impact:** plain-text résumé applicants hit a dead end at the final step. Invisible in the logs — it's a normal 400.

---

### P2-10 · Unpublish → republish rotates the public URL
**`app/(app)/job-library/actions.ts:406-417`**

The existing slug is reused only when the job is *currently* enabled. Disabling flips `publicEnabled=false` but leaves `publicSlug`; re-enabling therefore generates a **new** slug and overwrites the old one. `publicSlug` is `UNIQUE`, so the old link cannot be resurrected.

**Impact:** "temporarily close the role, then reopen it" — a routine action — silently invalidates the URL already published on LinkedIn and in emails sent to candidates. Those applicants get a 404.

---

### P2-11 · The Copilot offer path uses a different salary vocabulary than the schema
**`lib/copilot/actions/create-offer-draft.ts:52-56` vs `prisma/schema.prisma:226-236`**

The Copilot accepts `salaryPeriod ∈ {HOUR, YEAR, MONTH, WEEK}` (the app uses `annual|monthly|hourly`) and currencies `BRL, MXN, SGD, HKD, NZD`, which are **not** members of `SalaryCurrency`. The service casts the currency with `as never` (`offer-service.ts:186`), so Prisma throws an unhandled server error on an invalid enum value.

**Impact:** a Copilot-confirmed offer using `BRL` produces an unhandled server error instead of a validation message. A client-side input crosses straight into a DB enum.

---

### P2-12 · Applicant consent, staging, and triage have no workflow
**`app/(public)/jobs/[slug]/apply-action.ts:256`**

Public applicants arrive immediately at `stage=APPLIED` with **no skills, no experience, no education, no match score** — unlike the internal upload path, which populates all of it. No triage/review state exists, and AI analysis is deliberately skipped.

**Impact:** a recruiter must re-key the CV for every public applicant. Combined with P0-04, the recruiter gets a filename and nothing else.

---

### P2-13 · No candidate, requisition, or organization delete — no GDPR erasure path
**`features/data-management/service.ts:635-787`**

No product code path deletes a `Candidate`, `HiringRequest`, or `Organization`. The only removal mechanism is the destructive org-wide reset, which also tears down every public posting. Four FKs are `Restrict`, so a DB-level org delete **fails** rather than cleaning up. `AuditLog.organizationId` is `SetNull`, so audit rows survive an org delete.

**Impact:** a candidate who withdraws or asks for erasure cannot be removed individually. Their email, phone, cover letter, CV text, and IP address remain in the tenant DB indefinitely. GDPR Art. 17/20 are explicitly deferred — but the deferral is invisible to the customer.

---

### P2-14 · Reporting denominators can over-count cumulative stages
**`app/(app)/analytics/actions.ts:87-128`**

Stage-based funnel counts read cumulative state, so a candidate who moved through several stages is counted in more than one bucket.

**Impact:** conversion rates do not sum to 100% and are not defensible in a customer review.

---

### P2-15 · The newest interview masks completed interviews and their evaluations
**`features/interviews/actions/get-interview-data.ts`**

Interview queries order by `scheduledAt desc` and take the first result, so a scheduled follow-up hides the completed interview and its evaluation. Only the newest decision brief is retrievable (same pattern).

**Impact:** the interviewer center can hide the evaluation they were asked to complete.

---

### P2-16 · The decision brief encodes "no analysis" as a score of 0
**`features/decisions/services/decision-brief-service.ts`**

A candidate with no match score is presented to the reviewer with a score of 0 rather than an explicit "not analyzed" state.

**Impact:** a reviewer can mistake "no analysis" for "terrible candidate" and reject a strong applicant whose analysis hasn't run.

---

### P2-17 · Decision readiness traps candidates with no match score
**`features/decisions/actions/get-decision-hub.ts`**

Readiness requires `matchScore !== null`, so candidates who haven't been analyzed are excluded from the Decision Hub.

**Impact:** partially analysed requisitions hide candidates from the reviewer who is supposed to decide on them. (The candidate-*visibility* half of this was already fixed in `ef52cda`; the *readiness* half remains.)

---

### P2-18 · Decision reversal overwrites history and can self-reference
**`features/decisions/actions/get-decision-hub.ts`**

A new decision overwrites the previous one, and `previousDecisionId` can point at itself.

**Impact:** the decision history the brief is built on is not trustworthy.

---

### P2-19 · Regenerating an interview kit reschedules the interview and wipes annotations
**`features/interviews/services/interview-kit-service.ts`**

**Impact:** a refresh of the AI kit silently moves the scheduled interview by +7 days and discards interviewer notes.

---

### P2-20 · "Mark as asked" and notes are never persisted
**`features/interviews/actions/get-interview-data.ts`**

**Impact:** an interviewer's work during the interview is lost on refresh.

---

### P2-21 · The Interview Center fetches all tenants' interviews, then filters in memory ✓ verified
**`features/interviews/actions/get-interview-data.ts:142-147` · `features/interviews/repositories/interview-repository.ts:57-73`**

`listAllInterviewsForCenter()` calls `db.interview.findMany()` with **no `where` clause** — every interview in every tenant. The tenant filter is then applied in application code:
```ts
const allRows = await listAllInterviewsForCenter()
const rows = allRows
  .filter(r => r.organizationId === orgId)
  .filter(r => auth.data.role === 'INTERVIEWER' ? r.participants.some(p => p.userId === auth.data.userId) : true)
```

**Correction to an earlier draft of this audit:** I initially flagged this as possible cross-tenant data exposure. **It is not.** The output is correctly scoped to the caller's org, and the `INTERVIEWER` filter is also applied. The user never sees another tenant's interviews.

**Residual impact:** a cross-tenant read that is then discarded. Every Interview Center load pulls all tenants' interview rows, participants, and evaluation scores into the server process before throwing them away. This is a performance and data-handling smell (unnecessary cross-tenant data in process memory, and a latent risk if a future refactor moves the filter or serializes `allRows`), not a live disclosure.

**Fix:** move the filter into the query — `where: { organizationId: orgId, ...(isInterviewer ? { participants: { some: { userId } } } : {}) }`.

---

### P2-22 · Interviewer IDs are unvalidated and the assignment is not transactional
**`features/interviews/actions/create-interview.ts`**

**Impact:** a partial failure leaves some interviewers assigned and others not.

---

### P2-23 · Hard-coded production URLs in white-label surfaces
**`app/(public)/jobs/[slug]/page.tsx:77, :262` · `app/(public)/jobs/[slug]/applied/page.tsx:103` · `app/(app)/job-library/_components/share-modal.tsx:34`**

The fallback is `https://talentos-ai-lime.vercel.app`. On any non-production deployment the "Back to TalentOS" link, the public link the admin copies, and the "Review application" link all point at the vendor's production host.

---

### P2-24 · Stale PENDING invitations are shown as live
**`features/user-management/service.ts:334-359`**

`Invitation.status` only becomes `EXPIRED` when someone attempts to accept. The Settings list returns all statuses without an expiry filter, unlike `listActiveInvitations`.

**Impact:** admins see invitations that can never work, overstating the team pipeline.

---

### P2-25 · Orphan placeholder orgs accumulate
**`lib/onboarding/signup.ts:88-97` · `lib/onboarding/provision.ts:201-206`**

Every signup creates a placeholder org. Abandoned signups leave it PENDING forever, and the cleanup delete is best-effort `.catch(() => null)`. There is **no DB-level invariant** that an org has an admin.

---

### P2-26 · Assessment and decision scoring lack a consistency guard
**`features/decisions/services/decision-brief-service.ts`**

Score and recommendation are produced independently, so a brief can present `score: 92` alongside `recommendation: REJECT`.

**Impact:** the reviewer sees an internally contradictory brief.

---

### P2-27 · The candidate list has no pagination or filtering
**`app/(app)/candidates/actions.ts`**

**Impact:** candidate lists grow unbounded. A tenant with a few thousand candidates loads them all.

---

### P2-28 · Activity events are not transactional with the state change
**`features/offers/services/offer-service.ts:485-501`**

**Impact:** a crash between the business write and the activity write leaves a state change with no visible history.

---

### P2-29 · No offer supersession marker
**`lib/offers/eligibility.ts:95-112`**

After a decline, a replacement offer is permitted, and both offers remain in the list with no "superseded" flag.

**Impact:** two offers for one candidate with no way to tell which is live.

---

### P2-30 · Duplicate-offer guard is a read-then-write with no unique constraint
**`lib/offers/eligibility.ts:95-112` · `prisma/schema.prisma:972`**

`@@index`, not `@@unique`. Two concurrent creates can both pass and produce two active offers.

---

### P2-31 · A requisition can accept applications while in DRAFT
**`app/(public)/jobs/[slug]/apply-action.ts:115-119`**

The apply lookup includes `DRAFT` in its status filter.

**Impact:** an unpublished, unapproved requisition accepts live applications.

---

### P2-32 · The hiring manager is never notified of a public application
**`app/(public)/jobs/[slug]/apply-action.ts:311-320`**

Notification goes to `role: 'ADMIN'` users only — never to `HiringRequest.hiringManagerId` or `createdById`.

**Impact:** the person actually running the requisition may never learn about it (and per P0-03, nobody is emailed anyway).

---

### P2-33 · The marketing fairness claim is literally false for one AI path
**`app/(marketing)/_components/marketing-why.tsx:43-44, :74` vs `lib/ai/prompts/offer-letter.ts:36-42, :130-144`**

The landing page says compensation is stripped *"before any AI call."* Offer-letter generation **deliberately** ships compensation to Gemini — by necessity, since the letter must state the money.

**Impact:** a customer performing a fairness/compliance review will find the one path where comp reaches the model, and that path is user-editable after approval (P0-05). The claim needs rewording to name the offer-letter exception.

---

## P3 findings — architectural smell / deferred

- **P3-01** · No `Membership` join table — role lives on `User.role`, org on `User.organizationId`, `email` is globally `UNIQUE`. One user = one org = one role. A user cannot belong to two orgs, and `acceptInvitation` refuses a cross-org move (which crashes the page — P1-22).
- **P3-02** · No transfer-ownership flow. `Organization` has no owner field; "ownership" is just `role=ADMIN`. A solo admin cannot step down (`SELF_DEMOTION`), so the founder is permanently an ADMIN unless another admin demotes them.
- **P3-03** · `OfferTransitionCode` vocabulary is inconsistent — `deriveCode()` uses `as` casts to return `SENT_TO_ACCEPTED` / `UNDER_REVIEW_TO_*` codes that aren't in the union, while `PENDING_APPROVAL_TO_RETURNED_FOR_CHANGES` is in the union but can never be produced (`lib/offers/state-machine.ts:29-38, :137-140`).
- **P3-04** · `SENT` and `UNDER_REVIEW` offer statuses have no inbound path in app code (seed-only).
- **P3-05** · The offer-letter prompt's guardrail banning "CV scores, interview scores, AI recommendations" is a **prompt instruction only** — the output schema is 10 free strings with no output-side check. A letter leaking "the model scored you 94/100" would be accepted and stored.
- **P3-06** · No `mustChangePassword` enforcement (deferred).
- **P3-07** · Admin reset-request inbox (deferred).
- **P3-08** · WhatsApp auth/reset — explicitly rejected (preview privacy, interception risk, cost, weaker than email).
- **P3-09** · No resume-invite flow. There is no way to resend an expired invite (P1-23).

---

## What is genuinely solid — so the boundary is clear

This audit found real defects, but it also confirmed that a substantial part of the codebase is correct. **Do not let the fix pass weaken these:**

| Area | Evidence |
|---|---|
| Offer state machine enforcement | `validateTransition` runs on **every** state change through the single `transition()` helper (`offer-service.ts:477`). Same-status transitions are rejected. No path writes `offer.status` outside it. |
| Numeric compensation immutability after approval | `editOffer` blocks all non-`DRAFT` edits (`:240-242`), and `APPROVED → DRAFT` is not a legal edge. The column-level attack genuinely fails. |
| Terminal offers freeze their letter | `ACCEPTED`/`DECLINED`/`WITHDRAWN`/`EXPIRED` all block letter edits and regeneration. |
| Tenant isolation on offers | Every offer query is scoped by `organizationId`; reads return `NOT_FOUND`, not `FORBIDDEN`. |
| Invitation token handling | 32-byte random, stored only as SHA-256 hash + 8-char display prefix, delivered in the URL fragment (not the query string). |
| Invitation single-use + expiry | Enforced **inside** the accepting transaction. |
| Password policy | ≥10 chars, not a common password, letter + digit (`lib/auth/password.ts:49-58`). |
| Password-reset tokens | Hashed, 1-hour TTL, single-use, invalidate sibling tokens. |
| No account-existence leak | `/forgot-password` returns identically for known and unknown emails (`app/(auth)/actions.ts:83-88`). |
| Live session enforcement | Every request re-reads `disabledAt`, `passwordChangedAt`, and `role` from the DB (`lib/auth/authorize.ts:71-135`), so a demotion or disable takes effect on the next request. Sessions are revoked on role change and disable. |
| Last-ADMIN guard | Enforced on both demote and disable, with self-action blocks (`features/user-management/service.ts:132-156, :197-220`). `role` is written in only three places, so no path bypasses it. |
| Public-apply tenant isolation | Org and requisition are derived **only** from the public slug, never from client input. |
| AI quota enforcement | Applied at **every** AI entry point — JD generation, CV analysis, ranking, interview kit, decision brief, offer letter, and both copilot paths. |
| AI structured-output resilience | Interview kit, decision brief, and offer letter retry up to four times with lower temperature and **specific validation issues** in the corrective prompt (added in `09d4dbb`). |
| Candidate state machine *implementation* | `lib/candidates/state-machine.ts` is correctly written — the problem is only that the single-candidate path doesn't call it (P0-09). |
| Bulk-move path | `bulkMoveCandidatesAction` correctly routes through `validateStageTransition` (Sprint 18). |
| Password/role-change session invalidation | Sessions are revoked on role change and on disable. |

---

## Revised flow — the target design

This is the shape the fix pass should build toward. It is a design, not code.

### 1. Two aggregate roots, one transaction

```
Application (person × requisition)        Candidate (the person)
  ├─ id, hiringRequestId, candidateId      ├─ id, organizationId
  ├─ stage, appliedAt, source              ├─ stage, status, hiredAt
  ├─ cvFileId, score, evaluatedAt          └─ (never mutated by public apply)
  └─ appliedBy, consentAt
```

- **`Candidate`** = the person. Written by trusted internal paths only.
- **`Application`** = that person's application to one requisition. Public apply creates a new row; it **never** mutates a Candidate.
- **Offer acceptance** writes `Application.stage = HIRED`, `Candidate.stage = HIRED`, `Candidate.hiredAt`, `HiringRequest.filled++`, `HiringRequest.status = FILLED` (when `filled >= openings`) — **in one `db.$transaction`**, plus one Activity and one AuditLog.

This structurally fixes P0-01, P0-02, P0-06, P0-07, and P1-16 at once.

### 2. Every stage mutation goes through the state machine

One helper, used everywhere:

```ts
async function transitionCandidateStage(tx, { candidateId, toStage, actorId, reason }) {
  const current = await tx.candidate.findUnique({ where: { id: candidateId }, select: { stage: true } })
  const result = validateStageTransition(current.stage, toStage)
  if (!result.ok) return { ok: false, error: { code: 'INVALID_STAGE_TRANSITION', message: result.reason } }
  await tx.candidate.update({
    where: { id: candidateId },
    data: {
      stage: toStage,
      ...(toStage === 'HIRED'    && { hiredAt: new Date() }),
      ...(toStage === 'REJECTED' && { rejectedAt: new Date(), rejectedReason: reason ?? null }),
      ...(toStage === 'WITHDRAWN'&& { withdrawnAt: new Date() }),
      lastActivityAt: new Date(),
    },
  })
}
```

Call sites that must adopt it: `moveCandidateStageAction`, `bulkMoveCandidatesAction`, `recordDecisionAction`, `recordOfferResponse`, public apply, and CV upload.

### 3. Three new state machines

| Machine | Statuses | Why |
|---|---|---|
| `lib/hiring-requests/state-machine.ts` | `DRAFT → OPEN → ON_HOLD → OPEN → CLOSED` / `→ FILLED` / `→ CANCELLED` | Makes P1-17's four unreachable statuses reachable, and gives "Closed" a real population. |
| `lib/interviews/state-machine.ts` | `SCHEDULED → IN_PROGRESS → COMPLETED` / `→ CANCELLED` / `→ NO_SHOW` / `→ RESCHEDULED` | Makes P1-08's three unreachable statuses reachable. |
| `lib/applications/state-machine.ts` | `APPLIED → SCREENING → INTERVIEW → OFFER → HIRED` / `→ REJECTED` / `→ WITHDRAWN` | Moves the per-application lifecycle off the shared `Candidate` row. |

Each follows the established pattern: `validateXTransition()`, `allowedNextX()`, `isTerminalX()`.

### 4. Evaluation corrections and panel support

- Schema: add `@@unique([interviewId, evaluatorId])`; drop the "one evaluation per interview" check in favour of "one per interviewer".
- Add an `editEvaluationAction` (evaluator or admin) with an AuditLog row.
- Read-back: a `listMyEvaluations` query so an interviewer sees their submitted scores.
- Never instruct a user to perform an action that does not exist.

### 5. Offer lifecycle corrections

- `setOfferDraftContent`: block for **any** status other than `DRAFT`; add an explicit `APPROVED → REVISION_REQUESTED → DRAFT` path if post-approval edits are genuinely needed — with mandatory re-approval.
- Validate `draftContent.compensationSection` against `offer.salaryAmount` before saving, or derive the compensation block **from** `salaryAmount` server-side rather than trusting the client's JSON.
- Add `APPROVED → WITHDRAWN` and `APPROVED → EXPIRED` edges.
- Wire "Return for changes" to `returnOfferForChangesAction` (it already exists — it's just never imported).
- Add a `superoffers` marker or a `supersededAt` column.
- Add an expiry cron (`/api/cron/offer-expiry`) alongside interview reminders, and check `expiresAt` at read time as a backstop.
- Fix the acceptance-rate denominator to include declined/withdrawn/expired.
- Add a `salaryMin`/`salaryMax` band check on create, and an approval-time warning (not a hard block) when out of band.
- Project `draftContent` **inside** the `canComp` gate, or redact `compensationSection` for roles without the permission.
- Write `OFFER_EDITED` to the AuditLog with before/after values, and record manual letter saves.
- Count `HIRING_MANAGER` in the approver-availability check.

### 6. Real public-apply behaviour

- Public apply **creates** an `Application`, never mutating a `Candidate`.
- Require a verified email to attach an application to an existing person (OTP or a "is this you?" step), or create an unverified person record with a clear merge path.
- Per-email rate limit alongside per-IP; use `x-vercel-forwarded-for` / `x-real-ip`.
- Validate before consuming quota.
- Add a paste-CV-text fallback; align the accept list with what the parser supports.
- Bind public posting to a **specific** `HiringRequest` (`publicSlug` moves to the requisition, or a `publicHiringRequestId` is added) — and keep the slug stable across unpublish/republish.
- Notify the hiring manager, not only admins.
- Persist `consentAt` + `consentText`.

### 7. Email — decide, don't drift

Three options, in preference order:
1. **Wire Resend now** (the branch is written, just commented out) and set `EMAIL_PROVIDER=resend` + `RESEND_API_KEY`. One env var + uncomment.
2. If Resend is deferred for cost reasons, **make the UI honest** — mark email-dependent flows as unavailable, and surface outbox rows in an admin view so the product doesn't lie.
3. Add an outbox-drain cron that at least retries and surfaces failures.

Leaving it silently broken is not an option.

### 8. Reporting integrity

- Remove every hardcoded `change` and `trend`. Compute from real date-windowed queries, or omit the field.
- Replace `Avg. Time to Hire: '23 days'` with a real calculation over `hiredAt` deltas (which requires fixing P2-05 first, or it will silently be wrong).
- Fix funnel denominators to avoid double-counting cumulative stages.
- Extend `Reports` with real data where it exists, keep the honest "Coming Soon" where it does not.

---

## Prioritized remediation plan

### P0 — ship first; each one is a customer-visible loss

| # | Finding | Change | Size |
|---|---|---|---|
| 1 | P0-09 | Call `validateStageTransition` in `moveCandidateStageAction` | ~5 lines |
| 2 | P0-10 | Surface `stageUpdated` as an error; add terminal-stage guard to the Decision Hub | ~30 lines |
| 3 | P0-04 | Render `parsedText` in the candidate profile | ~40 lines |
| 4 | P0-01/02 | `recordOfferResponse(ACCEPTED)` → transactional hire (stage + hiredAt + filled++ + HR status + Activity + AuditLog) | ~80 lines |
| 5 | P0-06/07 | Public apply creates an `Application`; never mutates a `Candidate` | schema + ~150 lines |
| 6 | P0-03 | Wire Resend (uncomment + 2 env vars) **or** make the UI honest | ~10 lines |
| 7 | P0-05 | Lock `setOfferDraftContent` to `DRAFT`; validate comp against `salaryAmount` | ~30 lines |
| 8 | P0-08 | Gate `/onboarding/done` on `onboardingStep`; allow re-provisioning a placeholder org | ~20 lines |

### P1 — second pass

9. Wire "Return for changes" to the existing action (P1-02).
10. `startInterviewAction` auth + org scope (P1-05).
11. `@@unique([interviewId, evaluatorId])` + per-interviewer guard + edit-evaluation (P1-06, P1-07).
12. Interview state machine + cancel/no-show/reschedule paths (P1-08).
13. Hiring-request state machine; make `FILLED`/`CLOSED` reachable (P1-17).
14. Offer expiry cron + read-time check + acceptance-rate denominator (P1-04).
15. `APPROVED → WITHDRAWN` / `→ EXPIRED` edges (P1-03).
16. Project `draftContent` inside the comp gate (P1-01).
17. Offer edit → AuditLog with before/after (P1-13).
18. Public posting bound to a specific requisition; stable slug (P1-11, P2-10).
19. Approver count includes `HIRING_MANAGER`; persist the self-approval flag (P1-12).
20. Onboarding transition results checked, not swallowed (P1-21).
21. Invite accept error handling + resend flow (P1-22, P1-23).
22. Offer band check (P1-28).
23. `Candidate.status` — either implement it properly or delete it (P1-27).

### P2 — third pass

24. Remove all hardcoded dashboard trends and `Avg. Time to Hire` (P2-02).
25. `stageToUI` — add `rejected`/`withdrawn` to the UI union (P2-01).
26. AI no longer auto-rejects; it recommends (P2-03).
27. Bulk move mirrors lifecycle timestamps (P2-05).
28. `Application` entity + per-person identity (P1-16) — if not done in P0.
29. Persist consent (P2-07).
30. Rate limit: real IP + per-email; validate before consuming quota (P2-08).
31. Paste-CV-text fallback (P2-09).
32. Copilot salary vocabulary aligned with the schema (P2-11).
33. Analytics denominators; decision-brief "not analyzed" state; readiness trap (P2-14, P2-16, P2-17).
34. Move the Interview Center tenant filter into the query (P2-21) — performance + data-handling hygiene, **not** a live leak.

### P3 — explicitly deferred

35. `Membership` table / multi-org users (P3-01).
36. Ownership transfer flow (P3-02).
37. `mustChangePassword`, admin reset inbox, Resend-vs-WhatsApp decision (P3-06, P3-07, P3-08).
38. Reword the marketing fairness claim to name the offer-letter exception (P2-33).

---

## Regression tests to add before any of this ships

The existing suite (`scripts/audit-*.ts`, `scripts/e2e-hiring-flow.ts`) passes today **with all of these defects present** — it asserts that the happy path returns `ok`, not that the business state advanced. Each fix needs a test that fails before it and passes after.

```
scripts/audit-6-business-flow.ts
  ✅ accepted offer → candidate HIRED + hiredAt set + filled incremented + HR status FILLED
  ✅ offer acceptance is atomic (all writes or none)
  ✅ every candidate stage write goes through validateStageTransition
  ✅ moveCandidateStageAction rejects APPLIED → HIRED (skipping a stage)
  ✅ moveCandidateStageAction rejects HIRED → APPLIED (resurrection)
  ✅ bulk move mirrors hiredAt/rejectedAt/withdrawnAt
  ✅ recordDecisionAction on a terminal candidate returns an error (not ok:true)
  ✅ recordDecisionAction actually moves the stage (regression on stageUpdated)
  ✅ public apply does NOT modify an existing terminal candidate
  ✅ public apply does NOT overwrite candidate identity fields
  ✅ public apply attaches to a deterministically-chosen requisition
  ✅ public apply rejects a candidate whose requisition has no capacity
  ✅ offer letter cannot be edited once APPROVED or ISSUED
  ✅ draftContent is absent for roles without offer.view_compensation
  ✅ offer letter compensation matches offer.salaryAmount
  ✅ self-approval is blocked when a HIRING_MANAGER approver exists
  ✅ /onboarding/done does not complete onboarding from an incomplete step
  ✅ onboarding step transition failure is surfaced, not swallowed
  ✅ candidate list shows rejected/withdrawn as distinct from applied
  ✅ CV parsedText is rendered on the candidate profile
  ✅ accept-invite returns an error (not a crash) for an existing email
  ✅ every email send reaches a real provider (or is explicitly disabled in the UI)
```

Plus a unit suite for each new state machine, mirroring `scripts/audit-5-offers.ts`:

```
scripts/audit-7-state-machines.ts
  ✅ hiring-request transitions (DRAFT/OPEN/ON_HOLD/CLOSED/FILLED/CANCELLED)
  ✅ interview transitions (SCHEDULED/IN_PROGRESS/COMPLETED/CANCELLED/NO_SHOW/RESCHEDULED)
  ✅ application transitions (APPLIED → … → HIRED/REJECTED/WITHDRAWN)
```

---

## Acceptance criteria for the fix pass

1. `npx next build` passes.
2. `scripts/audit-6-business-flow.ts` — all assertions pass.
3. `scripts/audit-7-state-machines.ts` — all assertions pass.
4. All existing audits still pass: `audit-1-onboarding` · `audit-2-integrity` · `audit-3-rbac` · `audit-4-routes` · `audit-5-offers` · `audit-sprint18-fixes` · `e2e-hiring-flow` · `test-extract-role`.
5. The `e2e-hiring-flow.ts` script is **extended** to assert the end state: after offer acceptance, the candidate is `HIRED`, `hiredAt` is set, and `HiringRequest.filled` is 1. Today it passes without asserting any of that.
6. The dashboard contains no hardcoded change values.
7. The public-apply flow has a verified end-to-end path: apply → recruiter sees parsed CV text → candidate advances → offer accepted → candidate `HIRED`.
8. One commit per P0 group; the P0 table above is the ship order.

---

## Notes on method and limits

- **Read-only.** No production code was changed during this audit. The repo is at `93b0e99`.
- **Static trace, not runtime.** Findings are derived from reading schema → action → service → UI. Where a claim needed runtime confirmation (e.g. whether the outbox drains, whether `parsedText` is read), I grepped the whole tree; where a claim was critical, I re-read the cited lines directly.
- **Two claims were flagged for runtime confirmation and both are now resolved:**
  - **P2-21** (Interview Center tenant scope) — **verified as NOT a data leak.** The filter is applied (`:146`), so the output is correctly scoped. Reclassified from a suspected P0 security issue to a P2 query-hygiene finding, with the cross-tenant fetch described accurately.
  - **P0-08** (onboarding brick) — **verified as reachable.** The onboarding layout redirects only fully-onboarded users (`app/onboarding/layout.tsx:31-33`); it does not gate the step, so a user at `ACCOUNT_CREATED` reaches the done page and completes onboarding against the placeholder org. Confirmed as P0.
- **The `stageUpdated` defect (P0-10) is mine** — introduced in `09d4dbb` earlier today. It was intended as the fix for terminal-stage decisions and it silently swallows the failure case. It needs to be corrected in this pass.
- **Not covered by this audit:** AI prompt quality and hallucination behaviour, the Copilot orchestration engine's reasoning quality, calendar integration, the data-management/reset service's internals beyond its delete semantics, and mobile/responsive rendering.
