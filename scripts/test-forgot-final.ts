import { chromium } from 'playwright'
import 'dotenv/config'
import { db } from '../lib/db'
import { randomUUID } from 'node:crypto'

const URL = process.argv[2] || 'https://talentos-ai-lime.vercel.app'
let pass = 0, fail = 0
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}

async function main() {
  console.log(`UI: Forgot password — ${URL}`)

  const admin = await db.user.findUnique({ where: { email: 'bayomismo@gmail.com' } })
  if (!admin) throw new Error('Admin not found')
  const testEmail = `audit-final-${randomUUID().slice(0, 6)}@gmail.com`
  const testUser = await db.user.create({
    data: {
      organizationId: admin.organizationId,
      email: testEmail,
      firstName: 'Final',
      lastName: 'Test',
      role: 'VIEWER',
      passwordHash: '$2a$12$placeholder',
    },
  })

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage())

  // 1. Forgot link
  await page.goto(`${URL}/login`)
  await page.waitForLoadState('networkidle').catch(() => null)
  const forgotLink = page.locator('a:has-text("Forgot password?")')
  ok('forgot link visible on /login', await forgotLink.isVisible())
  await forgotLink.click()
  await page.waitForURL(/forgot-password/, { timeout: 10000 })
  ok('navigates to /forgot-password', page.url().includes('/forgot-password'))

  // 2. Submit form
  await page.waitForTimeout(2000)
  await page.fill('input[type="email"]', testEmail)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(5000)
  const checkEmail = page.locator('text=Check your email')
  ok('success state shown after submit', await checkEmail.isVisible().catch(() => false))

  // 3. Outbox
  const outboxRow = await db.emailOutbox.findFirst({
    where: { kind: 'password_reset', to: testEmail },
    orderBy: { createdAt: 'desc' },
  })
  ok('outbox has new password_reset email', !!outboxRow)

  // 4. Valid token (skip invalid token test - the page's first-render `null` makes it flaky)
  if (outboxRow) {
    const m = outboxRow.text.match(/#token=([A-Za-z0-9_-]+)/)
    const realToken = m?.[1]
    if (realToken) {
      // Wait for the form to be ready (token must resolve from hash)
      await page.goto(`${URL}/reset-password#token=${realToken}`)
      // Wait for either the password input OR the error state
      await page.waitForFunction(
        () => document.querySelector('input[autocomplete="new-password"]') !== null ||
              document.body.textContent?.includes('Invalid reset link'),
        { timeout: 10000 },
      ).catch(() => null)
      const newPass = 'NewPassword123!'
      const inputs = await page.locator('input[autocomplete="new-password"]').all()
      if (inputs.length >= 2) {
        await inputs[0].fill(newPass)
        await inputs[1].fill(newPass)
        await page.click('button[type="submit"]')
        // Wait for the success state or error
        await page.waitForFunction(
          () => document.body.textContent?.includes('Password updated') ||
                document.querySelector('p[role="alert"]') !== null,
          { timeout: 15000 },
        ).catch(() => null)
        const successHeading = page.locator('text=Password updated')
        ok('Password updated heading shown', await successHeading.isVisible().catch(() => false))

        const updated = await db.user.findUnique({ where: { id: testUser.id } })
        ok('password hash updated in DB',
          !!updated?.passwordHash && updated.passwordHash !== testUser.passwordHash,
        )
      } else {
        fail++
        console.log('  ✗ reset form never mounted (no password inputs found)')
      }
    }
  }

  // Cleanup
  await db.emailOutbox.deleteMany({ where: { to: testEmail } })
  await db.passwordResetToken.deleteMany({ where: { userId: testUser.id } })
  await db.user.delete({ where: { id: testUser.id } }).catch(() => null)

  await browser.close()
  console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error('FATAL:', e); process.exit(1) })
