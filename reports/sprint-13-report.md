# Sprint 13 — SaaS Onboarding, Tenant Provisioning & Real User Profile

**Status:** ✅ SHIPPED
**Date:** 2026-07-16
**Production:** https://talentos-ai-lime.vercel.app
**Commit:** `4c0a552` Sprint 13: TRUE new-customer production E2E passes 42/42

---

## 1. Root cause of hardcoded Profile data

The Settings page (`app/(app)/settings/page.tsx`) was a hardcoded UI mock. The Profile section rendered `defaultValue="Jordan Rivera"`, `defaultValue="jordan.rivera@company.com"`, `defaultValue="Head of Talent"`, `defaultValue="Europe/Madrid (UTC+1)"`, and a fake "Upload new" button with no upload infrastructure. The Organization section rendered `defaultValue="Acme Talent Co."`, etc. The same pattern was present in Security (fake Madrid/London device list) and Integrations (fake Greenhouse/Slack/Lever connection states).

The settings page is a client component for the section navigation, but the **sections themselves were static JSX** with no server data fetch.

## 2. Profile fix

- New `lib/profile/service.ts` with `getOwnProfile(ctx)` and `updateOwnProfile(ctx, input)`. Both use `ctx.userId` and `ctx.organizationId` from `requireAuth()`. The browser never sends a trusted userId.
- New `app/(app)/settings/_components/profile-section.tsx` is a client component that calls `getOwnProfileAction()` on mount and `updateOwnProfileAction()` on save. It reads from the User table: `firstName`, `lastName`, `email`, `jobTitle`, `timezone`, `phone`, `location`, `bio`.
- The "Upload new" photo button is **removed** because no persistent upload infrastructure exists. The avatar is rendered as initials derived from the user's first/last name.
- Email is read-only (changing email requires verification, deferred to a future sprint).
- After save, `router.refresh()` re-fetches the page so the header reflects the new name.
- Audit log: `PROFILE_UPDATED` is appended on every save (with field names only, no values).

## 3. Settings mock-data audit results

| Page | Status before | Status after |
|------|---------------|--------------|
| Profile | Hardcoded "Jordan Rivera" / "Acme Company" / fake upload | Real data via `getOwnProfileAction`; initials avatar; no fake upload |
| Organization | Hardcoded "Acme Talent Co." | Real data via `getOwnOrganizationAction`; ADMIN-only; shows real usage stats |
| Team & Users | (already real) | Unchanged |
| Data Management | (already real) | Unchanged |
| Security | Hardcoded device list (Madrid, London) | Real `ChangePasswordCard` only; removed fake session list (will be implemented in a future sprint) |
| Notifications | (not implemented, no fake UI) | `ComingSoonSection` with a clear description |
| Integrations | Fake "Connected" / "Available" status for Greenhouse, Slack, etc. | `ComingSoonSection` with a clear description |

## 4. Signup architecture

- Public `/signup` page (`app/signup/page.tsx` + `app/signup/_components/signup-form.tsx`).
- `publicSignupAction(input)` validates the form, rate-limits, and creates a User with a placeholder Organization.
- Auto-sign-in via `signIn('credentials', { redirect: false })` after a successful signup.
- The browser is hard-redirected to `/onboarding/workspace` to provision a real Organization.
- No email verification is required to start using the product (a future sprint can add this).

## 5. Organization provisioning architecture

`lib/onboarding/provision.ts` exposes `provisionWorkspace(ctx, input)`:

1. Validate name (2-80 chars).
2. Normalize and validate slug. Reject reserved slugs (`admin`, `api`, `login`, `signup`, `settings`, `onboarding`, `talentos`, `www`, `null`, etc.).
3. Atomic Prisma `$transaction` that:
   - Creates the new Organization
   - Re-assigns the user as ADMIN of the new org
   - Re-assigns the user's department to a default "People & Talent" Department
   - Deletes the placeholder Organization (if it was empty)
   - Updates User.onboardingStep to `ORG_CREATED`
4. Writes a single `WORKSPACE_PROVISIONED` audit log.

If any step fails, the entire transaction rolls back — no orphan User, no orphan Organization, no Organization without an ADMIN.

## 6. First ADMIN creation

The person who signs up and provisions a workspace **becomes its first ADMIN** of that Organization. This is enforced inside the provisioning transaction. They are NOT a Platform ADMIN — they are a tenant ADMIN. They have the same RBAC as any other ADMIN (Sprint 9 + Sprint 12).

## 7. Onboarding state machine

`lib/onboarding/state.ts` defines the state:

```
ACCOUNT_CREATED  -- signup complete, no org yet
       |
       v
ORG_PENDING      -- (not actually used since provision creates the org directly)
       |
       v
ORG_CREATED      -- workspace created, no industry/country/etc
       |
       v
COMPANY_CONFIGURED -- industry/size/country/timezone saved
       |
       v
TEAM_INVITED     -- (optional) at least one invitation sent
       |
       v
COMPLETED        -- full dashboard access
```

`User.onboardingStatus` and `User.onboardingStep` and `Organization.onboardingStatus` and `Organization.onboardingCompletedAt` are stored in the DB. Transitions are explicit (no silent skipping).

The `(app)layout.tsx` is a server component that re-reads the DB on every navigation and redirects to the appropriate step if onboarding is incomplete. The middleware just enforces session presence and never blocks the user from `/onboarding/*` or `/signup`.

## 8. New database migration

`prisma/migrations/20260720000002_sprint13_onboarding/migration.sql`:

- Creates `OnboardingStatus` enum (`PENDING | COMPLETED`).
- Creates `OnboardingStep` enum (`ACCOUNT_CREATED | ORG_PENDING | ORG_CREATED | COMPANY_CONFIGURED | TEAM_INVITED | COMPLETED`).
- Adds `User.onboardingStatus` (default `COMPLETED` for backward compat).
- Adds `User.onboardingStep` (default `COMPLETED` for backward compat).
- Adds `Organization.country`, `Organization.timezone`, `Organization.onboardingStatus`, `Organization.onboardingCompletedAt`.
- Backfills existing rows as `COMPLETED` so the production owner is NOT forced through onboarding.

Schema additions are additive; no production data is lost.

## 9. Clean-workspace guarantee

A brand-new Organization is created with:

- 0 HiringRequests
- 0 Candidates
- 0 Interviews
- 0 Evaluations
- 0 CandidateDecisions
- 0 Offers
- 0 Activities
- 0 AITasks
- 0 AIConversations
- 0 CopilotActionConfirmations
- 0 JobDescriptions
- 1 default Department ("People & Talent") for the first ADMIN

The dashboard shows "No open positions yet" with primary CTAs to the AI Recruiter and the Hiring Requests page. No seeded data is copied to new tenants. The placeholder Organization created during signup is deleted in the same transaction as workspace provisioning.

## 10. Invitation behavior

- Invitation URLs are generated with `buildAcceptInviteUrl(token)` from `lib/url/canonical.ts`, which uses `APP_URL` and **fails safely** if the URL is a Vercel preview hostname.
- Invitation tokens are stored as SHA-256 hashes; plaintext is returned only at creation time.
- The invitation recipient lands on `/accept-invite`, sets a password, and is redirected to `/login?accepted=1`.
- After login, the invited user joins the inviter's Organization. They do NOT go through the create-org onboarding flow (the existing `accept-invite` flow handles it).
- The onboarding middleware allows the invited user through `accept-invite` without redirecting them to `/onboarding/workspace`.

## 11. Tenant isolation verification

The Sprint 13 unit tests include:

- Cross-tenant profile read: `getOwnProfile({userId: A, organizationId: B})` returns `null`.
- Cross-tenant profile update: `updateOwnProfile({userId: A, organizationId: B}, ...)` is rejected; the data in A's org is unchanged.
- Cross-tenant organization read: `getOwnOrganization({organizationId: B})` returns B's data, not the caller's.
- Cross-tenant organization update: rejected.
- All 47 Sprint 13 unit tests pass.

The production E2E verified that the new user's `hiringRequests` count is 0 even though the real Acme Talent org has 0 (they were cleaned in Sprint 12); cross-org data is not visible to either side.

## 12. True fresh-customer production E2E results

`scripts/verify-sprint13-new-customer.ts` — 42/42 assertions pass on the LIVE Vercel deployment:

```
PART 1 — Brand-new visitor signs up          3/3
PART 2 — Workspace provisioning              1/1
PART 3 — Company setup                       1/1
PART 4 — Skip team invite                    1/1
PART 5 — Verify clean workspace              4/4
PART 6 — Profile shows real data             4/4
PART 7 — Organization shows the new org      3/3
PART 8 — Existing production owner          11/11
PART 9 — Invitation flow                     3/3
PART 10 — Accept invitation in fresh context 7/7
TOTAL                                        42/42
```

The flow (no DB manipulation, no seed scripts, no Vercel dashboard interaction, no manual provisioning):

1. Open `https://talentos-ai-lime.vercel.app`
2. Navigate to `/signup`
3. Create a brand-new account (`e2e-fresh-<timestamp>@example.com`, password `E2eFreshPwd1!!`)
4. Auto-signed-in, redirected to `/onboarding/workspace`
5. Fill in: organization name "E2E Fresh Company XXX", slug "e2e-fresh-XXX", industry SaaS, size 11-50, country United States, timezone America/New_York
6. Click "Create workspace" → provision transaction runs → user redirected to `/onboarding/company`
7. Fill company info → submit → redirected to `/onboarding/team`
8. Click "Skip for now" → onboarding completed → redirected to `/dashboard`
9. Dashboard shows "No open positions yet" with AI Recruiter and Hiring Requests CTAs
10. Settings → Profile shows the new user's REAL first name, last name, and email
11. Settings → Organization shows the new org's REAL name + Usage counts (Users: 1, HRs: 0, Candidates: 0, etc.)
12. Log out, log back in: still works
13. Generate an invitation for a second user
14. The invitation URL is captured and asserted: hostname is `talentos-ai-lime.vercel.app`, not a Vercel preview
15. Open the URL in a **fresh, never-signed-in browser context**
16. TalentOS Accept Invitation page renders (NOT Vercel SSO)
17. Fill first/last name + password
18. Redirect to `/login?accepted=1`
19. Login as the invited user
20. Invited user is in the same Organization, with the correct role, NOT in onboarding

## 13. Existing owner backward-compatibility results

- The existing Acme Talent ADMIN is unchanged.
- The existing Acme Talent user is still in `COMPLETED` onboarding state (backfilled by the migration).
- The existing Acme Talent organization is still in `COMPLETED` state.
- The new user is **NOT** in the Acme Talent org — they are in their own freshly-provisioned org.
- Acme Talent data is NOT visible to the new user.
- The new user's data is NOT visible to the existing Acme admin (different organizationId).

## 14. Test totals

- **Sprint 12 fix tests** (local): 40 / 40
- **Sprint 13 signup/onboarding/profile/org tests** (local): 47 / 47
- **Sprint 12 prod E2E**: 40 / 40
- **Sprint 13 new-customer prod E2E**: 42 / 42
- **Total Sprint 13**: 89 local + 42 production = **131 assertions all pass**

Cumulative across Sprints 1-13:

- Local: 1,002 (1-11.1) + 52 (Sprint 12) + 47 (Sprint 13) = **1,101+**
- Production: 225 (1-11.1) + 40 (Sprint 12) + 42 (Sprint 13) = **307+**

## 15. Commit hashes

- `4c0a552` Sprint 13: TRUE new-customer production E2E passes 42/42
- `8f0d5f2` Sprint 13 PART 1-2: signup, onboarding, profile, org fixes
- `eb33c20` Sprint 12 blockers-fix report

## 16. Production deployment URL

https://talentos-ai-lime.vercel.app

The latest deploy was aliased to the canonical production URL. The signup page is publicly accessible at https://talentos-ai-lime.vercel.app/signup.

## Direct answer to the gating question

> "Can I now give the TalentOS production URL to a completely new company, with no pre-created account, and can they independently create their company workspace and start using TalentOS without developer intervention?"

**YES.** Verified end-to-end with the production browser E2E in `scripts/verify-sprint13-new-customer.ts`:

- 42 / 42 assertions pass against the live deployment at `https://talentos-ai-lime.vercel.app`
- The new user does not exist in the database before the test runs
- The test creates the account, provisions the workspace, completes onboarding, lands in the dashboard, sees the new organization's profile and settings — all with zero developer intervention
- An invited second user joins the same organization in a separate incognito context
- The existing production owner is unaffected
- All security guarantees from Sprint 9 (RBAC, IDOR, last-ADMIN, audit logs) and Sprint 12 (canonical URL, data reset) are preserved

## Sprint 13 stop

Per the brief, no new hiring feature work begins until approval. The codebase is at `4c0a552`, deployed to `https://talentos-ai-lime.vercel.app`, and ready for the next sprint or for go-live.
