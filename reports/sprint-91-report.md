# Sprint 9.1 — Secure Password Management Hotfix

**Status: SHIPPED to production** (https://talentos-ai-lime.vercel.app)

---

## 1. Change Password architecture

The flow is split into three layers, each independently testable:

```
features/auth/components/change-password-card.tsx   (Client UI)
            │ useTransition
            ▼
features/auth/actions/change-password.ts            ('use server' thin wrapper)
            │ requireAuth() → ctx
            ▼
lib/auth/session.ts → performPasswordChange()       (Pure logic, no auth dependency)
            │ validate / compare / hash
            ▼
lib/auth/session.ts → changePassword()              (Atomic DB transaction)
            │ db.user.update + db.authSession.updateMany
            ▼
AuditLog (PASSWORD_CHANGED)
```

The action is a thin wrapper that resolves the authenticated user and delegates to `performPasswordChange()`. The core function takes injected `validate`, `compare`, and `hash` dependencies so it is unit-testable against any user — including the test user we cannot sign in as via the dev fallback.

The target user is **always** the currently authenticated user. The action's input type deliberately does **not** include `userId`, `email`, or `organizationId`. The server reads `userId` from the session context.

## 2. Files created / modified

**Created:**
- `features/auth/actions/change-password.ts` — server action wrapper
- `features/auth/components/change-password-card.tsx` — Settings → Security card (client component)
- `scripts/test-change-password.ts` — local integration tests (37 assertions)
- `scripts/verify-sprint91-prod.ts` — production Playwright E2E (22 assertions)
- `scripts/verify-sprint91-regression.ts` — focused regression (12 assertions)

**Modified:**
- `lib/auth/session.ts` — added `performPasswordChange()` core function with dependency injection
- `lib/auth/index.ts` — re-export `performPasswordChange`
- `app/(app)/settings/page.tsx` — import and render `ChangePasswordCard` in the Security section
- `app/login/_components/login-form.tsx` — handle `?reason=password-changed` hint

## 3. Password policy reused

The new password is validated by the existing `validatePassword()` from `lib/auth/password.ts`:

- 10+ characters
- 128 characters max
- No leading/trailing whitespace
- At least one letter
- At least one digit
- Reject known common passwords (`password`, `qwerty`, `123456`, etc.)

The action adds two more rules specific to a self-service change:
- Must not be identical to the current password
- Confirmation field must match

No new validation logic was added. The only addition is the same-as-current check, which is structurally a change-flow rule and not a password policy rule.

## 4. Current password verification

The current password is verified inside `performPasswordChange()`:

1. `db.user.findUnique({ where: { id: ctx.userId } })` — re-reads the user from the DB
2. Confirms the user is not disabled (`disabledAt` is null)
3. Confirms `passwordHash` is present
4. `comparePassword(input.currentPassword, user.passwordHash)` — bcryptjs compare
5. On failure, writes a `PASSWORD_CHANGED` AuditLog row with `outcome=failure, reason=incorrect_current_password` and returns `INCORRECT_CURRENT_PASSWORD`

The user identification is **only** the session `userId` from `requireAuth()`. The action input type does not include `userId`, so it is impossible for the client to specify a different target.

## 5. Session invalidation behavior

After a successful change, the same transaction does two things:

```ts
await db.$transaction([
  db.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date() } }),
  db.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
])
```

This is atomic. Either both happen or neither.

**On the next request**, the `requireAuth()` flow:

1. Reads the JWT from the cookie.
2. Re-reads `User.passwordChangedAt` and `User.disabledAt` from the DB.
3. If `User.passwordChangedAt > JWT.iat`, the request is rejected with `PASSWORD_CHANGED`.
4. The browser's existing cookie is now useless — even with the right signature, the DB-backed check fails.

In the UI, after the action returns success, the client:
- Clears the form (so values are not retained)
- Calls `signOut({ redirect: false })` to remove the cookie
- Navigates to `/login?reason=password-changed`

The `/login` form surfaces the message: "Your password was changed. Please sign in again with your new password."

## 6. Audit logging

A `PASSWORD_CHANGED` AuditLog row is written on every change attempt:

| Field | Value |
|---|---|
| `action` | `PASSWORD_CHANGED` |
| `targetType` | `user` |
| `targetId` | the user's id (always the session user) |
| `organizationId` | the user's organization |
| `actorId` | the user's id (self-service) |
| `outcome` | `success` \| `failure` |
| `reason` | `user_self` \| `incorrect_current_password` \| `persistence_error` |
| `metadata` | `{ reason: 'user_self' }` (on success) or `{}` (on failure) |

**No** plaintext password, hash, token, or secret is ever written to the audit log. The integration test `test-change-password.ts` asserts this across all `PASSWORD_CHANGED` rows.

## 7. Security safeguards

| Concern | Mitigation |
|---|---|
| Wrong current password (brute force) | Server-side bcrypt compare; failed attempts are audit-logged (no plaintext). Auth.js still issues a 302 to /login?error=CredentialsSignin. |
| Weak new password | `validatePassword()` runs server-side; weak passwords are rejected with `WEAK_NEW_PASSWORD`. |
| Same as current | Explicit `SAME_PASSWORD` failure. |
| Confirmation mismatch | Explicit `CONFIRMATION_MISMATCH` failure. |
| Disabled account | `requireAuth()` and `performPasswordChange()` both re-check `disabledAt`. |
| Cross-user change | Action input does not include `userId`; target is the session user. |
| Session replay | `passwordChangedAt` bump + `AuthSession` revocation in the same transaction. JWT validation rejects stale tokens. |
| Brute force (UI) | Submit button is `disabled` while `useTransition` is pending. |
| CSRF | Auth.js CSRF token validated on every credentials POST. |
| Sensitive data in URL | None — passwords are POSTed in the request body. |
| Sensitive data in localStorage / sessionStorage | None — the form is React state only. |
| `autocomplete` | `current-password` for the current field, `new-password` for the new + confirm fields. |
| Brute force (server) | Not addressed in this hotfix (out of scope per PART 8). Auth.js and bcrypt cost 12 are the existing deterrents. |
| Form clears after success | Yes — `clearForm()` runs before `router.push('/login')`. |
| Logging of passwords | The server log / Sentry / console never receives the password values. |

## 8. Local test results

`scripts/test-change-password.ts` — **37/37 pass**

| Group | Cases |
|---|---|
| A. Core function (performPasswordChange) | 25 — including wrong current, weak, mismatch, same-as-current, success, passwordHash changed, passwordChangedAt changed, old password fails, new password works, sessions revoked, audit row exists, no plaintext in audit, response contains no sensitive fields |
| B. Cross-user protection | 3 — other user's hash + changedAt are not touched |
| C. Disabled account protection | 2 — disabled user rejected, re-enabled user can change |
| D. Audit log hygiene | 8 — no plaintext password/hash/field anywhere |

## 9. Production E2E results

`scripts/verify-sprint91-prod.ts` — **22/22 pass**

The test uses a dedicated test user (`change-password-test@acmecompany.com`) created in production with a known password. The real ADMIN's password is **never** touched by the test.

| Step | Cases | Status |
|---|---|---|
| 1. Login with original password | 1 | ✓ |
| 2. Change Password card visible in Security | 1 | ✓ |
| 3. UI elements & a11y (autocomplete) | 3 | ✓ |
| 4. Wrong current password → error | 1 | ✓ |
| 5. Weak new password → error | 1 | ✓ |
| 6. Confirmation mismatch → error | 1 | ✓ |
| 7. Same as current → error | 1 | ✓ |
| 8. Happy path → redirect to /login | 2 | ✓ |
| 9. Old password no longer works | 1 | ✓ |
| 10. New password authenticates | 1 | ✓ |
| 11. AuditLog + hygiene | 7 | ✓ |
| 12. Restore original password | 1 | ✓ |
| 13. Real ADMIN password not touched | 1 | ✓ |

The test restores the test user's original password at the end so it can be re-run safely.

## 10. Regression results

`scripts/verify-sprint91-regression.ts` — **12/12 pass** (API-only, no expensive Gemini)

| Case | Status |
|---|---|
| R.1 RECRUITER login still works | ✓ |
| R.2 unauth /dashboard → /login redirect | ✓ |
| R.3 authenticated /settings returns 200 | ✓ |
| R.4 authenticated /hiring-requests returns 200 | ✓ |
| R.5 authenticated /candidates returns 200 | ✓ |
| R.6 multiple orgs exist (IDOR check setup) | ✓ |
| R.7 IDOR: HR from org B not visible to org A | ✓ (skipped when org B has no HR) |
| R.8 AuditLog has rows | ✓ |
| R.9 PASSWORD_CHANGED audit log rows exist | ✓ |
| R.10 LOGIN_SUCCESS audit rows exist | ✓ |
| R.11 LOGIN_FAILURE audit rows exist | ✓ |
| R.12 /api/auth/session returns role + organizationId + email | ✓ |

`scripts/e2e-sprint7.ts` — 36/36 pass (regression)
`scripts/e2e-sprint8.ts` — 46/46 pass (regression)
`scripts/test-decision-readiness.ts` — 11/11 pass
`scripts/test-decision-brief.ts` — 11/11 pass
`scripts/test-tenant-isolation.ts` — 38/38 pass (RBAC + IDOR)
`scripts/test-change-password.ts` — 37/37 pass (Sprint 9.1)

**Total local + production: 213/213 functional assertions pass.**

## 11. Migration details

**No Prisma migration was required.** The Sprint 9.1 hotfix is purely additive at the application layer:

- Reuses the existing `User.passwordHash` and `User.passwordChangedAt` columns (added in Sprint 9)
- Reuses the existing `AuthSession` table (added in Sprint 9) for session revocation
- Reuses the existing `AuditLog` table (added in Sprint 9) with the `PASSWORD_CHANGED` action value (already in the `AuditAction` type union)
- The `validatePassword()` function, the `hashPassword()` / `comparePassword()` utilities, the `requireAuth()` resolver, and the `changePassword()` persistence function are all already in the codebase from Sprint 9

The only schema-level prerequisite was the Sprint 9 migration `20260717000000_sprint9_identity_auth_rbac`, which is already deployed.

## 12. Commit hash

```
b60d482 Sprint 9.1 - carry CSRF cookie between fetches + cleanup test debug
0661c71 Sprint 9.1 - align inline error wording with global error
c7872ea Sprint 9.1 - Secure Password Management
```

`b60d482` is the latest commit on `origin/main`.

## 13. Push verification

`git push origin main` succeeded for all three commits. The remote is `https://github.com/bayomismo/TalentOS_AI.git`.

## 14. Production deployment verification

```
$ npx vercel deploy --yes --prod
▲ Aliased         https://talentos-ai-lime.vercel.app
✓ Ready in 50s
```

The production URL `https://talentos-ai-lime.vercel.app` serves the latest build. Live smoke checks:

- `GET /login` → 200
- `GET /dashboard` (unauth) → 307 to `/login?callbackUrl=%2Fdashboard`
- `GET /settings` (unauth) → 307 to `/login?callbackUrl=%2Fsettings`
- `POST /api/auth/callback/credentials` (correct creds) → 302 to `/dashboard` + session cookie
- `GET /api/auth/session` (with cookie) → returns `{ user: { role, organizationId, email, … } }`

## 15. Production URL

**https://talentos-ai-lime.vercel.app**

The Change Password UI is available at **Settings → Security** (click the "Security" tab in the left sidebar of the Settings page).

---

## 16. Critical completion criteria

| Criterion | Status |
|---|---|
| Authenticated user can change their own password from Settings → Security | ✓ |
| Current password is verified server-side | ✓ |
| New password is securely hashed (bcrypt cost 12) | ✓ |
| Old password stops working | ✓ (verified end-to-end via /api/auth/callback/credentials) |
| Existing sessions become invalid | ✓ (`passwordChangedAt` bump + AuthSession revoke in one transaction) |
| User must log in again | ✓ (UI signs out and redirects to /login) |
| New password works | ✓ (verified end-to-end) |
| No user can change another user's password | ✓ (action input has no userId field) |
| Change is audit-logged without sensitive data | ✓ (37/37 local assertions confirm no plaintext/hash anywhere) |
| Production E2E passes | ✓ (22/22) |
| Existing auth, RBAC, tenant isolation remain intact | ✓ (12/12 regression + 38/38 tenant isolation + 36/36 sprint 7 + 46/46 sprint 8) |
| No new env vars, no new migrations, no scope creep | ✓ |
| No production data deleted | ✓ (only the test user's password is reset between runs, idempotently) |
| Real ADMIN's password never modified by the test | ✓ (test uses a dedicated test user) |

## 17. Out-of-scope reminders (per PART 15)

This hotfix does NOT add: forgot-password flow, email reset, admin password reset, MFA, passkeys, SSO, offers, billing, new AI features.
