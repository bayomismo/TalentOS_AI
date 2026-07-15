# Sprint 8 — Decision Hub · AI Decision Brief · Side-by-side Comparison · Human Final Decision

**Status: SHIPPED to production** (https://talentos-ai-lime.vercel.app)
**Sprint goal:** give HR a single, evidence-grounded place to compare finalists, get an AI decision brief, and record the final human decision — with the AI strictly as decision-support and the human always owning the call.

---

## 1. What landed

### 1.1 Decision Hub entry points

| Surface | Entry | Path |
|---|---|---|
| HR list row | New "Decision Hub" violet pill, next to the existing "Candidate Workspace" CTA | `/hiring-requests` (HiringRequestsTable) |
| Candidate workspace | "Decision Hub" button in the workspace header | `/hiring-requests/[id]/candidates` |
| Candidate detail | New "Decision" card with readiness chip + "Open Decision Hub" | `/candidates/[id]` |

### 1.2 Two new routes

- `/hiring-requests/[id]/decision` — Decision Hub: position summary, 5-stat count tile, finalist selector (2-4), Generate-AI-Brief / Compare-Selected toolbar, latest Decision Brief card, candidate list with per-candidate readiness + Select/Reject confirmation, recent activity feed.
- `/hiring-requests/[id]/decision/compare?ids=…` — Side-by-side finalist grid: each card has **separate** AI CV Match and Human Interview score blocks, top skills, latest interview strengths/concerns. The AI Decision Brief renders below the grid with executive summary, per-candidate evidence, cross-candidate comparison, open questions, missing evidence, recommended next steps.

### 1.3 Human final decision

- `CandidateDecision` model: one row per `(candidateId, hiringRequestId)` via `@@unique`, upserted on every record.
- `Activity.candidateDecisionId` links each activity to the decision for the audit trail.
- Confirmation dialog: every "Select" or "Reject" click goes through a modal with a notes textarea before the decision is written.
- Hiring Request status is **never** auto-closed on candidate selection.

---

## 2. Architecture

### 2.1 Feature module: `features/decisions/`

```
features/decisions/
├── types.ts                                  # DecisionReadiness, DecisionHubView, ComparisonView, action inputs
├── services/
│   ├── decision-readiness-service.ts         # pure computeReadiness() state machine
│   └── decision-brief-service.ts             # orchestrates AI engine + AITask persist + event + activity
├── repositories/
│   └── decision-repository.ts                # all Prisma access (hub view, comparison view, decision upsert)
├── actions/
│   └── get-decision-hub.ts                   # 5 server actions: getHub, getComparison, logComparisonViewed, generateBrief, recordDecision
└── index.ts                                  # public API barrel
```

**1,222 LOC** of new feature code, organized exactly like `features/interviews/` from Sprint 8 part 1.

### 2.2 AI: `lib/ai/`

- `lib/ai/schemas/decision-brief.schema.ts` — `DecisionBriefOutput` Zod contract: executiveSummary, candidates[], crossCandidateComparison[], openQuestionsBeforeDecision[], missingEvidence[], recommendedNextSteps[]; per-candidate evidenceSupportingCandidacy / areasRequiringConsideration are `{claim, source}` pairs where `source ∈ {CV, AI_CV_ANALYSIS, INTERVIEW_EVALUATION, INTERVIEWER_NOTES, SCORECARD}`.
- `lib/ai/prompts/decision-brief.ts` — system + user prompt builders with an explicit fairness clause ("Never name a winner, never produce a combined final score, never reference protected characteristics").
- `lib/ai/service/ai-engine.ts` — `generateDecisionBrief()` method: `provider.generate` + Zod-validate + corrective retry (same Gemini `responseJsonSchema` workaround as Sprint 7 — flat `candidates` array, no nested enums in arrays-of-objects).

### 2.3 Refactor: `features/interviews/` (Sprint 8 part 1)

The Sprint 7 ~1,100-line God File at `app/(app)/candidates/[id]/interview-kit/actions.ts` was extracted into a feature module mirroring the new `features/decisions/` shape: `types.ts`, `mappers/`, `repositories/`, `services/`, `actions/`, `index.ts`. A back-compat shim re-exports the original action symbols so all 3 importers still work.

---

## 3. Database

### 3.1 New enums

```prisma
enum DecisionValue { ADVANCE  HOLD  REJECT  SELECTED }
```

### 3.2 New model

```prisma
model CandidateDecision {
  id                String         @id @default(cuid())
  organizationId    String
  candidateId       String
  hiringRequestId   String
  decision          DecisionValue
  notes             String?
  reason            String?
  decidedById       String
  decidedAt         DateTime       @default(now())
  @@unique([candidateId, hiringRequestId])
}
```

### 3.3 Extended `AITask`

- `metadata: Json` — stores `{ comparedCandidateIds: string[], rawTextLength: number, promptMeta }` for the Decision Brief.
- New `AITaskType` value: `DECISION_BRIEF`.

### 3.4 Extended `Activity`

- `candidateDecisionId String?` (FK to `CandidateDecision.id`).
- New `ActivityType` values: `DECISION_BRIEF_GENERATED`, `COMPARISON_VIEWED`, `CANDIDATE_SELECTED`, `CANDIDATE_HELD`, `CANDIDATE_REJECTED`, `CANDIDATE_ADVANCED`.

### 3.5 Migrations

- `20260716000000_sprint8_decision_hub` — enums + `CandidateDecision` model + `Activity.candidateDecisionId` FK
- `20260716010000_sprint8_aitask_metadata` — `AITask.metadata` column
- `20260716020000_sprint8_aitask_metadata_fix` — defensive `ADD COLUMN IF NOT EXISTS` (the metadata migration was marked applied against a connection that hadn't seen the new schema, so we re-add the column)

---

## 4. AI fairness & decision-support guarantees (the hard rules)

| Guarantee | Where it's enforced | How it's tested |
|---|---|---|
| AI never names a winner, "best candidate", "recommended hire", or "reject candidate X" | `decision-brief.ts` prompt forbids the language explicitly | `test-decision-brief.ts` checks the rendered text against a deny-list |
| AI never outputs a single combined hireability / final score | `decision-brief.schema.ts` doesn't have such a field; the prompt forbids it | Engine test asserts no `combined`/`final score` field exists |
| AI CV Match score and Human Interview score are visually + logically separate | The comparison view renders them as two distinct blocks with their own colors and labels | Prod E2E `verify-sprint8-prod.ts` step 4 asserts both labels present and no actual `Combined: 75` style score |
| Evidence traceability is mandatory — every claim cites a source | `evidenceSupportingCandidacy` and `areasRequiringConsideration` items are `{claim, source}` where `source ∈ {CV, AI_CV_ANALYSIS, INTERVIEW_EVALUATION, INTERVIEWER_NOTES, SCORECARD}` | Engine test asserts every evidence item has a non-empty `source` from the enum |
| No protected characteristics | Prompt fairness clause + Zod output doesn't accept age/gender/ethnicity/etc. fields | Engine test greps the output for protected-characteristic terms |
| Decision Readiness is deterministic, NOT AI-computed | `decision-readiness-service.ts` is a pure function: `matchScore → NEEDS_INTERVIEW → AWAITING_EVALUATION → READY_FOR_REVIEW` (4-state machine) | `test-decision-readiness.ts` — 11/11 pass |
| AI never auto-hires / auto-rejects / auto-selects | The `recordDecisionAction` is only ever called by the human, through a confirmation dialog. AI never calls it. | Prod E2E: brief generates but no `CandidateDecision` row is created until the human clicks "Confirm selection" |
| Hiring Request never auto-closes on selection | `recordDecisionAction` only writes to `CandidateDecision` and `Activity`. It does not touch `HiringRequest.status`. | Reviewer can verify by selecting a candidate and confirming `hiringRequest.status` is unchanged |

---

## 5. Test results

### 5.1 Local

| Test | Count | Result |
|---|---|---|
| `scripts/test-decision-readiness.ts` (state machine) | 11 | **11/11 pass** |
| `scripts/test-decision-brief.ts` (real Gemini call + fairness + evidence) | 11 | **11/11 pass** |
| `scripts/e2e-sprint8.ts` (full action layer incl. AI brief, upsert, audit, mismatch rejection) | 46 | **46/46 pass** |
| `scripts/e2e-sprint7.ts` (Sprint 7 regression after refactor) | 36 | **36/36 pass** |
| `pnpm run build` (Turbopack) | — | **pass** |
| `tsc --noEmit` (full project) | — | **0 errors** |
| `prisma validate` | — | **pass** |

### 5.2 Production (https://talentos-ai-lime.vercel.app)

| Test | Count | Result |
|---|---|---|
| `scripts/verify-sprint8-prod.ts` (Playwright — real user flow on production build) | 40 | **40/40 pass** |
| `scripts/verify-sprint7-prod.ts` (Sprint 7 regression on production) | 35 | **35/35 pass** |

The prod E2E drives: HR list → click Decision Hub CTA → hub loads with position summary, 5-stat count, candidate ranking with readiness chips → select 2 finalists → click Compare → side-by-side renders with separate AI CV Match + Human Interview blocks → click Generate AI Brief → real Gemini call → brief appears with executive summary, per-candidate evidence, cross-candidate comparison, recommended next steps → AITask row persisted with `comparedCandidateIds` metadata → back to hub → click Select on a candidate → confirmation dialog with notes textarea → click Confirm selection → `CandidateDecision` row created + `Activity` row logged with type `CANDIDATE_SELECTED` → click Reject on another candidate → confirmation → `CandidateDecision` row created with `REJECT` → refresh hub → both decisions persist as "Selected" / "Rejected" badges → navigate to candidate detail → Decision section renders readiness chip + "Open Decision Hub" CTA + "AI is decision support" disclaimer. **0 browser errors** throughout.

---

## 6. Production deployment

- **URL**: `https://talentos-ai-lime.vercel.app`
- **Vercel project**: `bayomismo/talentos-ai`
- **Deployment method**: `vercel deploy --yes --prod` (Vercel is configured `sourceless: true` so GitHub pushes do not auto-deploy; manual CLI deploys are required).
- **Latest production commits on `main`** (in order):
  - `0f12b88` Sprint 8 - fix interview barrel after Sprint 8 refactor + tighten prod E2E
  - `b563f63` chore: build trigger
  - `6cf34ae` chore: trigger redeploy
  - `f0c0500` Sprint 8 - Decision Hub (AI Decision Brief, side-by-side comparison, human final decision)
  - `673ca24` Sprint 8 - refactor Sprint 7 interview actions God File
  - `c48cd6a` Sprint 7 - harden production Playwright E2E
  - `858ad10` Sprint 7 - remove unused InterviewKitOutput type re-export
  - `4782ca7` Sprint 7 - AI Personalized Interview Kit + Structured Evaluation
- **Vercel logs**: 0 × 5xx during the prod E2E run (confirmed via Playwright's `pageerror` + `console` listeners — `no browser errors` gate passed).
- **Migrations applied to production DB**:
  - `20260716000000_sprint8_decision_hub` ✅
  - `20260716010000_sprint8_aitask_metadata` ✅
  - `20260716020000_sprint8_aitask_metadata_fix` ✅
  - `prisma migrate deploy` reported `No pending migrations to apply` after the fix migration.

---

## 7. Files added / changed

### Added
- `features/decisions/` (6 files, 1,222 LOC) — types, services, repositories, actions, public API barrel
- `lib/ai/schemas/decision-brief.schema.ts` (2,615 B) — Zod contract
- `lib/ai/prompts/decision-brief.ts` (10,772 B) — system + user prompt with fairness clause
- `app/(app)/hiring-requests/[id]/decision/page.tsx` (314 B) — Hub entry
- `app/(app)/hiring-requests/[id]/decision/_components/decision-hub-view.tsx` (657 lines) — Hub UI
- `app/(app)/hiring-requests/[id]/decision/compare/page.tsx` (741 B) — Comparison entry
- `app/(app)/hiring-requests/[id]/decision/compare/_components/comparison-view.tsx` (356 lines) — Side-by-side
- `prisma/migrations/20260716000000_sprint8_decision_hub/migration.sql` — enums + model
- `prisma/migrations/20260716010000_sprint8_aitask_metadata/migration.sql` — AITask.metadata
- `prisma/migrations/20260716020000_sprint8_aitask_metadata_fix/migration.sql` — defensive fix
- `scripts/test-decision-brief.ts` (11 cases)
- `scripts/test-decision-readiness.ts` (11 cases)
- `scripts/e2e-sprint8.ts` (46 cases)
- `scripts/verify-sprint8-prod.ts` (40 cases)
- `features/interviews/` (Sprint 8 part 1 refactor — 11 files, ~1,775 LOC added, 1,118 removed from the old God File)

### Modified
- `prisma/schema.prisma` — `DecisionValue`, `AITaskType`, `ActivityType` extensions, `CandidateDecision` model, `AITask.metadata`, relation wires
- `lib/ai/service/ai-engine.ts` — `generateDecisionBrief()` + `callDecisionBrief()` helper
- `lib/events/types.ts` — `DecisionBriefGeneratedSnapshot`, `CandidateComparisonCreatedSnapshot`, `CandidateDecisionRecordedSnapshot` + 3 new union members
- `app/(app)/candidates/[id]/actions.ts` — `finalDecision`, `hiringRequestId`, `matchScore` on the detail action
- `app/(app)/candidates/[id]/_components/candidate-profile-view.tsx` — `DecisionSection` component
- `app/(app)/hiring-requests/[id]/candidates/_components/workspace-view.tsx` — Decision Hub header CTA
- `features/hiring-requests/components/hiring-requests-table.tsx` — Decision Hub row CTA
- `app/(app)/candidates/[id]/interview-kit/actions.ts` — back-compat shim (now action-specific paths; no `'use server'` re-export of services)
- `features/interviews/index.ts` — per-action re-exports
- `features/interviews/actions/get-interview-data.ts` — removed non-async re-exports from `'use server'` file

---

## 8. What's preserved

- **No redesigned unrelated pages** — the candidate workspace, candidate detail (other than the new Decision section), interview center, dashboard, analytics, etc. are untouched.
- **No new authentication** — the existing middleware still gates everything.
- **No onboarding flow changes** — out of scope.
- **No Offer Generation** — out of scope; the Decision Hub records the decision, the HR follows up with their own offer process.
- **AI provider architecture unchanged** — `lib/ai/service/ai-engine.ts` is the single entry point; the `generateDecisionBrief` method follows the exact same `provider.generate` + Zod-validate + corrective-retry pattern as `generateInterviewKit`. No new providers, no provider changes.
- **All previous sprint data and audit trails preserved** — `Candidate`, `Interview`, `InterviewEvaluation`, `Activity` rows from Sprints 1-7 are untouched.

---

## 9. What's NOT in Sprint 8 (intentionally deferred)

- **Offer generation** — the Decision records SELECTED, but a follow-up offer-letter flow (templates, e-sign, comp) is a separate concern.
- **Multi-stage decision workflows** — `HOLD` and `ADVANCE` are valid `DecisionValue` enum members and the UI can write them, but the post-decision lifecycle (auto re-eval, return-to-pool) is left for a follow-up.
- **Multi-decision-maker approvals** — the schema supports it (a `Decision` could be linked to a chain), but the current flow records the single user who clicks the button.
- **Decision retraction UI** — DB can be updated directly; no in-app "undo" button (out of scope).

---

## 10. Closing notes

Sprint 8 closes the **AI-assisted hiring loop** end-to-end:

```
Sprint 1-2   AI Recruiter wizard → Hiring Request
Sprint 3     Job description
Sprint 4     AI Candidate Workspace + CV parsing + scoring
Sprint 5     Production hardening
Sprint 6     DOCX support, candidate ranking, stage moves
Sprint 6.1   Workspace UX completion
Sprint 7     AI Personalized Interview Kit + structured evaluation
Sprint 8     Decision Hub + AI Decision Brief + side-by-side + human final decision  ← YOU ARE HERE
```

The system now goes from "I have an open role" all the way to "this is the person I selected, here's why, here are the AI's evidence-anchored concerns, here's my decision, and here's the audit trail" — with the AI's role explicitly bounded to decision support, never decision-making.
