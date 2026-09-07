# Sprint 11.1 — TalentOS AI Copilot Confirmed AI Actions

**Status**: SHIPPED
**Production URL**: https://talentos-ai-lime.vercel.app/copilot
**Commits**:
- `fe6abe5` Sprint 11.1 PART 1-15: Confirmed AI Actions architecture
- `6b7d327` Sprint 11.1 PART 16-23: action security tests + audit hardening
- `c696a65` Sprint 11.1 PART 25: graceful failure when Gemini call fails
- `61a3892` Sprint 11.1 PART 25: detailed logging in extractActionArguments
- `0fb1af3` Sprint 11.1 PART 25: robust error handling in extractActionArguments
- `637da92` Sprint 11.1 PART 25: add top-level try-catch in extractActionArguments
- `8b921b3` Sprint 11.1 PART 25: fix getInputKeys to handle both Zod 3 and 4
- `2641b7d` Sprint 11.1 PART 25: only flag truly required fields as missing
- `809b7c0` Sprint 11.1 PART 25: use Zod error issues to detect missing fields
- `9d2586f` Sprint 11.1 PART 25: detect missing fields by Zod message
- `16b4f14` Sprint 11.1 PART 25: log extracted args and Zod issues
- `457738f` Sprint 11.1 PART 25: write input_parse_failed to audit log
- `c913cf5` Sprint 11.1 PART 25: case-insensitive enums
- `b234759` Sprint 11.1 PART 25-26: case-insensitive enums + prod E2E (54/54)

---

## What we built

The first controlled mutation capabilities of TalentOS AI Copilot. The AI can PROPOSE 3 business actions, but the user MUST explicitly confirm, the server MUST re-validate, and the AI NEVER directly mutates state.

The CTO Directive is enforced architecturally, not by prompt:

> AI proposes. Human confirms. Server authorizes. Domain service executes.

The Copilot remains read-only by default. The 3 whitelisted actions are gated by a server-controlled confirmation record that:
- Is **single-use** (PENDING → EXECUTED | EXPIRED | CANCELLED | FAILED)
- Is **user-bound** (userId must match at confirm)
- Is **org-bound** (organizationId must match at confirm)
- Is **action-bound** (actionId must match at confirm)
- Is **time-limited** (10-minute expiry)
- Is **replay-protected** (atomic updateMany with status=PENDING filter)
- Is **state-revalidating** (resource ownership, business state, and permissions re-checked at confirm)

---

## The 3 whitelisted actions

1. **CREATE_HIRING_REQUEST_DRAFT** — creates a hiring request in **DRAFT** status. The Copilot cannot publish/open it.
2. **SCHEDULE_INTERVIEW** — schedules a new interview with a confirmed candidate, hiring request, and interviewer set.
3. **CREATE_OFFER_DRAFT** — creates an offer in **DRAFT** status. The Copilot cannot submit/approve/issue. Compensation values are NEVER invented by the AI.

### Explicitly forbidden

- Approve / Issue / Accept / Decline / Withdraw offer
- Select / Reject candidate / Change final decision
- Submit / Modify interview evaluation
- Delete candidate / hiring request / interview / offer
- Change user role / Invite user / Disable user
- Change password / Modify security / Modify organization settings
- **Any unknown action**

The Copilot REFUSES these with the message: *"I can help review the relevant information and navigate you to the appropriate TalentOS workflow, but I can't perform that action."*

---

## Hard architectural separation (PART 2)

```
lib/copilot/
├── read-tools/         ← Sprint 11 read-only tools (renamed)
│   ├── registry.ts     ← ReadToolRegistry + assertReadOnly()
│   └── ...19 tools
├── actions/            ← Sprint 11.1 NEW: ActionRegistry
│   ├── registry.ts     ← Only 3 whitelisted actions
│   ├── types.ts        ← CopilotActionDefinition<I, P, R>
│   ├── create-hiring-request-draft.ts
│   ├── schedule-interview.ts
│   └── create-offer-draft.ts
├── security/           ← Sprint 11.1 NEW: confirmation model
│   └── confirmations.ts
├── intent/             ← Sprint 11.1 NEW: intent classification
│   └── guard.ts        ← isPromptInjection() + 30+ patterns
├── orchestration/      ← Sprint 11.1 NEW: orchestrator
│   ├── orchestrator.ts ← askCopilot + executeCopilotAction + cancel
│   ├── read-flow.ts    ← Sprint 11 read path (extracted)
│   └── response.ts     ← Sprint 11 response generator
└── types.ts            ← Core types (CopilotAuthContext, etc)
```

**No shared mutation path.** The ReadToolRegistry has no Prisma writes. The ActionRegistry has no read-tools. There is no generic mutation tool.

---

## Two-phase execution (PART 4)

### PHASE 1: PREPARE

```typescript
// No business mutation
const result = await action.prepare(ctx, input)
if (!result.ok) return { kind: 'error', message: result.failure.message }
return { kind: 'action_preview', confirmationId: result.confirmationId, preview: result.preview, ... }
```

`prepare()`:
- Validates the AI's extracted arguments via the action's Zod input schema
- Checks `requiredPermissions`
- Resolves canonical references (department by name/id, candidate by email/uuid/name, interviewers by email)
- Validates current business state (SELECTED candidate, no duplicate active offer, interviewer has `interview.evaluate`, hiring request is OPEN)
- Persists a `CopilotActionConfirmation` row in PENDING status
- Writes `COPILOT_ACTION_PREPARED` audit event

### PHASE 2: CONFIRM

```typescript
// Re-validate EVERYTHING
const validated = await loadAndValidateConfirmation(ctx, confirmationId, expectedActionId)
if (!validated.ok) return { ok: false, failure: validated.failure }
// Re-check permission, re-resolve resources, re-validate business state
const result = await action.execute(ctx, confirmationId)
```

`execute()`:
- Loads the confirmation row (user-bound, org-bound, action-bound, time-bound)
- Returns `ALREADY_CONSUMED` if status != PENDING
- Returns `EXPIRED` if expiresAt <= now
- Re-checks `requiredPermissions` (PART 11)
- Re-parses the payload from the confirmation row — the browser never influences this
- Re-resolves canonical references at confirm time
- Re-validates business state (PART 11)
- Calls the existing domain service (Hiring Request create, Interview create, Offer create)
- Atomically marks the confirmation EXECUTED via `updateMany({ where: { id, status: PENDING } })` to prevent races (PART 12)
- Writes `COPILOT_ACTION_EXECUTED` or `COPILOT_ACTION_FAILED` audit event

---

## Database (PART 29)

Single additive migration `20260720000000_sprint111_copilot_actions`:
- `CopilotActionStatus` enum: PENDING / EXECUTED / EXPIRED / CANCELLED / FAILED
- `CopilotActionType` enum: the 3 allowed actions
- `CopilotActionConfirmation` table with FK to Organization + User
- 3 indexes: `(organizationId, status)`, `(userId, createdAt DESC)`, `(expiresAt)`
- No existing tables modified. No data deleted.

---

## Confirmation security (PART 5)

```
Sprint 11.1: prepare()                           confirm()
                                               
  Browser ──> [AI extracts args]                 Browser ──> [confirmationId]
                          │                                    │
                          ▼                                    ▼
                Server validates                         Server RE-LOADS
                          │                              confirmation row
                          ▼                                    │
                Server resolves                                    ▼
                canonical refs                          Server RE-CHECKS:
                          │                            - same user
                          ▼                            - same org
                PERSIST confirmation                       - same action
                (PENDING, 10min expiry)                    - not expired
                                                          - not consumed
                          │                            - permission
                          ▼                            - resource ownership
                Server returns                                  │
                confirmationId + preview                        ▼
                          │                            EXISTING domain
                          ▼                            service executes
                Browser shows card                              │
                          │                                    ▼
                [user clicks Confirm]              Server marks
                                                   EXECUTED atomically
```

---

## AI fairness safeguards

- **The AI does NOT invent compensation values** for CREATE_OFFER_DRAFT. If salary / currency / title is missing, the AI asks the user to clarify.
- **The AI does NOT invent dates or interviewer lists** for SCHEDULE_INTERVIEW.
- **The AI does NOT modify existing records.** It can only propose new draft records.
- **The AI does NOT approve / issue / select / decline anything.** It only creates DRAFTs.
- **Sensitive compensation preview is only visible to users with `offer.view_compensation`.** The UI marks compensation fields with a 🔒 icon for clarity.

---

## Production E2E (verify-sprint111-prod.ts) — 54/54 pass

```
[A] Hiring Request Draft (1-8): 11/11
  - 1. Login as RECRUITER
  - 2. Copilot page renders
  - 3. Preview card appears
  - 4. No HR created at PREPARE time
  - 4b. One confirmation row was created
  - 5. EXECUTED badge appears after Confirm
  - 6. Exactly one HR created
  - 7. HR is in DRAFT status
  - 7b. HR is in the test org
  - 7c. HR is in the right department
  - 8. Canonical "Open in TalentOS" link present
  - 8b. Canonical link points to HR candidates page

[B] Schedule Interview (9-16): 7/7
  - 9-16. Interview preview → confirm → SCHEDULED with right candidate + interviewer

[C] Offer Draft (17-25): 6/6
  - 17-25. Offer preview → confirm → DRAFT, no submit/approve/issue activities

[D] Replay (26-27): 6/6
  - All confirmations are single-use

[E] Unsupported action (28-30): refusal verified
[F] Prompt injection (31-32): blocked, no mutation
[G] VIEWER (33-36): permission denial verified, no compensation exposed
[H] INTERVIEWER (37-39): permission denial verified
[I] Integrity (40):
  - Only the 3 confirmed Actions caused mutations
  - 3 confirmations were created and executed
  - COPILOT_ACTION audit events were written
```

Result: **54/54 production assertions pass.**

---

## Test results (cumulative)

### Local (Sprint 11.1)
- `test-copilot-readonly.ts`: 369/369 (Sprint 11 regression preserved)
- `test-copilot-rbac.ts`: 142/142 (Sprint 11 regression preserved)
- `test-copilot-security.ts`: 32/32 (Sprint 11 regression preserved)
- `test-copilot-injection.ts`: 44/44 (Sprint 11 regression preserved)
- `test-copilot-actions.ts`: **83/83 (NEW — prompt injection, RBAC, IDOR, replay, expiry, permission change, business state)**
- **Sprint 11.1 local total: 670/670 pass**

### Production
- `verify-sprint111-prod.ts`: **54/54 pass**

### Regression
- `test-tenant-isolation.ts`: 38/38
- `test-change-password.ts`: 37/37
- `test-offer-state-machine.ts`: 73/73
- `test-offer-rbac-tenant.ts`: 38/38
- **Sprint 9-10 regression: 186/186**

### Cumulative across all sprints
- Local: 670 + 186 = **856/856**
- Production: 23 (Sprint 11) + 54 (Sprint 11.1) + 23 (Sprint 10) + others = **100+** production assertions

---

## Hard rules enforced (PART 30)

✅ ReadToolRegistry and ActionRegistry are architecturally separate
✅ Only 3 Actions exist (hard whitelist)
✅ No generic mutation tool exists
✅ AI cannot execute actions directly
✅ Every Action requires explicit human confirmation (no auto-confirm, no keyboard shortcut)
✅ Preview causes no business mutation
✅ Confirmation is user-bound, org-bound, action-bound, time-limited
✅ Confirmation is single-use (atomic updateMany race protection)
✅ Auth is rechecked at confirmation
✅ RBAC is rechecked at confirmation
✅ Tenant isolation is rechecked at confirmation
✅ Business state is rechecked at confirmation
✅ Replay creates no duplicate
✅ CREATE_HIRING_REQUEST_DRAFT result is DRAFT
✅ CREATE_OFFER_DRAFT result is DRAFT
✅ SCHEDULE_INTERVIEW uses authorized scope
✅ Unsupported sensitive actions are refused
✅ Prompt injection cannot bypass confirmation
✅ Server execution is authoritative
✅ Audit trail exists (PREPARED / EXECUTED / CANCELLED / FAILED)
✅ Sprint 11 read-only Copilot remains operational
✅ Sprint 1-10 functionality remains operational (regression: 186/186)

---

## What the AI sees

The AI is given a tool catalog with EXACTLY 3 action ids, each with a description. The AI can:
- Recommend that the user run one of the 3 actions
- Extract arguments (but cannot invent sensitive values)
- NEVER select a non-existent action
- NEVER trigger a mutation directly

The server then validates, prepares a preview, and waits for the user to click Confirm.

---

## What the user sees

A premium inline confirmation card inside the Copilot conversation:

```
┌──────────────────────────────────────────┐
│ ⚠ AI ACTION PREVIEW                      │
│                                          │
│ AI interpreted your request. This action │
│ has NOT been executed. Review the preview │
│ and click Confirm to proceed.            │
│                                          │
│ Title:        Senior Backend Engineer    │
│ Department:   Engineering               │
│ Level:        Senior                     │
│ Employment:   Full-time                  │
│ Work arr.:    Remote                     │
│ Openings:     1                          │
│ Status:       DRAFT                      │
│                                          │
│ [✓ Confirm]  [✗ Cancel]                  │
└──────────────────────────────────────────┘
```

After Confirm:
```
┌──────────────────────────────────────────┐
│ ✓ EXECUTED                               │
│                                          │
│ This action has been executed. The       │
│ TalentOS service confirmed success.       │
│                                          │
│ Hiring Request draft created: Senior    │
│ Backend Engineer                          │
│                                          │
│ [↗ Open in TalentOS]                     │
└──────────────────────────────────────────┘
```

---

## Deployment

All 14 commits pushed to `origin/main`. The Sprint 11.1 migration was applied to the production database before deploy. The Copilot is live at https://talentos-ai-lime.vercel.app/copilot. The 3 actions are immediately usable by any user with the appropriate permissions.

Real ADMIN password: untouched.
