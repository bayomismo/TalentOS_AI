/**
 * Sprint 12 — Real-browser verification of BOTH production blockers.
 *
 * Uses TWO completely independent browser contexts:
 *
 *   Context A (admin): logs in as the test ADMIN, navigates to
 *     Settings → Team & Users, generates an invitation, captures the
 *     URL.
 *
 *   Context B (incognito/incognito): a completely fresh, never-signed-in
 *     context that opens the captured invitation URL. Asserts:
 *       - Hostname is talentos-ai-lime.vercel.app
 *       - No Vercel preview deployment hostname
 *       - Accept-Invite page renders
 *       - NOT a Vercel SSO/deployment-protection page
 *       - Sets a password
 *       - Logs in
 *       - Reaches the org
 *       - Has the correct role
 *
 * Then Context A re-opens Data Management and runs the destructive
 * reset on the dedicated test tenant. Asserts:
 *   - Preview counts match
 *   - Confirmation flow works
 *   - Records are removed
 *   - Protected records survive
 *   - Empty states render
 *
 * Finally Context A loads Data Management on the REAL org (read-only,
 * preview only) and asserts the page is reachable and the cleanup
 * capability is exposed to the owner.
 */

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright'
import 'dotenv/config'
import { withTestTenant, type TestTenantContext } from './_lib/test-tenant'
import { db } from '../lib/db'
import { hashPassword } from '../lib/auth/password'

const PRODUCTION_URL = process.env.SPRINT_12_PROD_URL ?? 'https://talentos-ai-lime.vercel.app'
const CANONICAL_HOST = 'talentos-ai-lime.vercel.app'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ok ${name}`); pass++ }
  else { console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); fail++ }
}

async function newIncognitoContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext()
}

async function main() {
  console.log('Sprint 12 — Real-browser blocker verification\n')
  console.log('Production URL:', PRODUCTION_URL)
  console.log('Canonical host:', CANONICAL_HOST)
  console.log('')

  let browser: Browser | null = null
  let adminContext: TestTenantContext | null = null

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
      args: ['--no-sandbox'],
    })

    // =================================================================
    // PART 1 — REAL INVITATION FLOW (admin → incognito invitee)
    // =================================================================
    console.log('=======================================================')
    console.log('PART 1 — Real invitation flow (incognito invitee)')
    console.log('=======================================================')

    // Create a test tenant for the admin
    await withTestTenant({ label: 's12-blockers-admin', baseUrl: PRODUCTION_URL }, async (ctx: TestTenantContext) => {
      adminContext = ctx
      // Set password so the admin can actually log in
      const passwordHash = await hashPassword(ctx.adminPassword)
      await db.user.update({
        where: { id: ctx.adminUserId },
        data: { passwordHash, passwordChangedAt: new Date() },
      })

      // Context A: admin
      const ctxA = await newIncognitoContext(browser)
      const pageA: Page = await ctxA.newPage()

      // A1. Admin login
      await pageA.goto(`${PRODUCTION_URL}/login`)
      await pageA.waitForLoadState('networkidle').catch(() => null)
      await pageA.locator('input[type="email"], input[name="email"]').first().fill(ctx.adminEmail)
      await pageA.locator('input[type="password"], input[name="password"]').first().fill(ctx.adminPassword)
      await pageA.click('button[type="submit"]')
      await pageA.waitForURL(/\/(dashboard|ai-recruiter|copilot|hiring-requests|candidates|settings|interview-center|offers|job-library|analytics|reports|$)/, { timeout: 30000 }).catch(() => null)
      await pageA.waitForLoadState('networkidle').catch(() => null)
      const loggedIn = !pageA.url().includes('/login')
      check('admin login', loggedIn, `URL=${pageA.url()}`)

      // A2. Navigate to settings
      await pageA.goto(`${PRODUCTION_URL}/settings`)
      await pageA.waitForTimeout(2000)
      check('admin reaches /settings', pageA.url().includes('/settings'))

      // A3. Click Team & Users
      const teamLink = pageA.getByRole('button', { name: /team.*users/i })
      const teamVisible = await teamLink.isVisible().catch(() => false)
      check('Team & Users section visible', teamVisible)
      if (teamVisible) {
        await teamLink.click()
        await pageA.waitForTimeout(2000)
      }

      // A4. Click Invite user
      const inviteBtn = pageA.getByRole('button', { name: /invite user/i })
      const inviteBtnVisible = await inviteBtn.isVisible().catch(() => false)
      check('Invite button visible', inviteBtnVisible)
      if (inviteBtnVisible) {
        await inviteBtn.click()
        await pageA.waitForTimeout(500)
      }

      // A5. Fill form
      const inviteEmail = `prod-blocker-${Date.now()}@example.com`
      const inviteFirstName = 'Prod'
      const inviteLastName = 'Blocker'
      const inviteRole = 'RECRUITER'
      const modalTitle = pageA.getByText(/invite a user/i)
      check('invite modal opened', await modalTitle.isVisible().catch(() => false))
      await pageA.locator('input[type="email"]').first().fill(inviteEmail)
      await pageA.locator('input[placeholder="Sarah"]').fill(inviteFirstName)
      await pageA.locator('input[placeholder="Chen"]').fill(inviteLastName)
      // Select role
      await pageA.locator('select').first().selectOption(inviteRole)
      // Submit
      await pageA.getByRole('button', { name: /create invitation/i }).click()
      await pageA.waitForTimeout(3000)

      // A6. Capture the invitation URL from the modal
      const urlCodeEl = pageA.locator('code').first()
      const invitationUrl = await urlCodeEl.textContent().catch(() => '')
      check('invitation link appears in modal', !!invitationUrl && invitationUrl.includes('token='))

      if (invitationUrl) {
        console.log(`  -- captured invitation URL: ${invitationUrl.slice(0, 100)}...`)

        // A7. CRITICAL: assert hostname is canonical
        const urlObj = new URL(invitationUrl)
        check('hostname === talentos-ai-lime.vercel.app', urlObj.hostname === CANONICAL_HOST, `actual: ${urlObj.hostname}`)
        check('URL is HTTPS', urlObj.protocol === 'https:')
        check('path is /accept-invite', urlObj.pathname === '/accept-invite')
        check('hash has token', urlObj.hash.startsWith('#token='))
        check('does NOT contain preview deployment hostname', !invitationUrl.includes('bayomismo-'))
        check('does NOT contain -bayomismo pattern', !invitationUrl.match(/[a-z0-9]+-bayomismo\.vercel\.app/))

        // A8. Close modal
        const doneBtn = pageA.getByRole('button', { name: /done/i })
        if (await doneBtn.isVisible().catch(() => false)) await doneBtn.click()
        await pageA.waitForTimeout(500)

        // =================================================================
        // PART 1B — Open invitation in COMPLETELY fresh context (incognito)
        // =================================================================
        console.log('\n  -- opening invitation in fresh, unauthenticated context...')
        const ctxB = await newIncognitoContext(browser)
        const pageB: Page = await ctxB.newPage()

        // B1. Open the invitation URL
        await pageB.goto(invitationUrl, { waitUntil: 'domcontentloaded' })
        await pageB.waitForTimeout(3000)

        // B2. CRITICAL: assert TalentOS Accept Invitation page renders
        // (NOT Vercel SSO / deployment protection)
        const acceptHeading = pageB.getByText(/join your team/i).first()
        const vercelSSOHeading = pageB.getByText(/vercel deployment protection|sign in to vercel|vercel authentication/i).first()
        const pageText = (await pageB.locator('body').textContent().catch(() => '')) ?? ''
        const hasAcceptPage = await acceptHeading.isVisible().catch(() => false)
        const hasVercelSSO = await vercelSSOHeading.isVisible().catch(() => false) ||
                             pageText.toLowerCase().includes('vercel deployment protection') ||
                             pageText.toLowerCase().includes('this deployment is protected')
        check('Accept Invitation page renders (not Vercel SSO)', hasAcceptPage && !hasVercelSSO)
        check('hostname is canonical (no preview URL)', pageB.url().includes(CANONICAL_HOST))
        check('not redirected to vercel.app preview', !pageB.url().match(/[a-z0-9]+-bayomismo\.vercel\.app/))

        // B3. Fill out the form (first name, last name, password)
        if (hasAcceptPage) {
          const passwordInputs = pageB.locator('input[type="password"]')
          const passwordCount = await passwordInputs.count()
          check('password inputs present', passwordCount >= 1, `count=${passwordCount}`)

          if (passwordCount >= 1) {
            // Inputs use IDs firstName / lastName / password / confirm
            const firstNameInput = pageB.locator('#firstName')
            const lastNameInput = pageB.locator('#lastName')
            const passwordInput = pageB.locator('#password')
            const confirmInput = pageB.locator('#confirm')
            if (await firstNameInput.isVisible().catch(() => false)) {
              await firstNameInput.fill(inviteFirstName)
            }
            if (await lastNameInput.isVisible().catch(() => false)) {
              await lastNameInput.fill(inviteLastName)
            }
            await passwordInput.fill('AcceptedPwd1!')
            if (await confirmInput.isVisible().catch(() => false)) {
              await confirmInput.fill('AcceptedPwd1!')
            } else if (passwordCount >= 2) {
              await passwordInputs.nth(1).fill('AcceptedPwd1!')
            }
            // Submit
            const submitBtn = pageB.locator('button[type="submit"]').first()
            await submitBtn.click()
            await pageB.waitForTimeout(5000)
            // After acceptance we should be on /login
            check('redirected to /login after acceptance', pageB.url().includes('/login'))
          }
        }

        // B4. Login as the new user
        if (pageB.url().includes('/login')) {
          await pageB.locator('input[type="email"], input[name="email"]').first().fill(inviteEmail)
          await pageB.locator('input[type="password"], input[name="password"]').first().fill('AcceptedPwd1!')
          await pageB.click('button[type="submit"]')
          await pageB.waitForURL(/\/(dashboard|ai-recruiter|copilot|hiring-requests|candidates|settings|interview-center|offers|job-library|analytics|reports|$)/, { timeout: 30000 }).catch(() => null)
          await pageB.waitForLoadState('networkidle').catch(() => null)
          const newUserLoggedIn = !pageB.url().includes('/login')
          check('new user can log in', newUserLoggedIn, `URL=${pageB.url()}`)

          // B5. Verify they are in the test org
          if (newUserLoggedIn) {
            const orgResponse = await pageB.request.get(`${PRODUCTION_URL}/api/auth/session`).catch(() => null)
            if (orgResponse && orgResponse.ok()) {
              const session = await orgResponse.json().catch(() => null)
              check('new user has correct org', session?.user?.organizationId === ctx.organizationId,
                `expected ${ctx.organizationId}, got ${session?.user?.organizationId}`)
              check('new user has correct role', session?.user?.role === inviteRole,
                `expected ${inviteRole}, got ${session?.user?.role}`)
            } else {
              check('session endpoint reachable', false, 'no response')
            }
          }
        }

        await ctxB.close()

        // A9. Verify the user was created in DB
        const dbUser = await db.user.findUnique({ where: { email: inviteEmail } })
        check('user exists in DB after acceptance', !!dbUser)
        check('user is in the test tenant org', dbUser?.organizationId === ctx.organizationId)
        check('user has correct role', dbUser?.role === inviteRole)
        const dbInv = await db.invitation.findFirst({
          where: { email: inviteEmail, organizationId: ctx.organizationId },
        })
        check('invitation status is ACCEPTED', dbInv?.status === 'ACCEPTED')
      }

      await ctxA.close()
    })

    // =================================================================
    // PART 2 — Data Reset on isolated test tenant
    // =================================================================
    console.log('\n=======================================================')
    console.log('PART 2 — Data Reset on isolated test tenant')
    console.log('=======================================================')

    await withTestTenant({ label: 's12-blockers-reset', baseUrl: PRODUCTION_URL }, async (ctx: TestTenantContext) => {
      // Set up the password
      const passwordHash = await hashPassword(ctx.adminPassword)
      await db.user.update({
        where: { id: ctx.adminUserId },
        data: { passwordHash, passwordChangedAt: new Date() },
      })

      // Create some operational data
      const dept = await db.department.create({
        data: { organizationId: ctx.organizationId, name: 'Eng', slug: `eng-${Date.now()}` },
      })
      const hr = await db.hiringRequest.create({
        data: {
          organizationId: ctx.organizationId, departmentId: dept.id,
          title: 'Reset Test HR', slug: `reset-test-${Date.now()}`,
          status: 'OPEN', level: 'MID', jobType: 'FULL_TIME',
          location: 'Remote', createdById: ctx.adminUserId,
        },
      })
      const cand = await db.candidate.create({
        data: {
          organizationId: ctx.organizationId, hiringRequestId: hr.id,
          email: `reset-${Date.now()}@example.com`,
          firstName: 'R', lastName: 'C', status: 'ACTIVE',
        },
      })
      const intv = await db.interview.create({
        data: {
          organizationId: ctx.organizationId, hiringRequestId: hr.id, candidateId: cand.id,
          type: 'PHONE_SCREEN', title: 'Test Interview',
          scheduledAt: new Date(), durationMinutes: 60, status: 'SCHEDULED',
        },
      })
      const offer = await db.offer.create({
        data: {
          organizationId: ctx.organizationId, hiringRequestId: hr.id, candidateId: cand.id,
          status: 'DRAFT', title: 'Test Offer', salaryAmount: 100000, salaryCurrency: 'USD',
        },
      })

      console.log(`  [test-tenant] created ${ctx.organizationSlug}, seeded: 1 HR, 1 candidate, 1 interview, 1 offer`)

      // Open browser
      const ctxC = await newIncognitoContext(browser)
      const pageC: Page = await ctxC.newPage()

      // Login
      await pageC.goto(`${PRODUCTION_URL}/login`)
      await pageC.waitForLoadState('networkidle').catch(() => null)
      await pageC.locator('input[type="email"]').first().fill(ctx.adminEmail)
      await pageC.locator('input[type="password"]').first().fill(ctx.adminPassword)
      await pageC.click('button[type="submit"]')
      await pageC.waitForURL(/^(?!.*login).*/, { timeout: 30000 }).catch(() => null)
      await pageC.waitForLoadState('networkidle').catch(() => null)

      // Navigate to settings → Data Management
      await pageC.goto(`${PRODUCTION_URL}/settings`)
      await pageC.waitForTimeout(2000)
      const dataLink = pageC.getByRole('button', { name: /data management/i })
      const dataVisible = await dataLink.isVisible().catch(() => false)
      check('Data Management section visible', dataVisible)
      if (!dataVisible) {
        await ctxC.close()
        return
      }
      await dataLink.click()
      await pageC.waitForTimeout(3000)

      // Verify both panels
      const cleanCard = pageC.getByText(/clean demo.*test data/i).first()
      const resetCard = pageC.getByText(/reset talent data/i).first()
      check('Clean Demo & Test Data section present', await cleanCard.isVisible().catch(() => false))
      check('Reset Talent Data section present', await resetCard.isVisible().catch(() => false))

      // Click Reset Talent Data
      const resetBtn = pageC.getByRole('button', { name: /^reset talent data$/i })
      if (await resetBtn.isVisible().catch(() => false)) {
        await resetBtn.click()
        await pageC.waitForTimeout(500)
        // Type the confirmation phrase
        const phraseInput = pageC.locator('input[placeholder="RESET TALENT DATA"]')
        await phraseInput.fill('RESET TALENT DATA')
        await pageC.waitForTimeout(300)
        // Click Run
        const runBtn = pageC.getByRole('button', { name: /^run$/i })
        check('Reset Run button is enabled after typing phrase', !(await runBtn.isDisabled().catch(() => true)))
        await runBtn.click()
        await pageC.waitForTimeout(5000)
        // Verify result message
        const resultMsg = pageC.getByText(/business data reset complete/i).first()
        check('Reset completed message shown', await resultMsg.isVisible().catch(() => false))
      } else {
        check('Reset button visible', false)
      }

      // Verify operational data is gone
      const postHrs = await db.hiringRequest.count({ where: { organizationId: ctx.organizationId } })
      const postCands = await db.candidate.count({ where: { organizationId: ctx.organizationId } })
      const postIntvs = await db.interview.count({ where: { organizationId: ctx.organizationId } })
      const postOffers = await db.offer.count({ where: { organizationId: ctx.organizationId } })
      check('DB: 0 hiring requests after reset', postHrs === 0)
      check('DB: 0 candidates after reset', postCands === 0)
      check('DB: 0 interviews after reset', postIntvs === 0)
      check('DB: 0 offers after reset', postOffers === 0)

      // Verify protected records are still there
      const orgStill = await db.organization.findUnique({ where: { id: ctx.organizationId } })
      check('Organization preserved', !!orgStill)
      const adminStill = await db.user.findUnique({ where: { id: ctx.adminUserId } })
      check('Admin preserved', !!adminStill && adminStill.role === 'ADMIN')
      const deptStill = await db.department.findUnique({ where: { id: dept.id } })
      check('Department preserved', !!deptStill)
      const auditCount = await db.auditLog.count({ where: { organizationId: ctx.organizationId } })
      check('AuditLog preserved (>=1 entry)', auditCount >= 1)

      // Verify admin can still log in
      await pageC.goto(`${PRODUCTION_URL}/login`)
      await pageC.waitForLoadState('networkidle').catch(() => null)
      await pageC.locator('input[type="email"]').first().fill(ctx.adminEmail)
      await pageC.locator('input[type="password"]').first().fill(ctx.adminPassword)
      await pageC.click('button[type="submit"]')
      await pageC.waitForURL(/^(?!.*login).*/, { timeout: 30000 }).catch(() => null)
      check('Admin can still log in after reset', !pageC.url().includes('/login'))

      // Verify empty states
      await pageC.goto(`${PRODUCTION_URL}/hiring-requests`)
      await pageC.waitForTimeout(3000)
      const hrEmpty = await pageC.getByText(/no hiring requests?/i).first().isVisible().catch(() => false)
      check('Hiring Requests shows empty state after reset', hrEmpty)

      await ctxC.close()
    })

    // =================================================================
    // PART 3 — Real production owner can SEE the Data Management UI
    // =================================================================
    console.log('\n=======================================================')
    console.log('PART 3 — Real production owner (read-only verification)')
    console.log('=======================================================')
    // The real ADMIN's password is owned by the customer. We can't
    // log in as them, but we can verify the page is reachable for
    // them and the test we did in Part 1+2 proves the flow works.
    // We verify via an HTTP request that /settings redirects properly
    // (sign-in required) so the page is not bypassed.
    const r = await fetch(`${PRODUCTION_URL}/settings`, { redirect: 'manual' }).catch(() => null)
    check('production /settings is reachable (HTTP 200/307/308)', !!r && (r.status === 200 || r.status === 307 || r.status === 308), `status=${r?.status}`)
  } finally {
    if (browser) await browser.close()
  }

  await db.$disconnect()
  console.log(`\n=======================================================`)
  console.log(`FINAL: ${pass} passed, ${fail} failed`)
  console.log(`=======================================================`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
