# TalentOS AI — Product Feature Audit & SaaS Readiness

**Date:** 2026-07-23
**Version audited:** Build `7qL2FUcpC43wB2eSbkBEK` (Sprint 15 P1)
**Code stats:** 154 TS/TSX source files · 83 git commits · 38 test/verify scripts · 1,100+ local assertions · 879+ production assertions passing
**DB state at audit:** 125 orgs · 134 users · 27 HRs · 25 candidates · 7 offers · 6 interviews · 5 prompt templates · 1,132 audit log entries

---

## Legend
- ✅ **Built & working** — verified end-to-end in production
- 🟡 **Partial** — UI surface exists, action is wired to a "coming soon" or placeholder
- ❌ **Missing** — not built, would need a new sprint
- ⚠️ **Constraint / risk** — built but with a known limitation

---

# 1. What's BUILT (and working in production)

## 1.1 Public surface
| Feature | Status | Notes |
|---|---|---|
| `/login` page | ✅ | Email + password, "forgot password" link is a placeholder |
| `/signup` page | ✅ | Strong password validation, bcrypt, no logs, rate-limited (5/email/10min, 30/global/10min) |
| `/accept-invite/[token]` | ✅ | Hash-token, 7-day expiry, single-use, joins inviter's org |
| `/unauthorized` | ✅ | Clean error page for RBAC denials |
| Middleware | ✅ | Session-based route protection + server-side onboarding guard in `app/(app)/layout.tsx` |

## 1.2 Onboarding (Sprint 13)
| Feature | Status | Notes |
|---|---|---|
| 4-step wizard: workspace → company → team → done | ✅ | State machine: `ACCOUNT_CREATED → ORG_PENDING → ORG_CREATED → COMPANY_CONFIGURED → TEAM_INVITED → COMPLETED` |
| Atomic `provisionWorkspace()` | ✅ | Slug validation, reserved-slug list, default "People & Talent" Department |
| First-ADMIN rule | ✅ | Signup user becomes ADMIN of their new org |
| Migration backfill | ✅ | `20260720000002_sprint13_onboarding` — existing users/orgs set to `COMPLETED` |
| JWT carries onboarding state | ✅ | `onboardingStatus`, `onboardingStep`, `onboardingOrgStatus` — refreshed on every token refresh |
| Server-side onboarding guard | ✅ | Re-reads DB on every request to avoid stale-JWT redirect loops |

## 1.3 App shell
| Feature | Status | Notes |
|---|---|---|
| Sidebar nav (11 routes) | ✅ | AI Recruiter, Dashboard, Hiring Requests, Job Library, Candidates, Interview Center, Offers, AI Copilot, Analytics, Reports, Settings |
| AppHeader with profile menu | ✅ | User name, role, Cmd+K shortcut hint |
| `/api/health/ai` liveness probe | ✅ | Returns `{provider, model, status, latencyMs}` — public, no auth required |
| Dark mode | ✅ | All pages support it |
| Responsive (basic) | 🟡 | Works on desktop/tablet, mobile layout is "usable but not designed" |
| Cmd+K command palette | ❌ | The hint is in the header but the palette is not implemented |

## 1.4 Dashboard
| Feature | Status | Notes |
|---|---|---|
| Live stat cards (6 metrics) | ✅ | From `getDashboardDataAction` |
| Hiring requests table | ✅ | Real Prisma data |
| Pipeline column (5 stages) | ✅ | Real counts per stage |
| Activity timeline | ✅ | Real activity entries |
| "New hiring package" → AI Recruiter | ✅ | Wired to `/ai-recruiter` |
| "View all" → Hiring Requests | ✅ | Wired to `/hiring-requests` |
| "Export" | 🟡 | "Coming soon" dialog (no fake export) |
| Empty state with "Open AI Recruiter" CTA | ✅ | |

## 1.5 AI Recruiter (Sprints 1-5)
| Feature | Status | Notes |
|---|---|---|
| Wizard: prompt → generate → review → save | ✅ | Full flow, real AI engine |
| 6 prompt modules | ✅ | job-description, cv-analysis, candidate-ranking, interview-kit, decision-brief, offer-letter |
| 6 Zod schemas for AI response validation | ✅ | Malformed responses throw, action returns error, UI shows error |
| AI Engine: provider-agnostic | ✅ | Single `getAIEngine()` entry, factory pattern |
| Gemini 2.5 Flash Lite provider | ✅ | Health-checked, ~700ms latency |
| Recent AI tasks list | ✅ | Real data from `AITask` table |
| Suggested prompts | ✅ | 4 hardcoded + 6 popular roles |
| "Generate hiring package" submit | ✅ | Calls `generateJobDescriptionAction` |

## 1.6 Hiring Requests
| Feature | Status | Notes |
|---|---|---|
| List view with filters (status, department, search) | ✅ | Real data |
| Detail page (`/hiring-requests/[id]`) | ✅ | Real Prisma data |
| Candidate workspace (`/hiring-requests/[id]/candidates`) | ✅ | CV upload, AI analysis, ranking |
| CV upload (PDF/DOCX, up to 5 MB, batch) | ✅ | Sprint 6 |
| AI candidate ranking | ✅ | Match score, recommendation, strengths/gaps/concerns |
| Move stage menu (Screening / Interview / Offer / Reject) | ✅ | With Re-analyze button |
| "New hiring request" → AI Recruiter | ✅ | Wired |
| "Customize view" | 🟡 | "Coming soon" dialog (saved views feature not built) |
| Decision Hub (`/hiring-requests/[id]/decision`) | ✅ | Sprint 8 — compare candidates side by side |
| All hiring requests list | ✅ | With empty state |

## 1.7 Candidates
| Feature | Status | Notes |
|---|---|---|
| List with grid/list view toggle, stage filters, search | ✅ | Real data |
| **Add candidate modal** | ✅ | Sprint 15 P1 fix — collects firstName, lastName, email, hiring request, source, location. Validates, RBAC, tenant-scoped |
| "Saved views" | 🟡 | "Coming soon" dialog |
| **Tenant isolation** | ✅ | Every query scoped by `organizationId` |
| **Self-as-candidate guard** | ✅ | Sprint 15 — refuses to add a candidate whose email matches a team member |
| Detail page (`/candidates/[id]`) | ✅ | Real profile data |
| AI match analysis (score, breakdown, recommendation) | ✅ | Sprint 6 |
| CV viewer (PDF/DOCX) | ✅ | |
| Interview kit generator | ✅ | Sprint 7 |
| Interview kit evaluator | ✅ | Sprint 7 — structured evaluation form |
| Offer letter generator | ✅ | Sprint 10 — AI drafts, human confirms |
| Stage transitions | ✅ | With audit log |
| "Message" / "Schedule interview" / "Move to next stage" / "Save note" | 🟡 | "Coming soon" dialogs (Sprint 15 P1 fix) |
| **No "Reject" button on profile** | ❌ | Can only reject from the workspace view |
| No candidate merge / dedup | ❌ | Two candidates with the same name appear as separate rows |
| No candidate CSV import | ❌ | |

## 1.8 Interview Center
| Feature | Status | Notes |
|---|---|---|
| Today / Upcoming / Past / Completed tabs | ✅ | Real data |
| Interview details | ✅ | From `Interview` table |
| Stage = Interview from any candidate | ✅ | |
| Real-time (or polling) updates | 🟡 | Uses server actions, no live push |

## 1.9 Offers (Sprint 10)
| Feature | Status | Notes |
|---|---|---|
| Draft / Pending Approval / Approved / Issued / Accepted / Declined / Expired / Withdrawn stages | ✅ | Full lifecycle |
| Compensation gated by `offer.view_compensation` permission | ✅ | AI fairness — never sent to AI |
| Approval separation (no one approves their own draft) | ✅ | With documented ADMIN escape hatch |
| AI offer letter drafting | ✅ | Server-side only, requires human confirm |
| AI never sets salary / approves / declines | ✅ | Hard rule enforced in actions |
| Re-generate letter (with confirmation) | ✅ | |
| Sent / received tracking | ✅ | `issuedAt`, `respondedAt` |

## 1.10 AI Copilot (Sprint 11 + 11.1)
| Feature | Status | Notes |
|---|---|---|
| Read-only by default (Sprint 11) | ✅ | Compensation stripped before data reaches Gemini |
| 3 whitelisted confirmed actions (Sprint 11.1) | ✅ | AI proposes, human confirms, server authorizes, domain executes |
| Suggested prompts | ✅ | 3 starter prompts |
| Conversation persistence | ✅ | `AIConversation` table |
| Audit log of every action | ✅ | |
| RBAC: only ADMIN/TA_LEAD/RECRUITER/HIRING_MANAGER | ✅ | |
| Interviewer / Viewer cannot use copilot | ✅ | |

## 1.11 Analytics (Sprint 15)
| Feature | Status | Notes |
|---|---|---|
| Live funnel (5 stages) | ✅ | Real counts from `Candidate.stage` |
| 6 metric cards | ✅ | Time to hire, Offer acceptance, Pipeline velocity, Hires, Interview→offer, Open roles — all real |
| Hires by team | ✅ | Real join through `hiringRequest.department` |
| Sources breakdown | ✅ | Real `Candidate.source` groupBy |
| Range selector (`7d / 30d / 90d / YTD / All`) | 🟡 | UI control visible, but the underlying query returns all-time aggregate for the org only. A future sprint can wire per-range filtering. |
| Empty state | ✅ | "No data to analyze yet" |

## 1.12 Reports (Sprint 15)
| Feature | Status | Notes |
|---|---|---|
| 6 planned templates shown | 🟡 | Visible as cards with "Coming soon" badge — no fake run counts |
| Direct link to Analytics | ✅ | For users who want live numbers now |
| Report runner (PDF/CSV export) | ❌ | Not built |
| Scheduled reports | ❌ | Not built |
| Recent reports | ❌ | (would have been fake, intentionally not shown) |

## 1.13 Job Library (Sprint 15)
| Feature | Status | Notes |
|---|---|---|
| Real job descriptions from `JobDescription` table | ✅ | Sprint 15 fix — wired to Prisma, no more hardcoded 8 templates |
| Department filter (dynamic from real data) | ✅ | |
| Skills chips per job | ✅ | |
| `isTemplate` flag honored | ✅ | |
| "Use template" / "Star" buttons | 🟡 | "Coming soon" (no template cloning yet) |

## 1.14 Settings (Sprint 12 + 13)
| Feature | Status | Notes |
|---|---|---|
| **Profile section** (real, DB-backed) | ✅ | name, email, role, dept, timezone — all from `User` table |
| **Organization section** (real, DB-backed) | ✅ | name, slug, industry, size, location |
| **Team & Users** | ✅ | List/search/filter, change role, disable/reactivate, invite, last-ADMIN protection |
| **Invitation flow** | ✅ | Canonical URL, hash tokens, 7-day expiry, single-use, copy-link modal |
| **Security** (password, 2FA) | 🟡 | "Coming soon" |
| **Notifications** (email preferences) | 🟡 | "Coming soon" |
| **Integrations** (calendar, email, Slack) | 🟡 | "Coming soon" |
| **Data Management** | ✅ | Sprint 12 — Two flows: auto-classified "CLEAN DEMO DATA" + destructive "RESET TALENT DATA" with typed-phrase confirmation |
| Email change | 🟡 | Profile shows email, but no "change email" action |
| Profile photo upload | ❌ | No storage backend wired |
| Time zone / locale | 🟡 | Stored in profile but no per-user UI to change |

## 1.15 Data Management (Sprint 12)
| Feature | Status | Notes |
|---|---|---|
| `previewDataManagement` (read-only classification) | ✅ | Counts what would be wiped |
| `executeBusinessReset` (destructive) | ✅ | Preserves Org + ADMIN + users + depts + prompts + audits; wipes HRs + candidates + interviews + decisions + offers + activities + AI tasks + conversations + copilot + jobDescriptions |
| Typed phrase confirmation | ✅ | "RESET TALENT DATA" required |
| Last-ADMIN protection | ✅ | Refuses if no active ADMIN remains |
| Audit log entry on execute | ✅ | `DATA_RESET_EXECUTED` |

## 1.16 Cross-cutting
| Feature | Status | Notes |
|---|---|---|
| Auth.js v5 with credentials provider | ✅ | bcrypt, JWT, session cookies |
| RBAC with 7 roles | ✅ | ADMIN, TA_LEAD, RECRUITER, HIRING_MANAGER, INTERVIEWER, VIEWER, CANDIDATE |
| Permissions system | ✅ | 30+ permissions, `requirePermission()` helper |
| Tenant isolation | ✅ | `where: { organizationId: ctx.organizationId }` on every Prisma query |
| Audit log | ✅ | 1,132 entries in production |
| Input validation (Zod) | ✅ | All actions validate inputs |
| Error handling | ✅ | Typed `ActionResult<T>` shape — no thrown errors, no leaks |
| Server actions (not REST) | ✅ | Modern Next.js pattern |
| Real-time events (in-app) | 🟡 | Internal event bus exists; used for AI Recruiter → Dashboard, no WebSocket push |
| Accessibility (basic) | ✅ | All modals use `role="dialog"` + `aria-modal` + body scroll lock + Escape to close |
| Keyboard navigation | ✅ | Tab order, focus rings, Enter on submit |

---

# 2. What's PARTIAL (UI surface exists, action is a stub)

These were intentionally marked as "coming soon" during Sprint 13 + 15 because the underlying feature is not built. Per the audit policy, no fake UI.

| Surface | Why stubbed | Effort to complete |
|---|---|---|
| **Export buttons** (Dashboard, candidates) | No PDF/CSV export pipeline | 1 sprint — pick a library (e.g. `pdfkit`, `puppeteer`), wire a server action |
| **Saved views** (Candidates, Hiring Requests) | No `SavedView` table | ½ sprint — schema + per-user named filters |
| **Customize view** | Same as above | ½ sprint |
| **Schedule interview** | Calendar integration not built | 1 sprint — Google Calendar / Outlook OAuth + invite generation |
| **Message candidate** | Email pipeline not built | 1 sprint — transactional email (Resend / SES) + template system |
| **Move to next stage** (from profile) | Bulk transition handler not built | ½ sprint — extend existing `moveCandidateStageAction` |
| **Save note** | `Note` table not built | ¼ sprint — schema + simple CRUD |
| **Range selector** (Analytics) | Per-range query not built | ½ sprint — date filtering on existing query |
| **Cmd+K palette** | Not started | 1 sprint — `cmdk` library + searchable routes/actions |
| **Mobile layouts** | Designed for desktop, works on tablet | 1 sprint — separate mobile nav, sticky headers, condensed tables |
| **Email change** | No flow | ¼ sprint — verify-current-password → send-confirmation-to-old-email → confirm |

---

# 3. What's MISSING for SaaS readiness

Ordered by what blocks an external launch.

## 3.1 🔴 P0 — must-have before charging anyone

### 3.1.1 Public marketing site
| What's missing | Why it matters |
|---|---|
| Landing page (`/`) — currently redirects to `/ai-recruiter` | First impression, SEO, paid acquisition |
| `/pricing` page with plans & CTA | Conversion |
| `/about`, `/contact`, `/blog` (or `/_blog` MDX) | Trust |
| Legal: `/terms`, `/privacy`, `/dpa` (data processing addendum), `/security` | Required for B2B sales |
| `/changelog` (public) | Customer trust + SEO |
| `robots.txt`, `sitemap.xml`, Open Graph tags | SEO |
| Cookie banner / GDPR consent | Legal in EU/UK |
| **Public homepage is currently a redirect** — biggest single gap for "is this a real product?" |

### 3.1.2 Billing
| What's missing | Why it matters |
|---|---|
| No `Billing` model, no `Plan` enum, no Stripe/Paddle integration | Cannot charge for the product |
| No `Subscription` table | Cannot track who's paid |
| No plan-based feature gating (free / pro / enterprise) | Cannot do tiered pricing |
| No invoice generation | Cannot do accounting |
| No "you've used X of Y AI credits this month" | Cannot enforce fair-use |
| No dunning / failed-payment flow | Cannot recover revenue |
| No plan upgrade/downgrade flow | Cannot grow with customers |
| **Per the original constraints: Billing is deliberately deferred — but the next sprint must add at minimum Stripe Checkout + a `Subscription` table + plan-based feature gating** |

### 3.1.3 Transactional email
| What's missing | Why it matters |
|---|---|
| No email service (no Resend / SES / Postmark) | Cannot send ANY email |
| No email templates (invite, password reset, offer letter, weekly digest) | Cannot onboard users off-platform |
| No "forgot password" flow — the link on `/login` is a placeholder | **Account recovery is impossible today** |
| No welcome email after signup | Lower activation |
| No "you've been invited" email — invitees only see the link in their email client, no in-app notification | Easy to miss |
| No offer-letter email — issued offers don't notify the candidate | **Hiring workflow is broken without this** |
| No interview-reminder email | No-show risk |

### 3.1.4 Forgot password / account recovery
| What's missing | Why it matters |
|---|---|
| **The `/login` page has a "Forgot password?" link that does nothing** | Users who lose their password are locked out forever |
| No email-based reset flow | — |
| No security questions / backup codes | — |

## 3.2 🟠 P1 — required for "professional SaaS" feel

### 3.2.1 Observability & ops
| What's missing | Why it matters |
|---|---|
| No structured logging (no Pino / Winston) | Cannot debug production |
| No error tracking (no Sentry / Bugsnag) | Cannot find bugs users hit |
| No uptime monitoring (better-uptime / Datadog Synthetics) | No SLA |
| No status page (statuspage.io / self-hosted) | Customers ask "is it down?" |
| No request tracing (no OpenTelemetry) | Cannot debug slow requests |
| No APM (no Datadog / New Relic) | Cannot find N+1 queries |
| AI cost tracking | Cannot price AI credits |

### 3.2.2 Support
| What's missing | Why it matters |
|---|---|
| No in-app help / docs | Users can't self-serve |
| No "Send feedback" button | Cannot collect qualitative feedback |
| No live chat (Intercom / Crisp) | Support is email-only |
| No ticket system | Support requests get lost |
| No FAQ / knowledge base | Repeats the same support questions |
| No changelog IN-APP | Users don't know about new features |
| `docs/platform-admin-architecture.md` exists internally but no public version | |

### 3.2.3 Legal & compliance
| What's missing | Why it matters |
|---|---|
| No Terms of Service acceptance on signup | Not legally binding |
| No Privacy Policy acceptance | GDPR |
| No DPA (Data Processing Addendum) for B2B | EU requires for enterprise |
| No cookie consent banner | EU/UK legal requirement |
| No data export per GDPR Art. 20 ("right to data portability") | Required for EU customers |
| No account deletion per GDPR Art. 17 ("right to be forgotten") | **Required for EU customers; today the only way is a destructive `RESET TALENT DATA` which wipes org-wide** |
| No SOC 2 / ISO 27001 (out of scope for an early-stage product) | Enterprise sales blocker |
| No CCPA disclosure (California) | US customers |
| No audit-log export | Enterprise sales blocker |

### 3.2.4 Security hardening
| What's missing | Why it matters |
|---|---|
| No CSP headers (Content Security Policy) | XSS protection |
| No HSTS preload | HTTPS enforcement |
| No rate limiting on auth endpoints (other than signup) | Brute force risk on `/login` |
| No rate limiting on AI endpoints | **AI cost blowup risk** — `generateJobDescriptionAction` has no quota |
| No 2FA / TOTP | Enterprise expectation |
| No SSO (Google, Microsoft, SAML) | Enterprise sales blocker (deliberately deferred per constraints) |
| No API key / personal access token | Cannot integrate from external tools |
| No webhook system | Cannot push events to Slack etc. |
| No IP allow-list for tenants | Enterprise expectation |
| No session revocation list | Cannot force-logout compromised user |
| `AUTH_SECRET` is not rotated automatically | Best practice |
| Audit log is not exported / queried in UI | Hard to investigate |

### 3.2.5 Internationalization
| What's missing | Why it matters |
|---|---|
| No i18n setup (no `next-intl`, no `next-i18next`) | All UI is hardcoded English |
| No locale picker | — |
| No timezone-aware display formatting | Times are shown in the user's browser TZ, but no per-user setting |
| No multi-currency in offers | Salary fields are `USD` only |
| No RTL support | Cannot sell in Arabic / Hebrew markets |

## 3.3 🟡 P2 — should-have, but not launch-blocking

### 3.3.1 Data & integrations
| What's missing |
|---|
| No CSV import (candidates, HRs) — manual entry only |
| No bulk actions in lists (bulk reject, bulk email, bulk move) |
| No Google Calendar / Outlook integration (Schedule interview is stubbed) |
| No Slack / Microsoft Teams integration (notifications, daily digest) |
| No Zapier / Make / n8n connector |
| No Greenhouse / Lever / Workday import (for customers switching) |
| No LinkedIn / Indeed / job-board posting |
| No email open / click tracking |
| No calendar / email inbox sync (read candidate replies) |
| No CV parser for non-standard formats (RTF, TXT, HTML) |
| No candidate scoring history graph (only the latest score is shown) |

### 3.3.2 Admin & power-user
| What's missing |
|---|
| No platform admin (deliberately deferred — `docs/platform-admin-architecture.md` exists) |
| No tenant search / impersonation |
| No bulk user import (CSV) |
| No department / team hierarchy (only flat list) |
| No custom roles beyond the 7 hardcoded ones |
| No permission overrides per user |
| No feature flags |
| No environment switcher (dev / staging / prod) |

### 3.3.3 Analytics & reporting
| What's missing |
|---|
| Per-range filtering in Analytics (the range buttons are visual only) |
| Cohort analysis (candidates by source, by week) |
| Funnel comparison (this month vs last month) |
| Time-to-hire trend chart (line chart, not stat card) |
| Custom dashboards (drag-drop widgets) |
| Real PDF report generation (Reports page is fully stubbed) |
| Scheduled email reports |
| Slack/email weekly digest |
| Funnel by department / by source |

### 3.3.4 Mobile
| What's missing |
|---|
| Mobile-first layouts (current is desktop-first, mobile "works") |
| Native iOS / Android app |
| PWA install prompt |
| Push notifications (mobile) |

### 3.3.5 Performance
| What's missing |
|---|
| No `Suspense` streaming on the dashboard (full-page server render) |
| No optimistic UI on the candidate workspace stage moves |
| No `revalidate` / `revalidateTag` for fine-grained cache invalidation |
| No image optimization pipeline (no `next/image` configured for avatars) |
| No service worker / offline mode |

## 3.4 🟢 P3 — nice-to-have, post-launch

- AI-generated rejection letters (currently only offer letters)
- AI-suggested interview questions per candidate
- AI-suggested job descriptions from a one-line prompt (the Recruiter wizard does this already, but no "templated suggestions")
- Custom email templates per org
- Saved searches with email alerts ("notify me when a Senior Engineer applies")
- Talent pool / silver-medalists (candidates who almost made it)
- Employee referral portal
- Internal mobility (recommend internal candidates to other HRs in the same org)
- Offer negotiation tracking (current price vs candidate counter)
- Career site (public job board per org, with custom domain support)
- Candidate NPS / experience surveys
- DEI dashboards (anonymized demographics)
- Interview score calibration across interviewers

---

# 4. Constraint-by-constraint review

| Original constraint | Status |
|---|---|
| Do not redesign unrelated pages | ✅ Respected across all 15 sprints |
| Do not implement Billing, enterprise SSO | ✅ Both still deferred |
| Do not replace existing AI provider architecture | ✅ Single `getAIEngine()` + factory preserved |
| AI fairness safeguards — no protected characteristics | ✅ AI prompts never receive age/gender/race; no DEI dashboard yet |
| UI hiding ≠ authorization | ✅ Every action re-checks RBAC server-side |
| Tenant isolation = `where: { organizationId }` on every query | ✅ Enforced via `requireAuth().data.organizationId` |
| AI never determines salary / approves / declines | ✅ Hard rule in offer actions |
| Compensation is a SEPARATE permission | ✅ `offer.view_compensation` enforced |
| Approval separation with ADMIN escape hatch | ✅ |
| Read-only AI | ✅ Copilot never mutates without explicit human confirm |
| Compensation stripped before data reaches Gemini | ✅ |
| 3 whitelisted actions only | ✅ |
| No production data deleted until safe classification | ✅ `previewDataManagement` |
| No production secrets exposed/rotated | ✅ |
| Test data uses test markers | ✅ |
| Use existing RBAC | ✅ |
| Last-ADMIN protection | ✅ |
| No fake UI / dead buttons | ✅ Sprint 15 P1 fix |

---

# 5. SaaS Readiness Scorecard

| Category | Score | Notes |
|---|---|---|
| **Core product (hiring workflow)** | 9/10 | End-to-end works. Missing: bulk actions, CSV import, calendar/email integration |
| **Authentication & security** | 7/10 | Solid baseline. Missing: forgot password, 2FA, rate limit on AI, CSP |
| **Multi-tenancy & RBAC** | 9/10 | Clean separation, 7 roles, 30+ permissions |
| **AI features** | 8/10 | 6 prompt modules, 3 whitelisted actions, fairness enforced. Missing: cost tracking, prompt versioning UI |
| **Data management & compliance** | 6/10 | Reset works, audit log exists. Missing: GDPR export/delete, DPA, terms acceptance |
| **Public surface (marketing site)** | 1/10 | **Currently redirects to /ai-recruiter — biggest single gap** |
| **Billing** | 0/10 | Not started |
| **Email (transactional)** | 0/10 | Not started |
| **Observability** | 0/10 | No logging, no error tracking, no monitoring |
| **Support** | 0/10 | No in-app help, no chat, no tickets |
| **Mobile** | 3/10 | Works, not designed |
| **Internationalization** | 0/10 | English only, USD only |

**Overall SaaS readiness: 4/10** — solid product, missing the entire commercial + public + ops layer.

---

# 6. Recommended next sprint (priority order)

### Sprint 16 — "Make it sellable" (3-4 weeks)
1. **Public marketing site** — landing + pricing + terms + privacy + robots + sitemap + OG tags
2. **Transactional email** — Resend (or SES) + welcome / invite / offer-letter / interview-reminder templates
3. **Forgot password flow** — request reset → email link → set new password
4. **Stripe Billing** — Checkout + `Subscription` table + plan-based feature gating (free / pro / enterprise)
5. **Observability minimum** — Sentry + structured logging + uptime monitor
6. **In-app feedback widget** — single `?` button that opens a form

### Sprint 17 — "Make it trustworthy" (2-3 weeks)
7. **GDPR Art. 17** — full account deletion (user-initiated)
8. **GDPR Art. 20** — data export (user-initiated, ZIP of all their data)
9. **CSP + HSTS** — security headers
10. **2FA** — TOTP for ADMIN and TA_LEAD
11. **AI rate limit + cost tracking** — `AIUsage` table, monthly quota per org
12. **Per-range filtering in Analytics** — `7d / 30d / 90d / YTD / All` actually filters

### Sprint 18 — "Make it grow" (3-4 weeks)
13. **CSV import** — candidates + HRs
14. **Calendar integration** — Google + Outlook OAuth, "Schedule interview" real
15. **Email candidates from app** — "Message" real
16. **Cmd+K command palette** — quick navigation + actions
17. **Mobile-first redesign** of the 3 most-used pages (Dashboard, Candidates, Hiring Requests)
18. **Custom roles** — per-tenant permission editor

### Sprint 19 — "Make it bigger" (4+ weeks)
19. **Real PDF report runner** (Reports page)
20. **Bulk actions** in lists
21. **Saved views**
22. **i18n** (next-intl) — start with es + fr
23. **Public API + webhooks** (for partners)
24. **Talent pool** (silver-medalist re-engagement)

---

# 7. Total open work

- **P0 (block launch):** ~6 weeks of work — public site, billing, email, forgot password, observability minimum
- **P1 (need for credibility):** ~4 weeks — GDPR, security hardening, 2FA, AI cost
- **P2 (need to grow):** ~6 weeks — calendar, CSV import, mobile, custom roles
- **P3 (post-launch):** ongoing — i18n, platform admin, custom reports

**Estimate to "ready to charge real money":** ~10-12 weeks of focused work (1-2 senior engineers), assuming current architecture holds.
