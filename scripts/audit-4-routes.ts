/**
 * Audit Journey: HTTP smoke test of every route.
 *
 * - Public routes should return 200 (or 404 for missing data)
 * - Protected routes should redirect to /login
 * - API routes should return 401/redirect when unauthenticated
 */
const BASE = 'https://talentos-ai-lime.vercel.app'

interface Check { path: string; expected: 'public' | 'protected' | 'public-api'; code: number }
const checks: Check[] = [
  // Marketing & public
  { path: '/', expected: 'public', code: 200 },
  { path: '/robots.txt', expected: 'public', code: 200 },
  { path: '/sitemap.xml', expected: 'public', code: 200 },
  { path: '/login', expected: 'public', code: 200 },
  { path: '/signup', expected: 'public', code: 200 },
  { path: '/forgot-password', expected: 'public', code: 200 },
  { path: '/reset-password', expected: 'public', code: 200 },
  { path: '/jobs/some-slug', expected: 'public', code: 404 }, // no public job with that slug
  // Protected app
  { path: '/dashboard', expected: 'protected', code: 307 },
  { path: '/candidates', expected: 'protected', code: 307 },
  { path: '/ai-recruiter', expected: 'protected', code: 307 },
  { path: '/job-library', expected: 'protected', code: 307 },
  { path: '/interview-center', expected: 'protected', code: 307 },
  { path: '/offers', expected: 'protected', code: 307 },
  { path: '/settings', expected: 'protected', code: 307 },
  { path: '/hiring-requests', expected: 'protected', code: 307 },
  { path: '/copilot', expected: 'protected', code: 307 },
  { path: '/analytics', expected: 'protected', code: 307 },
  { path: '/reports', expected: 'protected', code: 307 },
  // Public API
  { path: '/api/health/ai', expected: 'public-api', code: 200 },
  { path: '/api/auth/session', expected: 'public-api', code: 200 },
]

async function main() {
  console.log('=== Route smoke test ===\n')
  let pass = 0, fail = 0
  for (const c of checks) {
    const url = `${BASE}${c.path}`
    try {
      const res = await fetch(url, { redirect: 'manual' })
      const got = res.status
      const ok = got === c.code
      if (ok) {
        pass++
        console.log(`  ✓ ${c.path.padEnd(30)} expected ${c.code} got ${got}`)
      } else {
        fail++
        console.log(`  ✗ ${c.path.padEnd(30)} expected ${c.code} got ${got}`)
      }
    } catch (e) {
      fail++
      console.log(`  ✗ ${c.path.padEnd(30)} ERROR: ${(e as Error).message}`)
    }
  }
  console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
  process.exit(fail > 0 ? 1 : 0)
}
main()
