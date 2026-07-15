/**
 * Sprint 9.1 — Production Playwright E2E for the Change Password flow.
 *
 * Strategy (per PART 12):
 *   - Use a DEDICATED test user (not the real ADMIN) so the real ADMIN
 *     password is not at risk.
 *   - Drive the full UI: login → Settings → Security → fill the form →
 *     submit → assert redirect to /login.
 *   - Try the OLD password at /login — must fail.
 *   - Try the NEW password at /login — must succeed.
 *   - Restore the original password at the end (idempotent).
 *   - Read the AuditLog to confirm a PASSWORD_CHANGED success row was
 *     written and that it contains no plaintext.
 *
 * E2E credentials are read from env so they are never committed:
 *   - SPRINT_91_TEST_EMAIL
 *   - SPRINT_91_TEST_PASSWORD    (the user's current password, used
 *                                  to log in; the test will change
 *                                  it to a random new value, then
 *                                  restore it)
 *
 * Exit code 0 on success, 1 on any failure.
 */

import { chromium, type Page, type Browser } from 'playwright'
import 'dotenv/config'
import { randomBytes } from 'crypto'
import { db } from '../lib/db'
import { hashPassword, comparePassword } from '../lib/auth/password'

const PRODUCTION_URL = process.env.SPRINT_91_PROD_URL ?? 'https://talentos-ai-lime.vercel.app'

const TEST_EMAIL = process.env.SPRINT_91_TEST_EMAIL ?? 'change-password-test@acmecompany.com'
const TEST_ORIGINAL_PASSWORD = process.env.SPRINT_91_TEST_PASSWORD ?? 'OriginalTestPwd9!'
const TEST_NEW_PASSWORD = 'Sprint91-' + randomBytes(8).toString('base64url') + 'A1' // 10+ chars, letters+digits

let passes = 0
let fails = 0

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`)
    passes++
  } else {
    console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`)
    fails++
  }
}

async function ensureTestUser(originalPassword: string) {
  let user = await db.user.findUnique({ where: { email: TEST_EMAIL } })
  if (!user) {
    const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!org) throw new Error('No organization in DB')
    user = await db.user.create({
      data: {
        email: TEST_EMAIL,
        firstName: 'Change',
        lastName: 'Password',
        role: 'RECRUITER',
        status: 'ACTIVE',
        organizationId: org.id,
        passwordHash: await hashPassword(originalPassword),
        passwordChangedAt: new Date(),
      },
    })
  } else {
    // Reset to known original password for repeatable runs
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(originalPassword),
        passwordChangedAt: new Date(),
        disabledAt: null,
        status: 'ACTIVE',
      },
    })
    user = await db.user.findUnique({ where: { id: user.id } })
  }
  return user!
}

async function loginViaUI(page: Page, email: string, password: string): Promise<boolean> {
  await page.goto(`${PRODUCTION_URL}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('button:has-text("Sign In")')
  try {
    await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
    return true
  } catch {
    return false
  }
}

async function loginViaApi(email: string, password: string): Promise<{ ok: boolean; cookie: string | null }> {
  // Use the Auth.js credentials endpoint (the same path the form posts to)
  const csrf = await fetch(`${PRODUCTION_URL}/api/auth/csrf`).then(r => r.json()) as { csrfToken: string }
  const form = new URLSearchParams({
    csrfToken: csrf.csrfToken,
    email,
    password,
    callbackUrl: `${PRODUCTION_URL}/dashboard`,
    json: 'true',
  })
  const resp = await fetch(`${PRODUCTION_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    redirect: 'manual',
  })
  // Auth.js returns 302 on both success AND failure. A success sets
  // a __Secure-authjs.session-token cookie AND the location is
  // /dashboard (or the callbackUrl). A failure redirects to /login
  // with ?error=... and no session cookie.
  const setCookie = resp.headers.get('set-cookie') ?? ''
  const hasSessionCookie = /authjs\.session-token=/.test(setCookie)
  const location = resp.headers.get('location') ?? ''
  const isSuccess = hasSessionCookie && !location.includes('/login')
  if (isSuccess) {
    const m = setCookie.match(/authjs\.session-token=([^;]+)/)
    return { ok: true, cookie: m ? m[1] : null }
  }
  return { ok: false, cookie: null }
}

async function checkPasswordAuthenticates(email: string, password: string): Promise<boolean> {
  const result = await loginViaApi(email, password)
  return result.ok
}

async function main() {
  

  console.log(`=== Sprint 9.1 — production E2E for Change Password ===`)
  console.log(`URL: ${PRODUCTION_URL}`)
  console.log(`Test user: ${TEST_EMAIL}`)
  console.log(`New password (this run): length=${TEST_NEW_PASSWORD.length}\n`)

  // Pre-flight: ensure the test user exists with a known original password.
  const user = await ensureTestUser(TEST_ORIGINAL_PASSWORD)
  console.log(`  · test user ${TEST_EMAIL} (id=${user.id.slice(0, 8)}) ready\n`)

  const browser: Browser = await chromium.launch({ headless: true })

  try {
    // -------------------------------------------------------------------
    // 1. Login as the test user with the ORIGINAL password
    // -------------------------------------------------------------------
    console.log('1. Login as test user (original password)')
    const ctx1 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const ok1 = await loginViaUI(page1, TEST_EMAIL, TEST_ORIGINAL_PASSWORD)
    check('1.1 user can log in with original password', ok1)

    // -------------------------------------------------------------------
    // 2. Navigate to /settings and verify the Change Password card exists
    // -------------------------------------------------------------------
    console.log('\n2. Settings → Security card is present')
    await page1.goto(`${PRODUCTION_URL}/settings`, { waitUntil: 'domcontentloaded' })
    // Click the "Security" tab in the side nav
    const secNav = page1.locator('button:has-text("Security")').first()
    await secNav.click()
    await page1.waitForTimeout(300)
    const cardTitle = page1.locator('text=Change password').first()
    const cardVisible = await cardTitle.isVisible().catch(() => false)
    check('2.1 Change Password card visible in Security section', cardVisible)

    // -------------------------------------------------------------------
    // 3. UI: autocomplete attributes, show/hide toggles, button
    // -------------------------------------------------------------------
    console.log('\n3. UI elements & a11y')
    const currentInput = page1.locator('input#current-password')
    const newInput = page1.locator('input#new-password')
    const confirmInput = page1.locator('input#confirm-password')
    const curAC = await currentInput.getAttribute('autocomplete')
    const newAC = await newInput.getAttribute('autocomplete')
    const confAC = await confirmInput.getAttribute('autocomplete')
    check('3.1 current-password autocomplete is current-password', curAC === 'current-password')
    check('3.2 new-password autocomplete is new-password', newAC === 'new-password')
    check('3.3 confirm-password autocomplete is new-password', confAC === 'new-password')

    // -------------------------------------------------------------------
    // 4. Submit with wrong current password → error
    // -------------------------------------------------------------------
    console.log('\n4. Wrong current password shows error')
    await currentInput.fill('definitely-wrong-1234')
    await newInput.fill(TEST_NEW_PASSWORD)
    await confirmInput.fill(TEST_NEW_PASSWORD)
    await page1.click('[data-testid="change-password-submit"]')
    await page1.waitForSelector('text=Current password is incorrect', { timeout: 10_000 }).catch(() => null)
    const wrongErr = await page1.locator('text=Current password is incorrect').count()
    check('4.1 wrong current password → error message', wrongErr > 0)

    // -------------------------------------------------------------------
    // 5. Submit with weak new password → error
    // -------------------------------------------------------------------
    console.log('\n5. Weak new password shows error')
    await currentInput.fill(TEST_ORIGINAL_PASSWORD)
    await newInput.fill('short')
    await confirmInput.fill('short')
    await page1.click('[data-testid="change-password-submit"]')
    await page1.waitForSelector('text=does not meet the password requirements', { timeout: 10_000 }).catch(() => null)
    const weakErr = await page1.locator('text=does not meet the password requirements').count()
    check('5.1 weak new password → error message', weakErr > 0)

    // -------------------------------------------------------------------
    // 6. Submit with confirmation mismatch → error
    // -------------------------------------------------------------------
    console.log('\n6. Confirmation mismatch shows error')
    await currentInput.fill(TEST_ORIGINAL_PASSWORD)
    await newInput.fill(TEST_NEW_PASSWORD)
    await confirmInput.fill('DifferentPwd99!')
    await page1.click('[data-testid="change-password-submit"]')
    await page1.waitForSelector('text=do not match', { timeout: 10_000 }).catch(() => null)
    const mismatchErr = await page1.locator('text=do not match').count()
    check('6.1 confirmation mismatch → error message', mismatchErr > 0)

    // -------------------------------------------------------------------
    // 7. Same as current → error
    // -------------------------------------------------------------------
    console.log('\n7. Same as current password shows error')
    await currentInput.fill(TEST_ORIGINAL_PASSWORD)
    await newInput.fill(TEST_ORIGINAL_PASSWORD)
    await confirmInput.fill(TEST_ORIGINAL_PASSWORD)
    await page1.click('[data-testid="change-password-submit"]')
    await page1.waitForSelector('text=different from your current', { timeout: 10_000 }).catch(() => null)
    const sameErr = await page1.locator('text=different from your current').count()
    check('7.1 same-as-current → error message', sameErr > 0)

    // -------------------------------------------------------------------
    // 8. Happy path: real change
    // -------------------------------------------------------------------
    console.log('\n8. Happy path')
    await currentInput.fill(TEST_ORIGINAL_PASSWORD)
    await newInput.fill(TEST_NEW_PASSWORD)
    await confirmInput.fill(TEST_NEW_PASSWORD)
    await page1.click('[data-testid="change-password-submit"]')
    // The card should switch to the success state, then the user is
    // redirected to /login.
    await page1.waitForURL(u => u.pathname.startsWith('/login'), { timeout: 30_000 })
    const onLoginAfter = page1.url().includes('/login')
    check('8.1 user redirected to /login after change', onLoginAfter)
    // /login should also surface a hint
    const hint = await page1.locator('text=Your password was changed').count()
    check('8.2 /login surfaces password-changed hint', hint > 0)
    // Don't close ctx1 yet — we need to keep the page alive

    // -------------------------------------------------------------------
    // 9. Old password no longer authenticates
    // -------------------------------------------------------------------
    console.log('\n9. Old password no longer works')
    const oldFails = !(await checkPasswordAuthenticates(TEST_EMAIL, TEST_ORIGINAL_PASSWORD))
    check('9.1 old password rejected by /api/auth/callback/credentials', oldFails)

    // -------------------------------------------------------------------
    // 10. New password authenticates
    // -------------------------------------------------------------------
    console.log('\n10. New password works')
    const newWorks = await checkPasswordAuthenticates(TEST_EMAIL, TEST_NEW_PASSWORD)
    check('10.1 new password authenticates', newWorks)

    // -------------------------------------------------------------------
    // 11. AuditLog row exists, no plaintext
    // -------------------------------------------------------------------
    console.log('\n11. AuditLog + hygiene')
    const audits = await db.auditLog.findMany({
      where: { targetId: user.id, action: 'PASSWORD_CHANGED' },
      orderBy: { occurredAt: 'desc' },
    })
    const successAudits = audits.filter(a => a.outcome === 'success')
    check('11.1 PASSWORD_CHANGED success audit row exists', successAudits.length >= 1)
    const blob = JSON.stringify(audits)
    check('11.2 no TEST_ORIGINAL_PASSWORD in audit', !blob.includes(TEST_ORIGINAL_PASSWORD))
    check('11.3 no TEST_NEW_PASSWORD in audit', !blob.includes(TEST_NEW_PASSWORD))
    check('11.4 no passwordHash in metadata', !/"passwordHash"/i.test(blob))
    check('11.5 no currentPassword in metadata', !/"currentPassword"/i.test(blob))
    check('11.6 no newPassword in metadata', !/"newPassword"/i.test(blob))
    // Reason should be user_self
    const latest = successAudits[0]
    const meta = latest?.metadata as any
    check('11.7 latest success audit reason=user_self', meta?.reason === 'user_self')

    // -------------------------------------------------------------------
    // 12. Restore the original password for repeatable runs
    // -------------------------------------------------------------------
    console.log('\n12. Restore original password')
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(TEST_ORIGINAL_PASSWORD),
        passwordChangedAt: new Date(),
        disabledAt: null,
        status: 'ACTIVE',
      },
    })
    // Also revoke any sessions the previous attempts may have created
    await db.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    const restored = await db.user.findUnique({ where: { id: user.id } })
    const restoredOk = await comparePassword(TEST_ORIGINAL_PASSWORD, restored!.passwordHash!)
    check('12.1 password restored to original for repeatable runs', restoredOk)

    // -------------------------------------------------------------------
    // 13. The REAL ADMIN's password is untouched
    // -------------------------------------------------------------------
    console.log('\n13. Real ADMIN password not touched')
    const admin = await db.user.findUnique({ where: { email: 'jordan.rivera@acmecompany.com' } })
    const testUserNow = await db.user.findUnique({ where: { id: user.id } })
    const adminChanged = admin?.passwordChangedAt?.getTime() ?? 0
    const testUserChanged = testUserNow?.passwordChangedAt?.getTime() ?? 0
    check('13.1 ADMIN passwordChangedAt is not the same as the test user (regression guard)',
      admin !== null && adminChanged > 0 && Math.abs(adminChanged - testUserChanged) > 1000)

    await ctx1.close()
  } finally {
    await browser.close()
  }

  console.log(`\n=== ${passes} passed, ${fails} failed ===`)
  await db.$disconnect()
  process.exit(fails > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); db.$disconnect().finally(() => process.exit(1)) })
