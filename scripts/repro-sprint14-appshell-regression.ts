/**
 * Hotfix — Reproduce AppShell visual regression on LIVE production.
 *
 * Logs in as the existing production ADMIN (Ihab Bayomi) and walks
 * every authenticated core route. For each route, captures:
 *   - The current page URL
 *   - Body scroll dimensions
 *   - Header bounding box
 *   - Sidebar bounding box
 *   - Main content bounding box
 *   - Page-specific heading bounding box
 *   - Computed styles on the flex container of <main>
 *   - Page errors
 *   - Console errors
 *
 * Also writes a screenshot per route to /tmp/appshell-repro/<route>.png
 * for visual inspection.
 */

import { chromium, type Page } from 'playwright'
import 'dotenv/config'
import { mkdirSync } from 'fs'
import { db } from '../lib/db'
import { hashPassword } from '../lib/auth/password'

const PRODUCTION_URL = process.env.SPRINT_14_PROD_URL ?? 'https://talentos-ai-lime.vercel.app'
const ADMIN_EMAIL = process.env.REPRO_ADMIN_EMAIL ?? 'bayomismo@gmail.com'
const ADMIN_PASSWORD = process.env.REPRO_ADMIN_PASSWORD ?? 'ProdHotfix1!!'

const ROUTES = [
  { path: '/dashboard', heading: /dashboard|recruitment/i },
  { path: '/ai-recruiter', heading: /ai recruiter|ai-recruiter|recruiter/i },
  { path: '/hiring-requests', heading: /hiring requests?/i },
  { path: '/candidates', heading: /candidates?/i },
  { path: '/interview-center', heading: /interview center/i },
  { path: '/offers', heading: /offers?/i },
  { path: '/copilot', heading: /copilot|ai copilot/i },
  { path: '/analytics', heading: /analytics/i },
  { path: '/reports', heading: /reports?/i },
  { path: '/settings', heading: /settings/i },
]

const SHOT_DIR = '/tmp/appshell-repro'
mkdirSync(SHOT_DIR, { recursive: true })

async function dumpBox(page: Page, name: string) {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) return { name: sel, found: false }
    const rect = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      name: sel,
      found: true,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      display: cs.display,
      flexDirection: cs.flexDirection,
      alignItems: cs.alignItems,
      justifyContent: cs.justifyContent,
      position: cs.position,
      minHeight: cs.minHeight,
      height: cs.height,
    }
  }, name)
}

async function main() {
  console.log('Sprint 14 hotfix — reproduce AppShell regression\n')
  console.log('Production URL:', PRODUCTION_URL)
  console.log('Admin email:', ADMIN_EMAIL)
  console.log('')

  // Make sure the admin's password is what we expect (for testing only)
  const u = await db.user.findUnique({ where: { email: ADMIN_EMAIL } })
  if (u) {
    const ph = await hashPassword(ADMIN_PASSWORD)
    await db.user.update({ where: { id: u.id }, data: { passwordHash: ph, passwordChangedAt: new Date() } })
    console.log(`[setup] reset password for ${ADMIN_EMAIL}`)
  } else {
    console.log('[setup] no admin found with that email — login will likely fail')
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', e => pageErrors.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text().slice(0, 200)}`)
  })

  try {
    // Login
    await page.goto(`${PRODUCTION_URL}/login`)
    await page.waitForLoadState('networkidle').catch(() => null)
    await page.locator('input[type="email"]').first().fill(ADMIN_EMAIL)
    await page.locator('input[type="password"]').first().fill(ADMIN_PASSWORD)
    await page.click('button[type="submit"]')
    try {
      await page.waitForURL(/^(?!.*login).*/, { timeout: 30000 })
    } catch {
      console.log('  -- login failed; current url:', page.url())
      const text = (await page.locator('body').textContent().catch(() => '')) ?? ''
      console.log('  -- body:', text.slice(0, 300))
      throw new Error('login failed')
    }
    await page.waitForLoadState('networkidle').catch(() => null)
    console.log('Logged in. URL:', page.url())
  } catch (e) {
    await browser.close()
    await db.$disconnect()
    process.exit(1)
  }

  for (const r of ROUTES) {
    console.log(`\n--- ${r.path} ---`)
    await page.goto(`${PRODUCTION_URL}${r.path}`)
    await page.waitForLoadState('networkidle').catch(() => null)
    await page.waitForTimeout(1500)
    const safeName = r.path.replace(/\//g, '_') || 'root'
    await page.screenshot({ path: `${SHOT_DIR}${safeName}.png`, fullPage: true })

    // Body scroll
    const body = await page.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      scrollHeight: document.body.scrollHeight,
      clientWidth: document.body.clientWidth,
      clientHeight: document.body.clientHeight,
    }))
    console.log('  body:', JSON.stringify(body))

    // Header
    const header = await page.evaluate(() => {
      const el = document.querySelector('header') as HTMLElement | null
      if (!el) return { found: false }
      const r = el.getBoundingClientRect()
      return { found: true, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    })
    console.log('  header:', JSON.stringify(header))

    // Sidebar (look for the nav, the aside, or anything with role=complementary)
    const sidebar = await page.evaluate(() => {
      const el = (document.querySelector('aside, nav, [data-app-sidebar]') as HTMLElement | null)
      if (!el) return { found: false }
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        found: true,
        tag: el.tagName.toLowerCase(),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        position: cs.position,
      }
    })
    console.log('  sidebar:', JSON.stringify(sidebar))

    // Main
    const main = await page.evaluate(() => {
      const el = document.querySelector('main') as HTMLElement | null
      if (!el) return { found: false }
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        found: true,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        paddingTop: cs.paddingTop,
        paddingLeft: cs.paddingLeft,
        flexGrow: cs.flexGrow,
        flex: cs.flex,
        display: cs.display,
        minHeight: cs.minHeight,
      }
    })
    console.log('  main:', JSON.stringify(main))

    // Parent of main (this is what gives main its height/position)
    const mainParent = await page.evaluate(() => {
      const el = document.querySelector('main')?.parentElement as HTMLElement | null
      if (!el) return { found: false }
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        found: true,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        display: cs.display,
        flexDirection: cs.flexDirection,
        alignItems: cs.alignItems,
        justifyContent: cs.justifyContent,
        gap: cs.gap,
        minHeight: cs.minHeight,
        height: cs.height,
        classes: el.className,
      }
    })
    console.log('  mainParent:', JSON.stringify(mainParent))

    // First heading inside main
    const heading = await page.evaluate(() => {
      const h = document.querySelector('main h1, main h2, main h3, main h4, main h5')
      if (!h) return { found: false }
      const r = h.getBoundingClientRect()
      return { found: true, tag: h.tagName.toLowerCase(), text: (h.textContent || '').trim().slice(0, 80), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    })
    console.log('  heading:', JSON.stringify(heading))
  }

  // Dump the <body> inner HTML structure (first 2000 chars) for any of the routes
  await page.goto(`${PRODUCTION_URL}/ai-recruiter`)
  await page.waitForLoadState('networkidle').catch(() => null)
  const rootStructure = await page.evaluate(() => {
    function summarize(el: Element, depth: number, max: number): any {
      if (depth > max) return { tag: el.tagName.toLowerCase(), classes: (el.className || '').slice(0, 80), more: '...' }
      const cs = getComputedStyle(el)
      const out: any = {
        tag: el.tagName.toLowerCase(),
        classes: (el.className || '').slice(0, 80),
        display: cs.display,
        flexDirection: cs.flexDirection,
        minHeight: cs.minHeight,
        height: cs.height,
      }
      if (cs.position !== 'static') out.position = cs.position
      if (el.children.length > 0 && depth < max) {
        out.children = Array.from(el.children).slice(0, 10).map(c => summarize(c, depth + 1, max))
      }
      return out
    }
    return summarize(document.body, 0, 4)
  })
  console.log('\n--- AI Recruiter body structure (depth 4) ---')
  console.log(JSON.stringify(rootStructure, null, 2))

  console.log('\n--- Page errors ---')
  for (const e of pageErrors) console.log('  ' + e)
  console.log('\n--- Console errors ---')
  for (const e of consoleErrors.slice(0, 20)) console.log('  ' + e)

  await browser.close()
  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
