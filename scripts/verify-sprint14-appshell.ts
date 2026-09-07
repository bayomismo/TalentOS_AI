/**
 * Sprint 14 hotfix — Focused AppShell Playwright regression.
 *
 * For every authenticated core route, asserts:
 *   - Page-specific heading is visible and above the fold
 *   - Main content has non-zero visible dimensions
 *   - Header is visible at the top
 *   - Sidebar is visible on desktop
 *   - No pageerror
 *   - No console.error
 *   - Body does not have abnormal horizontal overflow
 *
 * For /ai-recruiter specifically, asserts the AI Recruiter main
 * interactive content is visible above the fold.
 *
 * Saves screenshots as artifacts.
 */

import { chromium, type Page, type BrowserContext } from 'playwright'
import 'dotenv/config'
import { mkdirSync } from 'fs'
import { db } from '../lib/db'
import { hashPassword } from '../lib/auth/password'

const PRODUCTION_URL = process.env.SPRINT_14_PROD_URL ?? 'https://talentos-ai-lime.vercel.app'
const ADMIN_EMAIL = process.env.REPRO_ADMIN_EMAIL ?? 'bayomismo@gmail.com'
const ADMIN_PASSWORD = process.env.REPRO_ADMIN_PASSWORD ?? 'ProdHotfix1!!'

const ROUTES = [
  { path: '/dashboard', expectHeading: /recruitment dashboard|dashboard/i },
  { path: '/ai-recruiter', expectHeading: /ai recruiter|what role are you hiring|good morning/i },
  { path: '/hiring-requests', expectHeading: /hiring requests?/i },
  { path: '/candidates', expectHeading: /candidates?/i },
  { path: '/interview-center', expectHeading: /interview center/i },
  { path: '/offers', expectHeading: /offers?/i },
  { path: '/copilot', expectHeading: /copilot|ai copilot/i },
  { path: '/analytics', expectHeading: /analytics/i },
  { path: '/reports', expectHeading: /reports?/i },
  { path: '/settings', expectHeading: /settings/i },
]

const SHOT_DIR = '/tmp/appshell-hotfix'
mkdirSync(SHOT_DIR, { recursive: true })

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ok ${name}`); pass++ }
  else { console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); fail++ }
}

async function checkRoute(page: Page, path: string, expectHeading: RegExp) {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', e => pageErrors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })

  await page.goto(`${PRODUCTION_URL}${path}`)
  await page.waitForLoadState('networkidle').catch(() => null)
  await page.waitForTimeout(1200)

  // Screenshot
  const safe = path.replace(/\//g, '_') || 'root'
  await page.screenshot({ path: `${SHOT_DIR}${safe}.png`, fullPage: false })

  // No horizontal overflow
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.body.clientWidth,
  }))
  check(`${path}: no horizontal overflow`, overflow.scrollWidth <= overflow.clientWidth + 2,
    `scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth}`)

  // Header at the top
  const header = await page.evaluate(() => {
    const el = document.querySelector('header') as HTMLElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  })
  check(`${path}: header is present`, !!header)
  check(`${path}: header is at the top of the viewport`, !!header && header.y >= 0 && header.y < 100,
    JSON.stringify(header))
  check(`${path}: header is on the right of the sidebar`, !!header && header.x >= 256)

  // Sidebar
  const sidebar = await page.evaluate(() => {
    const el = document.querySelector('aside, [data-app-sidebar]') as HTMLElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  })
  check(`${path}: sidebar is present on desktop`, !!sidebar)
  check(`${path}: sidebar fills the viewport height`, !!sidebar && sidebar.h >= 600,
    JSON.stringify(sidebar))

  // Main has flex-1
  const main = await page.evaluate(() => {
    const el = document.querySelector('main') as HTMLElement | null
    if (!el) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return { display: cs.display, flex: cs.flex, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  })
  check(`${path}: main is flex`, !!main && main.display === 'flex')
  check(`${path}: main has non-zero size`, !!main && main.w > 0 && main.h > 0)
  check(`${path}: main is on the right of the sidebar`, !!main && main.x >= 256)

  // Heading inside main is visible above the fold
  const heading = await page.evaluate(() => {
    const h = document.querySelector('main h1, main h2, main h3') as HTMLElement | null
    if (!h) return null
    const r = h.getBoundingClientRect()
    return { tag: h.tagName.toLowerCase(), text: (h.textContent || '').trim().slice(0, 100), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  })
  check(`${path}: heading is present`, !!heading)
  check(`${path}: heading is above the fold`, !!heading && heading.y >= 0 && heading.y < 800)
  check(`${path}: heading matches expected`, !!heading && expectHeading.test(heading.text || ''),
    `got "${heading?.text}"`)

  // No JS errors
  check(`${path}: no pageerror`, pageErrors.length === 0, pageErrors.join('; '))
  check(`${path}: no console.error`, consoleErrors.length === 0, consoleErrors.join('; '))
}

async function main() {
  console.log('Sprint 14 hotfix — AppShell Playwright regression\n')
  console.log('Production URL:', PRODUCTION_URL)

  // Reset password
  const u = await db.user.findUnique({ where: { email: ADMIN_EMAIL } })
  if (u) {
    const ph = await hashPassword(ADMIN_PASSWORD)
    await db.user.update({ where: { id: u.id }, data: { passwordHash: ph, passwordChangedAt: new Date() } })
    console.log(`[setup] reset password for ${ADMIN_EMAIL}`)
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })

  for (const viewport of [
    { name: 'Desktop 1440x900', width: 1440, height: 900 },
    { name: 'Laptop 1280x720', width: 1280, height: 720 },
    { name: 'Tablet 768x1024', width: 768, height: 1024 },
    { name: 'Mobile 390x844', width: 390, height: 844 },
  ]) {
    console.log(`\n=======================================================`)
    console.log(`Viewport: ${viewport.name}`)
    console.log(`=======================================================`)
    const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
    const page = await ctx.newPage()

    // Login
    await page.goto(`${PRODUCTION_URL}/login`)
    await page.waitForLoadState('networkidle').catch(() => null)
    await page.locator('input[type="email"]').first().fill(ADMIN_EMAIL)
    await page.locator('input[type="password"]').first().fill(ADMIN_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL(/^(?!.*login).*/, { timeout: 30000 }).catch(() => null)
    await page.waitForLoadState('networkidle').catch(() => null)
    check(`${viewport.name}: logged in`, !page.url().includes('/login'))

    for (const r of ROUTES) {
      await checkRoute(page, r.path, r.expectHeading)
    }

    // AI Recruiter specific: assert the main interactive content is
    // visible above the fold.
    console.log(`\n${viewport.name} — /ai-recruiter specific checks`)
    await page.goto(`${PRODUCTION_URL}/ai-recruiter`)
    await page.waitForLoadState('networkidle').catch(() => null)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${SHOT_DIR}_ai_recruiter_${viewport.name.replace(/[^a-z0-9]/gi, '_')}.png`, fullPage: false })
    const aiContent = await page.evaluate(() => {
      // The AI Recruiter main content is a text input + suggested prompts
      const main = document.querySelector('main')
      if (!main) return null
      const inputs = main.querySelectorAll('input, textarea, button, [contenteditable]')
      const visibleInputs = Array.from(inputs).filter(el => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
      })
      const visibleAboveFold = visibleInputs.filter(el => el.getBoundingClientRect().y < window.innerHeight)
      return {
        total: visibleInputs.length,
        aboveFold: visibleAboveFold.length,
        firstInputY: visibleInputs[0]?.getBoundingClientRect().y ?? null,
        firstInputText: visibleInputs[0]?.textContent?.slice(0, 80) ?? null,
      }
    })
    check(`${viewport.name}: AI Recruiter has visible interactive content`, !!aiContent && aiContent.total > 0,
      JSON.stringify(aiContent))
    check(`${viewport.name}: AI Recruiter content above the fold`, !!aiContent && aiContent.aboveFold > 0,
      JSON.stringify(aiContent))

    await ctx.close()
  }

  await browser.close()
  await db.$disconnect()
  console.log(`\n=======================================================`)
  console.log(`FINAL: ${pass} passed, ${fail} failed`)
  console.log(`=======================================================`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
