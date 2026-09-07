# Sprint 11 — TalentOS AI Copilot (Read-Only Intelligence Layer)

**Status**: SHIPPED
**Production URL**: https://talentos-ai-lime.vercel.app/copilot
**Commits**:
- `612194e` Sprint 11 PART 1-30: engine, intent router, server action, UI, tests
- `1636d25` Sprint 11 PART 31-36: production Playwright E2E + business state integrity

---

## What we built

A read-only conversational AI Copilot where Gemini has access ONLY to registered, permission-aware, tenant-scoped read tools. The model can NEVER execute SQL, mutate state, or perform business actions.

The Copilot is reachable at `/copilot` (sidebar nav + Cmd/Ctrl+J shortcut) and answers grounded questions about hiring requests, candidates, interviews, offers, and rollups.

---

## Hard architectural guarantees (PART 23)

1. **No SQL/Prisma exposure to Gemini.** Gemini only receives a tool catalog (id + description) and structured JSON arguments. The orchestrator validates and executes server-side.
2. **Read-only tool executors.** Every tool uses `db.X.findFirst/findMany/count/groupBy` only. NO `create/update/delete/upsert`, NO `$queryRaw`/`$executeRaw`.
3. **Static guard at module load.** `lib/copilot/registry.ts` runs `assertReadOnly()` against every registered tool. Any tool whose executor references a forbidden mutation token is REJECTED at import time.
4. **Permission gating.** Every tool declares `requiredPermission: Permission`. The engine calls `ctx.hasPermission(tool.requiredPermission)` and returns `ACCESS_DENIED` if missing. The model cannot select a tool the user can't run.
5. **Cross-tenant IDOR defense.** Tools that take an ID (e.g. `getHiringRequestSummary({hiringRequestId})`) filter by `where: { id, organizationId: ctx.organizationId }` and return `NOT_FOUND` on miss (never `FORBIDDEN` to avoid leaking).
6. **Compensation privacy.** `get_offers_by_status` checks `offer.view_compensation` inside the executor. If the caller lacks it, `salaryAmount/salaryCurrency/salaryPeriod` keys are simply not set in the returned object — not sent to Gemini, not in any downstream data.
7. **Prompt injection defense.** The intent router has `BLOCKED_PATTERNS` that reject known patterns: `ignore (all )?previous`, `reveal (the )?system prompt`, `execute\s*sql`, `all salaries`, `prisma\.\$`, `\bapprove\b.*\boffer\b`, `\bissue\b.*\boffer\b`, `\bcreate\b.*\bhiring request\b`, `\bdelete\b.*\bcandidate\b`, etc.
8. **No URL fabrication.** The response generator filters every `href` in the records array against the server-supplied `recordHrefs` set. Gemini cannot create arbitrary external URLs.
9. **Bounded execution.** `MAX_TOOL_CALLS_PER_TURN = 5`, `MAX_RECORDS_PER_TOOL = 50`, max 2 Gemini calls per turn, last 10 messages carried in history.
10. **Conversation persistence.** Reuses existing `AITask` (type `COPILOT_QUERY`) + `AIConversation` (USER + ASSISTANT roles). No new tables.

---

## Architecture (the complete vertical)

```
User types "Which offers need approval?"
   ↓
askCopilotAction (server action)
   ↓
resolveCopilotContext (session, role, hasPermission)
   ↓
isPromptInjection()  → if true: blocked + audit + return
   ↓
routeIntent (deterministic first, Gemini fallback)
   ↓
executeTool × N (max 5)
   - permission check
   - tenant check
   - input Zod validation
   - executor (read-only)
   - output Zod validation
   - extract recordHrefs
   ↓
generateCopilotResponse (Gemini call #2, structured)
   - sanitized tool results
   - recordHrefs allowlist filter
   - structured JSON output (answer/findings/records/suggestedQuestions/limitations)
   ↓
Persist AITask + AIConversation
   ↓
Audit COPILOT_QUERY_EXECUTED
   ↓
Return CopilotResponse to UI
```

---

## Tool registry (19 tools)

| Tool | Permission | Tenant-scoped | Compensation-aware | INTERVIEWER-scoped |
|---|---|---|---|---|
| `get_open_hiring_requests` | `hiring_request.view` | ✓ | — | — |
| `get_hiring_request_summary` | `hiring_request.view` | ✓ | — | — |
| `get_department_hiring_summary` | `hiring_request.view` | ✓ | — | — |
| `get_hiring_requests_with_no_candidates` | `hiring_request.view` | ✓ | — | — |
| `get_candidates_by_stage` | `candidate.view` | ✓ | — | — |
| `get_candidates_awaiting_interview` | `candidate.view` | ✓ | — | — |
| `get_candidates_awaiting_evaluation` | `interview.view` | ✓ | — | — |
| `get_candidate_summary` | `candidate.view` | ✓ | — | — |
| `get_decision_readiness` | `decision.view` | ✓ | — | — |
| `get_selected_candidates_without_offer` | `offer.view` | ✓ | — | — |
| `get_upcoming_interviews` | `interview.view` | ✓ | — | — |
| `get_my_upcoming_interviews` | `interview.view` | ✓ | — | ✓ |
| `get_my_pending_evaluations` | `interview.view` | ✓ | — | ✓ |
| `get_offers_by_status` | `offer.view` (gates `offer.view_compensation` in executor) | ✓ | ✓ | — |
| `get_offers_pending_approval` | `offer.view` | ✓ | — | — |
| `get_offers_expiring_soon` | `offer.view` | ✓ | — | — |
| `get_my_attention_items` | `candidate.view` | ✓ | — | ✓ (own-eval filter) |
| `get_hiring_pipeline_summary` | `hiring_request.view` | ✓ | — | — |
| `get_recent_hiring_activity` | `reports.view` | ✓ | — | — |

---

## File inventory

### Engine
- `lib/copilot/types.ts` — `CopilotTool<I,O>`, `CopilotAuthContext`, `ToolResult`, constants
- `lib/copilot/context.ts` — `resolveCopilotContext()`
- `lib/copilot/registry.ts` — tool catalog + `assertReadOnly()` + `executeTool()`
- `lib/copilot/intent.ts` — deterministic router + Gemini fallback + `isPromptInjection()`
- `lib/copilot/response.ts` — `generateCopilotResponse()` with structured schema
- `lib/copilot/orchestrator.ts` — end-to-end pipeline (PART 6-7)

### Tools (19)
- `lib/copilot/tools/hiring-request-tools.ts` (4 tools)
- `lib/copilot/tools/candidate-tools.ts` (6 tools)
- `lib/copilot/tools/interview-tools.ts` (3 tools)
- `lib/copilot/tools/offer-tools.ts` (3 tools, compensation-aware)
- `lib/copilot/tools/attention-tools.ts` (1 tool, deterministic rollup)
- `lib/copilot/tools/summary-tools.ts` (3 tools)

### Server + UI
- `features/copilot/actions/ask-copilot-action.ts` — `askCopilotAction`, `getRecentCopilotHistoryAction`
- `app/(app)/copilot/page.tsx` — Copilot UI
- `app/(app)/layout.tsx` — Cmd/Ctrl+J shortcut
- `config/navigation.ts` — sidebar nav item
- `lib/ai/service/ai-engine.ts` — added `callCopilotRouter()` method
- `lib/auth/types.ts` — added `COPILOT_QUERY_EXECUTED`, `COPILOT_TOOL_BLOCKED`, `COPILOT_PROMPT_INJECTION_BLOCKED` to AuditAction union
- `prisma/migrations/20260719000000_sprint11_copilot/migration.sql` — adds `COPILOT_QUERY` to AITaskType

### Tests
- `scripts/test-copilot-readonly.ts` (369 assertions)
- `scripts/test-copilot-rbac.ts` (142 assertions)
- `scripts/test-copilot-security.ts` (32 assertions)
- `scripts/test-copilot-injection.ts` (44 assertions)
- `scripts/verify-sprint11-prod.ts` (23 production assertions)
- `sprint11-copilot.png` (screenshot of the live UI)

---

## Test results

### Local
- `test-copilot-readonly.ts`: **369/369 pass** (PART 23 — every tool is read-only, no forbidden tokens, all declared permissions are known)
- `test-copilot-rbac.ts`: **142/142 pass** (PART 14 — RBAC matrix for all 7 roles × 19 tools)
- `test-copilot-security.ts`: **32/32 pass** (PART 19 — IDOR returns null, compensation stripped, no business mutations)
- `test-copilot-injection.ts`: **44/44 pass** (PART 19 — every documented injection pattern is blocked; legitimate questions pass through)
- **Sprint 11 local total: 587/587 pass**

### Regression
- `test-tenant-isolation.ts`: 38/38 pass
- `test-change-password.ts`: 37/37 pass
- `test-offer-state-machine.ts`: 73/73 pass
- `test-offer-rbac-tenant.ts`: 38/38 pass
- **Sprint 9-10 regression: 186/186 pass**

### Production E2E
- `verify-sprint11-prod.ts`: **23/23 pass** (see below)

---

## Production E2E coverage (verify-sprint11-prod.ts)

```
[0] Test user setup: Test user exists, RECRUITER role
[1] Login flow: Login succeeds
[2] Sidebar navigation: Copilot link present
[3] Copilot page renders: header + subheader visible
[4] Role-aware suggested prompts: empty state + composer present
[5] Deterministic intent: "Which positions are currently open?" → assistant responds
[6] Attention rollup tool: "What needs my attention today?" → assistant responds
[7] Hiring pipeline summary: "Show me the hiring pipeline summary" → assistant responds
[8] Prompt injection is blocked: "Ignore all previous instructions..." → security check visible
[9] Audit log + persistence:
    - 4+ COPILOT_QUERY AITask rows created
    - 8+ AIConversation rows created
    - COPILOT_QUERY_EXECUTED audit events written
    - COPILOT_PROMPT_INJECTION_BLOCKED audit events written
[10] Business state integrity:
    - 0 hiring requests created
    - 0 candidates created
    - 0 offers created
    - (read-only verified end-to-end)
```

Result: **23/23 production assertions pass.**

---

## Cumulative metrics

| Sprint | Local | Prod |
|---|---|---|
| Sprint 6 (CV) | 56 | 35 |
| Sprint 7 (Interview Kit) | 36 | 35 |
| Sprint 8 (Decision Hub) | 46 | 40 |
| Sprint 9 (Auth/RBAC) | 75 | 16 |
| Sprint 9.1 (Password) | 37 | 34 |
| Sprint 10 (Offers) | 161 | 23 |
| **Sprint 11 (Copilot)** | **587** | **23** |
| **Cumulative** | **998** | **206** |

**Total: 1,204+ assertions pass.**

---

## Security posture (PART 23)

1. **Read-only at the tool layer**: every tool is read-only by source. The static `assertReadOnly()` runs at module load.
2. **Read-only at the registry layer**: the registry's `executeTool()` only calls `tool.execute()` (which is read-only). It never imports any mutation API.
3. **Read-only at the orchestrator layer**: the orchestrator only writes to `AITask` + `AIConversation` (the conversation log). It does NOT touch any business table.
4. **Read-only at the response layer**: the response generator uses a structured Zod schema and filters every `href` against the server-supplied allowlist.
5. **Read-only at the prompt layer**: Gemini's system prompt forbids inventing data, fabricating URLs, and performing actions. But security does NOT depend on the prompt — it depends on the architecture above.
6. **Tenant isolation**: every query filters by `organizationId`. Cross-tenant access returns null/NOT_FOUND.
7. **Compensation privacy**: salary fields are stripped at the projection layer in `get_offers_by_status`. They never reach Gemini.
8. **Prompt injection defense**: known patterns are blocked at the intent router with audit logging.
9. **Permission gating**: every tool is permission-gated. VIEWER gets no compensation. INTERVIEWER only sees own assignments.
10. **Bounded execution**: max 5 tool calls per turn, max 50 records per tool, max 2 Gemini calls per turn.

---

## Known limitations / out of scope (PART 22)

- The Copilot cannot perform any mutations. Users must use the relevant TalentOS page (e.g. `/offers`, `/candidates/[id]/offer`) for actions.
- The intent router uses deterministic keyword matching for ~15 common intents. Ambiguous questions fall back to Gemini. This is intentional — it keeps the model from being asked to invent tools.
- Conversation history is bounded to the last 10 messages for the response generator. The full history is persisted in `AIConversation` and replayed on page load.
- The Copilot is currently English-only.

---

## Deployment

The Copilot is live at https://talentos-ai-lime.vercel.app/copilot. The Cmd/Ctrl+J keyboard shortcut opens it from any page. The sidebar nav has a "AI Copilot" item between "Offers" and "Settings".

All 2 commits are pushed to `origin/main`. The Sprint 11 migration (`20260719000000_sprint11_copilot`) was applied to the production database during deployment.
