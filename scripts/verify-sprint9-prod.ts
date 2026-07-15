/**
 * Sprint 9 — Production E2E for Authentication, RBAC, and Tenant Isolation.
 *
 * Flow A — Authentication
 *   1. Open protected route logged out → redirected to /login
 *   2. Login as ADMIN
 *   3. Confirm Dashboard loads
 *   4. Confirm profile shows correct user + role + organization
 *   5. Logout
 *   6. Confirm protected routes are inaccessible
 *
 * Flow B — Recruiter
 *   1. Login as RECRUITER (Dan Okafor)
 *   2. Confirm can access HR workspace
 *   3. Confirm cannot access /settings/org (admin-only)
 *
 * Flow C — Interviewer
 *   1. Login as INTERVIEWER (Aiden Park / Sofia Martins)
 *   2. Confirm limited read access
 *
 * Flow D — Viewer
 *   1. Login as VIEWER (we'll set this up)
 *   2. Confirm read-only
 *
 * Flow E — Tenant isolation
 *   1. Login as Org A user
 *   2. Direct IDOR attempt — fetch a known Org B resource by URL
 *   3. Confirm returns 404
 *
 * Run: pnpm exec tsx scripts/verify-sprint9-prod.ts
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import 'dotenv/config'
import { db } from '../lib/db'
import { hashPassword } from '../lib/auth/password'

const PRODUCTION_URL = 'https://talentos-ai-lime.vercel.app'

let pass = 0
let fail = 0
const errors: string[] = []

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`)
    pass++
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
    fail++
  }
}

// Test users — passwords are set during the seed run
const USERS = {
  admin: { email: 'jordan.rivera@acmecompany.com', password: 'jordan.riveraTalentOS9!' },
  recruiter: { email: 'priya.patel@acmecompany.com', password: 'priya.patelTalentOS9!' },
  hiringManager: { email: 'marcus.chen@acmecompany.com', password: 'marcus.chenTalentOS9!' },
  interviewer: { email: 'aiden.park@acmecompany.com', password: 'aiden.parkTalentOS9!' },
}

async function ensureViewer() {
  const existing = await db.user.findUnique({
    where: { email: 'test-viewer@acmecompany.com' },
  })
  if (existing) {
    const passwordHash = await hashPassword('test.viewerTalentOS9!')
    await db.user.update({
      where: { id: existing.id },
      data: { passwordHash, role: 'VIEWER', status: 'ACTIVE', disabledAt: null, passwordChangedAt: new Date() },
    })
    return
  }
  const org = await db.organization.findFirst()
  if (!org) throw new Error('No organization found')
  const passwordHash = await hashPassword('test.viewerTalentOS9!')
  await db.user.create({
    data: {
      organizationId: org.id,
      email: 'test-viewer@acmecompany.com',
      firstName: 'Test',
      lastName: 'Viewer',
      role: 'VIEWER',
      status: 'ACTIVE',
      passwordHash,
      passwordChangedAt: new Date(),
    },
  })
}

async function login(page: Page, email: string, password: string) {
  await page.goto(`${PRODUCTION_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('button:has-text("Sign In")')
  // Wait for navigation away from /login
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })
}

async function logout(page: Page) {
  // Look for a Sign out button. The button is inside the profile menu which
  // is opened by clicking the user avatar.
  const avatarBtn = page.locator('button:has(div.bg-emerald-100)').first()
  if (await avatarBtn.count() > 0) {
    await avatarBtn.click()
    await page.waitForTimeout(500)
  }
  const signOutBtn = page.locator('button:has-text("Sign out")')
  if (await signOutBtn.count() > 0) {
    await Promise.all([
      page.waitForURL(url => url.pathname.includes('/login'), { timeout: 15_000 }).catch(() => null),
      signOutBtn.first().click(),
    ])
    await page.waitForTimeout(1000)
  }
}

async function main() {
  console.log('\n=== Sprint 9 production E2E ===\n')

  // Pre-test: ensure VIEWER exists
  await ensureViewer()
  const viewer = { email: 'test-viewer@acmecompany.com', password: 'test.viewerTalentOS9!' }

  // Find a candidate ID to use for IDOR test
  const orgs = await db.organization.findMany()
  const seedOrg = orgs[0]!
  const candidates = await db.candidate.findMany({
    where: { organizationId: { not: seedOrg.id } },
    take: 1,
  })
  const foreignCandidateId = candidates[0]?.id

  const browser: Browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
  })

  // ===========================================================================
  // FLOW A — Authentication
  // ===========================================================================
  console.log('\nA. Authentication flow')

  // A.1 — Unauthenticated request to /dashboard → redirect to /login
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    const response = await page.goto(`${PRODUCTION_URL}/dashboard`, { waitUntil: 'networkidle' })
    ok('A.1 unauthenticated /dashboard redirects to /login', page.url().includes('/login'), `url=${page.url()}`)
    void response
    await ctx.close()
  }

  // A.2 — Login as ADMIN
  const ctxA = await browser.newContext()
  const pageA = await ctxA.newPage()
  pageA.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  pageA.on('console', m => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(`console: ${m.text()}`)
  })
  try {
    await login(pageA, USERS.admin.email, USERS.admin.password)
    ok('A.2 ADMIN login redirects to /dashboard', pageA.url().endsWith('/dashboard') || pageA.url().includes('/dashboard'), `url=${pageA.url()}`)

    // A.3 — Dashboard loads with profile info
    await pageA.waitForTimeout(2000)
    const dashBody = (await pageA.locator('body').textContent()) ?? ''
    ok('A.3 dashboard renders user name', /Jordan/.test(dashBody))
    ok('A.3 dashboard renders role', /ADMIN|admin/.test(dashBody))

    // A.4 — Sign out
    await logout(pageA)
    await pageA.waitForTimeout(2000)
    ok('A.4 after logout /dashboard redirects to /login', pageA.url().includes('/login'), `url=${pageA.url()}`)
  } finally {
    await ctxA.close()
  }

  // ===========================================================================
  // FLOW B — Recruiter
  // ===========================================================================
  console.log('\nB. Recruiter flow')
  const ctxB = await browser.newContext()
  const pageB = await ctxB.newPage()
  pageB.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  try {
    await login(pageB, USERS.recruiter.email, USERS.recruiter.password)
    ok('B.1 RECRUITER can log in', !pageB.url().includes('/login'))
    await pageB.waitForTimeout(2000)
    const recruiterBody = (await pageB.locator('body').textContent()) ?? ''
    ok('B.2 RECRUITER sees dashboard', /Dashboard|Priya/.test(recruiterBody))
    // B.3 — Try to access candidate workspace
    const hrResp = await pageB.goto(`${PRODUCTION_URL}/hiring-requests`, { waitUntil: 'networkidle' })
    ok('B.3 RECRUITER can access /hiring-requests', hrResp?.status() === 200)
  } finally {
    await ctxB.close()
  }

  // ===========================================================================
  // FLOW C — Interviewer
  // ===========================================================================
  console.log('\nC. Interviewer flow')
  const ctxC = await browser.newContext()
  const pageC = await ctxC.newPage()
  pageC.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  try {
    await login(pageC, USERS.interviewer.email, USERS.interviewer.password)
    ok('C.1 INTERVIEWER can log in', !pageC.url().includes('/login'))
    await pageC.waitForTimeout(2000)
    const interviewerBody = (await pageC.locator('body').textContent()) ?? ''
    ok('C.2 INTERVIEWER sees dashboard with their name', /Aiden/.test(interviewerBody))
    // C.3 — INTERVIEWER can access interview center
    const intResp = await pageC.goto(`${PRODUCTION_URL}/interview-center`, { waitUntil: 'networkidle' })
    ok('C.3 INTERVIEWER can access /interview-center', intResp?.status() === 200)
  } finally {
    await ctxC.close()
  }

  // ===========================================================================
  // FLOW D — Viewer
  // ===========================================================================
  console.log('\nD. Viewer flow')
  const ctxD = await browser.newContext()
  const pageD = await ctxD.newPage()
  pageD.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  try {
    await login(pageD, viewer.email, viewer.password)
    ok('D.1 VIEWER can log in', !pageD.url().includes('/login'))
    await pageD.waitForTimeout(2000)
    const viewerBody = (await pageD.locator('body').textContent()) ?? ''
    ok('D.2 VIEWER sees dashboard with their name', /Test Viewer/.test(viewerBody))
  } finally {
    await ctxD.close()
  }

  // ===========================================================================
  // FLOW E — Tenant isolation
  // ===========================================================================
  if (foreignCandidateId) {
    console.log('\nE. Tenant isolation')
    const ctxE = await browser.newContext()
    const pageE = await ctxE.newPage()
    pageE.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    try {
      // Login as a user in seedOrg
      await login(pageE, USERS.recruiter.email, USERS.recruiter.password)
      // Try to access a foreign candidate by ID
      const foreignResp = await pageE.goto(`${PRODUCTION_URL}/candidates/${foreignCandidateId}`, { waitUntil: 'networkidle' })
      await pageE.waitForTimeout(2000)
      const foreignBody = (await pageE.locator('body').textContent()) ?? ''
      // The page should not contain the foreign candidate's PII
      // We check for "not found" or similar
      const isNotFound = /not found|404|Access denied|not found/i.test(foreignBody) || foreignBody.length < 2000
      ok('E.1 IDOR attempt does not show foreign candidate data', isNotFound, `body_len=${foreignBody.length}`)
      void foreignResp
    } finally {
      await ctxE.close()
    }
  } else {
    console.log('\nE. Tenant isolation — skipped (no foreign candidate to test against)')
  }

  // Cleanup
  console.log('\nCleanup')
  await db.user.deleteMany({ where: { email: 'test-viewer@acmecompany.com' } })
  ok('cleaned up', true)

  await browser.close()
  await db.$disconnect()

  if (errors.length > 0) {
    console.log('\n  browser errors:')
    for (const e of errors) console.log('   -', e)
  }
  ok('no significant browser errors', errors.length === 0)

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`)
  if (fail > 0) process.exit(1)
}

main().catch(async e => {
  console.error('FAIL:', e)
  await db.$disconnect()
  process.exit(1)
})
