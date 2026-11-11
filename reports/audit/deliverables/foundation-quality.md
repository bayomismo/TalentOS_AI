# foundation-quality — type safety + business-flow regression gate

**Agent:** Coder · **Track:** foundation-quality · **Date:** 2026-11-10
**Scope:** FQ-1 (last TypeScript errors) · FQ-2 (`scripts/audit-6-business-flow.ts` + baseline)

> **Provenance note.** The producing agent's session was lost by the runtime mid-task (its run had
> already completed successfully). The owner (plan lead) recovered the real run output from
> `.audit6-run.log` and wrote the baseline and this deliverable from it. Every number below is
> copied from that actual run — nothing here is estimated or reconstructed by hand.

---

## 1. Summary

Cleared the last 7 TypeScript errors in the repo (46 → 0), then built
`scripts/audit-6-business-flow.ts` — a 1,661-line integration suite that asserts the **business
outcomes** of every audited flow against the live database, rather than that a function returned
`ok`. Its first run against production data produced the *before* picture: **8 passed, 48 failed**.

That baseline is the point of the exercise. It independently re-proved the audit's P0 and P1
findings with live evidence and, in several cases, with numbers that are hard to argue with:
`HiringRequest.filled = 0` against **4** actual HIRED candidates; a funnel summing to **38** for
**18** candidates; `startInterviewAction` returning `ok=true` for a **cross-tenant** interview;
and a candidate profile that still does not reference `parsedText` anywhere.

## 2. Files changed

### Modified

| File | Change |
|---|---|
| `scripts/audit-2-integrity.ts` | Added the missing `organizationId` to the `CVFile` select so the tenant-scope assertion type-checks (audit meaning unchanged). |
| `scripts/audit-sprint18-fixes.ts` | `main()` returns `void`, so `.catch(...)` was invalid — removed it. |
| `scripts/dump-reminder.ts` | Added a proper null-guard before dereferencing `row.html`. |
| `scripts/verify-sprint12-blockers-prod.ts` | Added null-guards / early returns for the three `Browser \| null` sites. The script was NOT deleted. |

### Created

| File | Purpose |
|---|---|
| `scripts/audit-6-business-flow.ts` | The business-flow regression gate — 56 stable-ID assertions (A01–A56) across all eight audited flows. Creates uniquely-named fixtures (`audit6-<ts>@example.test`), exercises real server actions, reads back the resulting database state, and cleans up after itself. |
| `reports/audit/audit-6-baseline.md` | The before-picture: 8 passed / 48 failed, the full failing-ID list, the per-assertion live evidence, the assertion-ID ownership map, and the two known-environmental failure groups. |

## 3. Verification

```
$ npx tsc --noEmit -p tsconfig.json
EXIT=0          (0 errors — down from 46)

$ npx tsx --env-file=.env scripts/audit-6-business-flow.ts
...
FINAL: 8 passed, 48 failed
Failing IDs: A01, A02, A04, A05, A06, A07, A08, A09, A10, A11, A12, A13, A14, A15, A16, A17,
A18, A20, A21, A22, A23, A24, A25, A26, A27, A28, A29, A30, A33, A34, A35, A36, A37, A38, A39,
A40, A41, A42, A43, A44, A45, A46, A47, A48, A52, A53, A55, A56

Fixtures removed.
```

Passing IDs: **A03, A19, A31, A32, A49, A50, A51, A54**.

### Live evidence captured (excerpt — full table in `reports/audit/audit-6-baseline.md`)

```
✗ [A01] moveCandidateStageAction rejects APPLIED → HIRED — ok=true stage APPLIED → HIRED
✗ [A02] moveCandidateStageAction rejects HIRED → APPLIED — ok=true stage HIRED → APPLIED
✗ [A04] bulkMoveCandidatesAction sets hiredAt — ok=true stage=HIRED hiredAt=null
✗ [A29] getOfferDetailAction does NOT return draftContent — draftContent is projected outside
        the canComp gate (index 2292 < guard 2493)
✗ [A33] public apply attaches to the bound requisition — expected=401f3184… chosen=1dfb70a4… chosenStatus=DRAFT
✗ [A36] rate limit keyed on a server-derived IP — serverDerived=true clientHeaderPreferred=true
✗ [A37] /onboarding/done does NOT complete onboarding — the completion path never looks at onboardingStep
✗ [A38] onboarding transition failure surfaced — a caller still discards the result with .catch(() => null)
✗ [A39] org cannot be fully onboarded with no config — onboardingStatus=COMPLETED country=null timezone=null industry=null
✗ [A40] accept-invite returns an error, not a crash — threw: account_already_active
✗ [A45] analytics hire count matches actual — reported=NaN actual=4
✗ [A46] hiring-request filled equals actual — filled=0 actualHired=4
✗ [A47] funnel denominators do not double-count — sum(funnel)=38 candidates=18
✗ [A48] candidate list renders REJECTED/WITHDRAWN distinctly — rejected=applied withdrawn=applied
✗ [A53] CV parsed text IS rendered — no candidate UI component references parsedText
✗ [A55] no bare catch in email send sites — bare catch in: app/(public)/jobs/[slug]/apply-action.ts
✗ [A56] startInterviewAction rejects an unauthorized caller — ok=true startedAt=2026-11-10T15:06:40.825Z
```

### The two known-environmental failure groups (NOT defects)

1. **A21–A30, A34, A52** — the suite printed at startup:
   > ⚠ SCHEMA DRIFT: the database is behind the generated Prisma client — missing
   > `CandidateDecision.supersedesId`, `Offer.supersededAt`, `Application` (table).

   The migration has not been deployed yet (the integration gate owns that). These assertions
   **must be re-run after the migration is applied** and are expected to pass then.

2. **A52** additionally needs `EmailOutbox.provider`, which the same migration adds.

## 4. Out-of-scope changes

None. This task touched only `scripts/**` and `reports/audit/**`.

## 5. Not done

- The **migration was not applied** — deliberately. The integration gate owns `prisma migrate deploy`
  against the live Neon database.
- `next.config.ts` was **not** flipped to `ignoreBuildErrors: false` here — it belongs with the
  authoritative build in the integration gate, so the flip and the build happen together.
- The offer assertions (A21–A30) were **not** individually debugged here; they were blocked by the
  schema drift above. They are the `fix-offers` track's target and the integration gate's final gate.

## 6. Handoffs

**To `fix-candidates`:** A01, A02, A04, A48 are yours. A01/A02 prove `moveCandidateStageAction`
accepts illegal transitions *and* terminal-state resurrection today. Route every stage write
through `transitionCandidateStage` from `lib/candidates/transition.ts`.

**To `fix-process`:** A05–A20 and A56 are yours. A56 is a **confirmed live cross-tenant write** —
`startInterviewAction` mutated an interview belonging to another organization. A05 shows
`recordDecisionAction` returning `code=INTERNAL` (it threw) rather than a clean guard.

**To `fix-offers`:** A21–A30 are yours, but **they cannot pass until the migration is applied**.
A29 already proves `draftContent` is projected outside the `canComp` gate.

**To `fix-public-apply`:** A33–A42, A52, A55 are yours. A33 proves public apply attaches to a
**DRAFT** requisition and the wrong one of two; A37/A38/A39 prove the onboarding completion path
ignores `onboardingStep` and that a transition failure is swallowed; A40 proves accept-invite
**throws** rather than returning an error.

**To `fix-reporting`:** A43–A50 and A53 are yours. A45/A46/A47 give you the exact numbers to
reproduce against (`NaN` vs 4, `0` vs 4, `38` vs 18).

**To the integration gate (owner):**
1. Apply `prisma/migrations/20261110000000_audit_business_flow_fixes/migration.sql` **before** the
   final `audit-6` run, or the offer track cannot be verified.
2. `audit-6-business-flow.ts` must reach **56 passed, 0 failed**. Do not weaken assertions.
3. Extend `scripts/e2e-hiring-flow.ts` to assert the hire-on-accept end state
   (`stage === 'HIRED'`, `hiredAt` set, `filled === 1`). It does not assert that today, which is
   precisely why P0-01 survived.
4. Flip `next.config.ts` to `typescript: { ignoreBuildErrors: false }` — the build has had **zero**
   type checking for the project's entire history, which is how the `stageUpdated` defect from
   commit `09d4dbb` shipped unnoticed.
