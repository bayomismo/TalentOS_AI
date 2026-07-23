/**
 * Sprint 16 — Security headers smoke test.
 *
 * Loads the app under local dev, then:
 *  1. Verifies the 5 security headers are present on the homepage
 *  2. Logs in
 *  3. Loads /dashboard, /job-library, /candidates under CSP — looking
 *     for any browser console errors (CSP violations show as
 *     "Refused to ..." errors)
 */

import { chromium } from 'playwright'

async function main() {
  let pass = 0, fail = 0
  const ok = (label: string, cond: boolean, detail?: string) => {
    if (cond) { pass++; console.log(`  ✓ ${label}`) }
    else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage())

  // Capture browser console errors (CSP violations appear here)
  const cspViolations: string[] = []
  page.on('console', msg => {
    if (msg.type() === 'error' && msg.text().match(/Refused to|Content Security Policy/i)) {
      cspViolations.push(msg.text())
    }
  })
  page.on('pageerror', err => {
    if (err.message.match(/Refused to|Content Security Policy/i)) {
      cspViolations.push(err.message)
    }
  })

  console.log('Loading /login...')
  const r = await page.goto('http://localhost:3001/login')
  ok('login page returns 200', r?.status() === 200)

  // Read the headers via the response object
  const headers = r?.headers() ?? {}
  ok('Strict-Transport-Security set',
    !!headers['strict-transport-security'] && headers['strict-transport-security'].includes('max-age='),
    headers['strict-transport-security'])
  ok('Content-Security-Policy set', !!headers['content-security-policy'],
    headers['content-security-policy']?.slice(0, 100))
  ok('CSP includes default-src self', (headers['content-security-policy'] ?? '').includes("default-src 'self'"))
  ok('CSP blocks all frames (frame-ancestors none)',
    (headers['content-security-policy'] ?? '').includes("frame-ancestors 'none'"))
  ok('X-Frame-Options DENY', headers['x-frame-options'] === 'DENY')
  ok('X-Content-Type-Options nosniff', headers['x-content-type-options'] === 'nosniff')
  ok('Referrer-Policy strict-origin', (headers['referrer-policy'] ?? '').includes('strict-origin'))
  ok('Permissions-Policy disables camera/mic/geo',
    (headers['permissions-policy'] ?? '').includes('camera=()') &&
    (headers['permissions-policy'] ?? '').includes('microphone=()') &&
    (headers['permissions-policy'] ?? '').includes('geolocation=()'))

  // Login
  console.log('\nLogging in...')
  await page.fill('input[type="email"]', 'bayomismo@gmail.com')
  await page.fill('input[type="password"]', 'AuditTest1!!')
  await Promise.all([
    page.waitForURL(/dashboard|ai-recruiter/, { timeout: 15000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(2000)
  ok('login succeeded, on /dashboard', page.url().includes('/dashboard'))

  // Load a few pages and check for CSP violations
  console.log('\nLoading pages under CSP...')
  for (const path of ['/dashboard', '/job-library', '/candidates', '/ai-recruiter', '/settings']) {
    await page.goto(`http://localhost:3001${path}`)
    await page.waitForLoadState('networkidle').catch(() => null)
    await page.waitForTimeout(1000)
    ok(`loaded ${path} without CSP violation`, !cspViolations.length)
    if (cspViolations.length) {
      console.log('    violations:', cspViolations)
      cspViolations.length = 0
    }
  }

  // Final CSP violation check across the whole session
  ok('no CSP violations across session', cspViolations.length === 0)
  if (cspViolations.length) {
    console.log('    final violations:', cspViolations)
  }

  await browser.close()
  console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error('FATAL:', e); process.exit(1) })
