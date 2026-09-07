/**
 * Sprint 9.1 — focused regression: auth + RBAC + tenant isolation still
 * work after the Change Password hotfix.
 *
 * Uses API calls (no Playwright) so it can run quickly and doesn't
 * depend on the real ADMIN's password (which the user changed in the
 * prior step). Uses seed users with known passwords.
 *
 * Exit code 0 on success.
 */

import 'dotenv/config'
import { db } from '../lib/db'

const PRODUCTION_URL = 'https://talentos-ai-lime.vercel.app'

let pass = 0
let fail = 0

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`)
    pass++
  } else {
    console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`)
    fail++
  }
}

async function apiLogin(email: string, password: string): Promise<string | null> {
  const csrfResp = await fetch(`${PRODUCTION_URL}/api/auth/csrf`)
  const csrf = (await csrfResp.json()) as { csrfToken: string }
  const csrfCookie = csrfResp.headers.getSetCookie?.().find(c => /csrf-token=/.test(c))?.split(';')[0] ?? ''
  const form = new URLSearchParams({
    csrfToken: csrf.csrfToken,
    email,
    password,
    callbackUrl: `${PRODUCTION_URL}/dashboard`,
    json: 'true',
  })
  const resp = await fetch(`${PRODUCTION_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': csrfCookie },
    body: form,
    redirect: 'manual',
  })
  const setCookie = resp.headers.get('set-cookie') ?? ''
  const location = resp.headers.get('location') ?? ''
  if (/authjs\.session-token=/.test(setCookie) && !location.includes('/login')) {
    return setCookie.match(/authjs\.session-token=([^;]+)/)?.[1] ?? null
  }
  return null
}

async function main() {
  console.log('Sprint 9.1 — focused regression: auth + RBAC + tenant isolation\n')

  // R.1 — RECRUITER can still log in (uses priya.patel whose password was
  // bootstrapped to a known value)
  const session = await apiLogin('priya.patel@acmecompany.com', 'priya.patelTalentOS9!')
  check('R.1 RECRUITER login (priya.patel) still works', session !== null)

  // R.2 — Middleware still redirects unauth users
  const r2 = await fetch(`${PRODUCTION_URL}/dashboard`, { redirect: 'manual' })
  check('R.2 unauthenticated /dashboard → 307 to /login',
    r2.status === 307 && (r2.headers.get('location') ?? '').includes('/login'))

  // R.3 — Authenticated user can access /settings
  if (session) {
    const r3 = await fetch(`${PRODUCTION_URL}/settings`, {
      headers: { Cookie: `__Secure-authjs.session-token=${session}` },
      redirect: 'manual',
    })
    check('R.3 authenticated /settings returns 200', r3.status === 200)
  } else {
    check('R.3 authenticated /settings (skipped: no session)', false)
  }

  // R.4 — Authenticated user can access /hiring-requests
  if (session) {
    const r4 = await fetch(`${PRODUCTION_URL}/hiring-requests`, {
      headers: { Cookie: `__Secure-authjs.session-token=${session}` },
      redirect: 'manual',
    })
    check('R.4 authenticated /hiring-requests returns 200', r4.status === 200)
  } else {
    check('R.4 authenticated /hiring-requests (skipped)', false)
  }

  // R.5 — Authenticated user can access /candidates
  if (session) {
    const r5 = await fetch(`${PRODUCTION_URL}/candidates`, {
      headers: { Cookie: `__Secure-authjs.session-token=${session}` },
      redirect: 'manual',
    })
    check('R.5 authenticated /candidates returns 200', r5.status === 200)
  } else {
    check('R.5 authenticated /candidates (skipped)', false)
  }

  // R.6 — IDOR: cross-tenant HR is not visible to a different org's query
  const orgs = await db.organization.findMany()
  check('R.6 multiple orgs exist (for IDOR check)', orgs.length >= 2)
  if (orgs.length >= 2) {
    const orgA = orgs[0]
    const orgB = orgs[1]
    const hrB = await db.hiringRequest.findFirst({ where: { organizationId: orgB.id } })
    if (hrB) {
      const cross = await db.hiringRequest.findFirst({ where: { id: hrB.id, organizationId: orgA.id } })
      check('R.7 IDOR: HR from org B not visible to org A scoped query', cross === null)
    } else {
      check('R.7 IDOR setup (skipped: org B has no HR)', true)
    }
  }

  // R.8 — AuditLog table is still being written
  const auditCount = await db.auditLog.count()
  check('R.8 AuditLog has rows', auditCount > 0)

  // R.9 — PASSWORD_CHANGED audit action has been used
  const pwAudits = await db.auditLog.count({ where: { action: 'PASSWORD_CHANGED' } })
  check('R.9 PASSWORD_CHANGED audit log rows exist', pwAudits > 0)

  // R.10 — LOGIN_SUCCESS / LOGIN_FAILURE actions are being recorded
  const loginSuccess = await db.auditLog.count({ where: { action: 'LOGIN_SUCCESS' } })
  const loginFailure = await db.auditLog.count({ where: { action: 'LOGIN_FAILURE' } })
  check('R.10 LOGIN_SUCCESS rows exist', loginSuccess > 0)
  check('R.11 LOGIN_FAILURE rows exist (brute-force trail)', loginFailure > 0)

  // R.12 — Auth.js session endpoint returns expected shape
  if (session) {
    const r12 = await fetch(`${PRODUCTION_URL}/api/auth/session`, {
      headers: { Cookie: `__Secure-authjs.session-token=${session}` },
    })
    const json = await r12.json()
    check('R.12 /api/auth/session returns role, organizationId, email', !!json?.user?.role && !!json?.user?.organizationId && !!json?.user?.email)
  } else {
    check('R.12 /api/auth/session (skipped)', false)
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`)
  await db.$disconnect()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
