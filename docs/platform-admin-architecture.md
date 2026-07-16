# Platform Admin Architecture (Sprint 13 Future Work)

**Status:** 📐 Designed, not implemented. Documented for future sprint.

## Why this document exists

Sprint 13 introduces a true multi-tenant SaaS architecture. The first ADMIN of a freshly provisioned organization is a **tenant ADMIN** — they own and operate their own workspace, and they cannot reach into other tenants.

Sprint 13 also introduces a future need: **platform-level administration** for the TalentOS operator (the company running the TalentOS service). This is a different role from a tenant ADMIN. It is NOT a "super tenant". It lives at the SaaS-platform layer, above all tenants.

This document specifies the architecture so it can be implemented safely in a future sprint. It does **not** introduce code in this sprint; it only defines the rules so a future implementer does not accidentally create a cross-tenant data-exposure backdoor.

## Core principles

1. **Tenant ADMIN ≠ Platform ADMIN.** A Platform ADMIN is a separate role bound to a separate identity layer. It is never a user record inside a tenant.
2. **No silent cross-tenant browsing.** Every Platform-Admin action that touches tenant data MUST be wrapped in an audit event and MUST be subject to a confirmation step.
3. **Tenant isolation is sacred.** Existing tenant isolation guarantees (Sprint 9, Sprint 12) MUST NOT be weakened. A Platform ADMIN does NOT have raw `db.organization.findMany()` access via the application code; all platform actions go through audited, explicit APIs.
4. **Impersonation is explicit.** A Platform ADMIN may impersonate a tenant ADMIN to debug a customer issue. The impersonation session is short-lived, fully audited, and the tenant sees a banner.
5. **Billing and lifecycle are first-class.** Suspension, deletion, plan changes, and seat counts are all first-class state machines.

## Identity

### Identity provider

Platform ADMINs are NOT created through the public `/signup` flow. They are created out-of-band by existing Platform ADMINs through a dedicated Platform Console (a separate application, or a separate route group guarded by an `isPlatformAdmin` claim).

The `isPlatformAdmin` claim is a JWT claim on a separate token issued by a separate authentication flow (e.g. a TOTP-required login at `auth.talentos.com/platform`).

### Database

Platform ADMINs are stored in a separate table:

```prisma
model PlatformAdmin {
  id                  String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email               String   @unique
  passwordHash        String?
  totpSecret          String?
  totpEnabled         Boolean  @default(false)
  role                PlatformRole  // PLATFORM_OWNER | PLATFORM_SUPPORT | PLATFORM_BILLING | PLATFORM_SECURITY
  status              PlatformAdminStatus // ACTIVE | SUSPENDED | OFFBOARDED
  lastLoginAt         DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

enum PlatformRole {
  PLATFORM_OWNER       // full access including billing and lifecycle
  PLATFORM_SUPPORT     // read-only across tenants, can impersonate
  PLATFORM_BILLING     // billing-only access
  PLATFORM_SECURITY    // security-only access: audit, sessions, suspensions
}

enum PlatformAdminStatus {
  ACTIVE
  SUSPENDED
  OFFBOARDED
}
```

A Platform Admin's `id` is NEVER the same as a `User.id`. There is no FK from a `User.organizationId` to a `PlatformAdmin`. They are two disjoint identity layers.

## Tenant impersonation rules

When a Platform Admin needs to debug a customer issue:

1. The Platform Admin opens `/platform/console/tenants/{orgId}` and clicks "Impersonate".
2. The platform action issues a short-lived (15 minute) impersonation JWT bound to the tenant's `userId` and `organizationId`. The original Platform Admin identity is recorded in the JWT as `impersonatedBy: { platformAdminId, expiresAt }`.
3. The impersonation session is bound to a single IP and a single User-Agent.
4. Every action during impersonation is recorded in `AuditLog` with `actorType: 'PLATFORM_ADMIN'`, `impersonatorId: <platformAdmin.id>`, and the `impersonatedUserId`.
5. The tenant UI shows a persistent red banner: "Session is being observed by TalentOS support. Reference: {ticketId}." The banner cannot be dismissed by the tenant.
6. The impersonation session is single-tenant. A Platform Admin cannot impersonate across two tenants without ending the first session and starting a new one (this is logged).
7. After 15 minutes the impersonation session auto-revokes and the platform admin must re-authenticate.

## Tenant lifecycle

The following transitions are first-class state machines:

| State | Description | Allowed transitions |
|-------|-------------|---------------------|
| `TRIAL` | New customer, no card on file | `ACTIVE`, `SUSPENDED` |
| `ACTIVE` | Paying customer | `PAST_DUE`, `SUSPENDED`, `CANCELED` |
| `PAST_DUE` | Payment failed, grace period | `ACTIVE`, `SUSPENDED` |
| `SUSPENDED` | Login disabled, data preserved | `ACTIVE`, `CANCELED` |
| `CANCELED` | Workspace is read-only, scheduled for deletion | `DELETED`, `RESTORED` (within 30 days) |
| `DELETED` | Workspace purged, all data gone (except audit retention) | (terminal) |

State transitions are only performed via explicit platform APIs and are recorded in `AuditLog`.

## Suspension behavior

When a tenant is suspended:

- All `User.status` records are flipped to `DISABLED`
- All `AuthSession` rows are deleted (forcing re-login)
- The Organization is marked `suspended: true`
- Login attempts are rejected with a clear "Your workspace is suspended" message
- ADMIN sees a "Contact support" link
- The Platform Admin can unsuspend; the tenants immediately regain access on their next login

## Billing hooks

`Organization` will gain the following fields (in a future migration):

```prisma
stripeCustomerId  String?  @unique
stripeSubId       String?  @unique
planId            String?  // e.g. "team-pro-monthly"
seats             Int      @default(5)
billingEmail      String?
trialEndsAt       DateTime?
```

A Platform Billing Admin can read and modify these. They CANNOT read HR data, candidate data, or any other tenant business record.

## Support access

A Platform Support Admin can:

- Read organization metadata (name, slug, createdAt, plan)
- Read the AuditLog for the organization
- Read the Invitation list and User list (names + emails + roles, no passwords)
- Impersonate (per the rules above)

A Platform Support Admin CANNOT:

- Read hiring request, candidate, or offer data without impersonation
- Read authentication secrets
- Modify user roles
- Modify data without an audit trail

## Security audit

A Platform Security Admin can:

- Read every AuditLog across all tenants
- Read every AuthSession across all tenants
- Read CopilotActionConfirmation and AIConversation metadata across all tenants
- Force-invalidate any session
- Suspend any tenant

A Platform Security Admin CANNOT:

- Read the contents of candidates, offers, or HRs
- Impersonate tenants (this is a support action, not a security action)

## Audit requirements

Every Platform Admin action is recorded in `AuditLog` with `actorType: 'PLATFORM_ADMIN'`, `actorId: <platformAdminId>`, and a `metadata` block that includes the reason and ticket ID (when applicable). The audit log is append-only and replicated to a write-once store for compliance.

Audit records are NEVER deletable through any platform action, including by a Platform Owner. They can be exported but not modified or deleted.

## No silent cross-tenant browsing

Critical: the application code never queries the database with `findMany({})` or `findFirst({})` without a tenant filter when the caller is a User. A Platform Admin never runs that code at all — they run platform-level code that is explicitly tenant-scoped and audited.

## Implementation roadmap (future sprints)

This is the proposed order. Each is a separate sprint with its own QA gate.

1. **Sprint 14 — Platform identity layer.** `PlatformAdmin` table, separate JWT, TOTP enrollment, `/platform/login`.
2. **Sprint 15 — Platform console skeleton.** List tenants, view org metadata, no business data.
3. **Sprint 16 — Tenant impersonation.** Time-bounded, audit-logged, banner-displayed.
4. **Sprint 17 — Tenant lifecycle.** Suspension, cancellation, deletion, restoration.
5. **Sprint 18 — Billing integration.** Stripe customers and subscriptions.
6. **Sprint 19 — Security audit cross-tenant view.** Audit + session + copilot metadata.

Each of these is gated on a thorough security review before deploy.
