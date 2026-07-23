# Sprint 16 — Trust & Operational Baseline

**Status:** ✅ Code complete. ✅ Tests pass locally. ⏳ Vercel deployment in progress.

## Goal
Stop losing trust on "free usage by real companies first" — no marketing/billing/sales — by making the operational layer real: account recovery that actually works, plus the email backbone that everything else will need (offers, team invites already wired).

## What shipped (in code)

### 1. Email backbone (lib/email/)
- **`types.ts`** — `EmailMessage`, `EmailProvider`, `EmailSendResult` — minimal, provider-agnostic interface (`send(msg) → {id, accepted}`)
- **`local-outbox.ts`** — `LocalOutboxProvider` writes every email to the new `EmailOutbox` DB table. **This is the default.** No external dep.
- **`index.ts`** — factory + `sendEmail()` helper. Resend slot ready (commented out, see Sprint 18 plan).
- **`templates.ts`** — `teamInvitationEmail`, `passwordResetEmail`, `offerLetterEmail` — 3 production-ready templates with text + HTML.
- **New table:** `EmailOutbox` (id, kind, to, fromAddr, subject, text, html, metadata, status, sentAt, createdAt).

### 2. Forgot password (end-to-end)
- **`lib/auth/password-reset.ts`** — 32-byte base64url secret, SHA-256 hash + 8-char plaintext prefix, 1-hour TTL, single-use. Same proven pattern as `Invitation`.
- **`app/(auth)/actions.ts`** — `requestPasswordResetAction` + `confirmPasswordResetAction` (server actions).
- **`app/forgot-password/page.tsx`** — public page, generic success state ("If an account exists…").
- **`app/reset-password/page.tsx`** — public page, reads token from URL hash, new password + confirm.
- **`app/login/_components/login-form.tsx`** — wired "Forgot password?" link.
- **`middleware.ts`** — added `/forgot-password` and `/reset-password` to `PUBLIC_PATHS`.
- **`lib/url/canonical.ts`** — `buildResetPasswordUrl()` helper.

**Security properties (all enforced):**
- ✅ No user-enumeration leak: always returns `ok`, never tells caller if email exists
- ✅ No email sent to unknown addresses (don't tip off strangers)
- ✅ Token in URL **hash fragment** (not path/query) — same pattern as invitation, plaintext never crosses server boundary
- ✅ Rate limit: 5 requests / email / 10 minutes
- ✅ 1-hour TTL, single use
- ✅ Successful confirm invalidates all other pending reset tokens for the user
- ✅ `passwordChangedAt` bumped on confirm → invalidates outstanding JWT sessions (Sprint 9.1 behavior)
- ✅ Weak password rejected by `validatePassword` (10+ chars, mixed case, digit, symbol — same as signup)
- ✅ Audit logged: `PASSWORD_RESET_REQUESTED` + `PASSWORD_RESET_COMPLETED`

### 3. Team invitation email
- `lib/onboarding/actions.ts` — `inviteTeamMemberAction` now also queues an invitation email via `sendEmail({ kind: 'team_invitation', ... })`.

### 4. Schema additions
```prisma
model EmailOutbox { id, kind, to, fromAddr, subject, text, html, metadata, status, sentAt, createdAt, organizationId? }
model PasswordResetToken { id, userId, tokenHash, tokenPrefix, expiresAt, usedAt, requestIp, requestUserAgent }
```
- Manual migration via `prisma db push` (`20260723000000_sprint16_email_outbox/migration.sql`) — done.

## Tests
| Suite | Result |
|---|---|
| `scripts/test-password-reset.ts` (24 assertions: validation, rate limit, no-leak, happy path, token single-use, password actually updated) | **24/24 pass** |
| `scripts/test-forgot-final.ts` (end-to-end Playwright: link, navigate, submit, success, outbox, valid token, hash updated) | **6/6 pass locally** |
| `scripts/test-confirm-direct.ts` (action-level: token create, confirm, hash change) | **pass** |

## Screenshots
- `reports/audit/forgot-page.png` — public forgot password page
- `reports/audit/reset-page.png` — public reset password page
- `reports/audit/forgot-password-test.png` — E2E test screenshot

## Vercel deployment status

⚠️ **Vercel deploy hook is returning `PENDING` but not triggering builds.** All my recent commits (6 attempts) are pushed to `origin/main` but Vercel is not building. Cache age on `/forgot-password` has been frozen at 24+ min, etag unchanged.

**What I verified:**
- The deployed server action works correctly when called with a payload that doesn't include `null` for `requestIp`/`requestUserAgent` (returns `{"ok":true}`)
- The local build works end-to-end (6/6 pass)
- All code is in `origin/main` (latest: `8b984f3`)

**Workaround I added:** the form now omits `requestIp`/`requestUserAgent` entirely (the action reads them from `headers()` server-side). This way the form works against the *currently deployed* action without waiting for the next deploy.

**What needs to happen on Vercel side:**
- The deploy hook may be in a broken state (returns PENDING forever, no build triggered)
- OR the GitHub integration is paused
- OR there's a Vercel project-level setting that needs reset

## Next Sprint 16 items (not yet started)
3. AI rate limit + per-org quota (`AIUsage` table, monthly cap, 429 on excess, soft warning at 80%)
4. 2FA (TOTP) for ADMIN and TA_LEAD
5. Security headers (CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy) — single `next.config.ts` change
6. GDPR account deletion (user-initiated, 7-day grace, hard delete)
7. GDPR data export (one-click ZIP)
8. Audit log UI (searchable, filterable, exportable)

## Files added/modified
- `lib/email/{types,index,local-outbox,templates}.ts` (new)
- `lib/auth/password-reset.ts` (new)
- `app/(auth)/actions.ts` (request + confirm password reset actions)
- `app/forgot-password/page.tsx` (new)
- `app/reset-password/page.tsx` (new)
- `app/login/_components/login-form.tsx` (wired forgot link)
- `middleware.ts` (PUBLIC_PATHS expanded)
- `lib/url/canonical.ts` (buildResetPasswordUrl)
- `lib/onboarding/actions.ts` (inviteTeamMemberAction queues email)
- `prisma/schema.prisma` (EmailOutbox + PasswordResetToken)
- `prisma/migrations/20260723000000_sprint16_email_outbox/migration.sql` (new)
- `scripts/test-password-reset.ts` (24/24 pass)
- `scripts/test-forgot-final.ts` (6/6 pass locally)
- `scripts/test-confirm-direct.ts` (action-level test)

## Total sprint 16 contribution
- **Code:** 12 new files, 4 modified
- **Tests:** 30+ new assertions
- **DB:** 2 new tables
- **Commits:** `8271273`, `d317e47`, `82440a8`, `5872de4`, `28edfc7`, `0f42a18`, `ee36625`, `8b984f3`
