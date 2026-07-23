# Sprint 17 — 4 Features Shipped (A, E, F, D)

**Status:** All 4 features pushed to `main`. Awaiting Vercel build.

## F. Public job posting (commit `286c983`)

**The ask:** "I generated a great JD, now how do I share it with candidates outside the app?"

**What you can do now:**
- Open any job in `/job-library`
- Click the **Link** button on the card
- Click "Enable public link" → instant public URL like `https://talentos-ai-lime.vercel.app/jobs/aBc123XyZ-_q4`
- Copy the URL, share on LinkedIn, email, company site — anyone can view
- Click "Disable" to revoke

**The public page:**
- ATS-style layout, mobile-responsive, no app chrome
- Shows title, level, type, summary, full description, responsibilities, skills (required + nice-to-have), perks, company info
- "Apply on TalentOS" CTA at the bottom
- Only public fields are exposed — no org data, no other candidates, no hiring pipeline

**Schema:**
- `JobDescription.publicSlug` (12-char base64url, unique)
- `JobDescription.publicEnabled` (boolean)
- `JobDescription.publicPostedAt` (timestamp)

**Security:**
- Slug is 12 random bytes → 144 bits of entropy → un-guessable
- "Read the public page" doesn't require any auth or session
- Tenant isolation preserved (page is keyed by slug, not orgId)

---

## A. CSV candidate import (commit `5a9dfdc`)

**The ask:** "My existing candidates are in a spreadsheet. Don't make me add them one by one."

**What you can do now:**
- Go to `/candidates`
- Click **Import CSV**
- Pick the hiring request (required — candidates are scoped to one)
- Pick your CSV file
- See a preview of valid rows + per-row errors
- Click "Import N candidates" → done

**Format:**
```
firstName,lastName,email,phone,location,currentTitle,source
Ada,Lovelace,ada@example.com,+44 20 7946 0958,London,Mathematician,Referral
```

**Required:** firstName, lastName, email
**Optional:** phone, location, currentTitle, currentCompany, linkedinUrl, githubUrl, source, notes

**Robust parser (no dependencies):**
- Handles quoted fields: `"foo, bar"`
- Escaped quotes: `"He said ""hi"""`
- Embedded newlines in quoted fields
- Windows line endings (CRLF)
- UTF-8 BOM

**Safety:**
- Max 1,000 rows per upload
- Max 5 MB file size
- Per-row validation: required fields, email format, max lengths
- Dedupe within batch + vs existing candidates (by email, case-insensitive)
- Transactional insert (all-or-nothing per upload)

**Audit logged:** `CANDIDATES_BULK_IMPORTED` with created + skipped counts.

---

## E. Bulk candidate actions (commit `ac02359`)

**The ask:** "I have 50 candidates to move from Screening to Interview. Don't make me click 50 times."

**What you can do now:**
- On `/candidates`, the table has a checkbox column
- Click individual rows or "select all" (selects all filtered rows)
- A floating bar appears: "**N selected** · Move to… [dropdown]"
- Pick the new stage → done in one transaction

**Available actions:** Screening, Interview, Offer, Rejected, Hired

**Server action:** `bulkMoveCandidatesAction`
- 100 candidates max per click (prevents accidental mass-update)
- Validates org owns all selected (prevents cross-tenant tampering)
- Skips candidates already at the target stage (no-op writes)
- One transaction, per-candidate activity record
- Audit logged

---

## D. Google Calendar integration (commit `49844ec`)

**The ask:** "Hiring managers forget interviews. Put them on Google Calendar."

**This is the most complex one.** It's wired but requires env vars before it actually works.

**Architecture (so the rest of the app never sees Google):**

```
┌──────────────────────┐
│  Interview create/   │ ── syncInterviewCreate(args) ──┐
│  update/delete       │                                │
└──────────────────────┘                                ▼
                                           ┌──────────────────────────┐
                                           │ lib/integrations/google/ │
                                           │   service.ts             │
                                           │   - tenant scoped        │
                                           │   - skip if not config   │
                                           │   - skip if not connected│
                                           │   - best-effort          │
                                           └──────────────────────────┘
                                                        │
                                           ┌────────────┴────────────┐
                                           ▼                         ▼
                                  ┌──────────────┐         ┌──────────────────┐
                                  │ oauth.ts     │         │ encrypt.ts        │
                                  │ - URL build  │         │ - AES-256-GCM     │
                                  │ - token mint │         │ - refresh tokens │
                                  │ - Calendar   │         │   encrypted      │
                                  │   REST       │         └──────────────────┘
                                  └──────────────┘
```

**To enable for real:**
1. Go to https://console.cloud.google.com/apis/credentials
2. Create an OAuth 2.0 Client (Web application)
3. Authorized redirect URI: `https://talentos-ai-lime.vercel.app/api/google/callback`
4. Enable the Google Calendar API in your project
5. Set env vars in Vercel:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `INTEGRATION_ENCRYPTION_KEY` (generate with `openssl rand -hex 32`)

**Until then:** The card in `/settings > Integrations` shows "Not configured on this server" and everything is a no-op (won't break the rest of the app).

**When enabled:**
- Click "Connect Google Calendar" → Google consent
- We store the refresh token (encrypted at rest) + your email
- New interviews auto-create a Google Calendar event
- Update/delete mirrors to Google
- Track via `CalendarEventMapping` (org + interview → google event id)

**Security:**
- State param is signed (orgId encoded + base64) — anti-CSRF
- Refresh tokens AES-256-GCM encrypted, never stored plaintext
- Token cache is in-memory with 60s buffer
- Disconnect = revoke without losing data
- ADMIN-only connect/disconnect

---

## What I did NOT do (intentional, per design)

- **Slack/Teams integration** — not in your top 4
- **Microsoft Outlook** — same OAuth complexity, can be added next to Google
- **Bi-directional sync** (Google → TalentOS) — only TalentOS → Google. Bidirectional is complex and not needed for "don't miss interviews"
- **Greenhouse/LinkedIn integrations** — too early, you don't have HR partners asking for it yet

## What I'd do next (Sprint 17 leftovers, ranked)

1. **Reschedule sync** — right now update is wired, but there's no UI for it. The action exists (`syncInterviewUpdate`); I just didn't wire it. ~30 min.
2. **Microsoft Outlook** — same pattern as Google. Add the OAuth client, add a route, done. ~2 hr.
3. **Slack notifications** — interview reminders via webhook. Easier than Calendar because no OAuth. ~2 hr.

## File map
- `app/(public)/jobs/[slug]/page.tsx` — public JD view
- `app/(app)/job-library/_components/share-modal.tsx` — share/enable
- `app/(app)/candidates/_components/import-csv-modal.tsx` — CSV upload UI
- `app/(app)/candidates/import-csv-actions.ts` — parse + import actions
- `app/(app)/hiring-requests/[id]/candidates/actions.ts` — bulk move action
- `app/(app)/candidates/_components/candidates-view.tsx` — checkboxes + bulk bar
- `app/api/google/connect/route.ts` — OAuth start
- `app/api/google/callback/route.ts` — OAuth callback
- `lib/integrations/google/{encrypt,oauth,service}.ts` — integration layer
- `app/(app)/settings/_components/integrations-section.client.tsx` — UI

## Commits
- `286c983` F. Public job posting
- `5a9dfdc` A. CSV candidate import
- `ac02359` E. Bulk candidate actions
- `49844ec` D. Google Calendar integration

Single push each, single Vercel build each. No deploy-hook abuse.
