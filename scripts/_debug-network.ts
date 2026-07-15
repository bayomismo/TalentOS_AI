import { chromium } from 'playwright'
import 'dotenv/config'
import { db } from '../lib/db'

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  // Capture all network requests
  page.on('response', async (resp) => {
    const url = resp.url()
    if (url.includes('/copilot') || url.includes('action') || url.includes('api/')) {
      const status = resp.status()
      let body: string | null = null
      try {
        body = await resp.text()
        if (body.length > 500) body = body.slice(0, 500) + '...'
      } catch {}
      console.log(`  [net] ${resp.request().method()} ${url} -> ${status} ${body ? 'body=' + body.slice(0, 200) : ''}`)
    }
  })
  page.on('console', msg => console.log(`  [console.${msg.type()}]`, msg.text().slice(0, 200)))
  page.on('pageerror', err => console.log('  [pageerror]', err.message))

  await page.goto('https://talentos-ai-lime.vercel.app/login', { waitUntil: 'networkidle' })
  await page.fill('input[name="email"], input[type="email"]', 'sprint111-test@acmecompany.com')
  await page.fill('input[name="password"], input[type="password"]', 'Sprint111Pwd1!')
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })
  await page.goto('https://talentos-ai-lime.vercel.app/copilot', { waitUntil: 'networkidle' })

  const user = await db.user.findUnique({ where: { email: 'sprint111-test@acmecompany.com' } })
  if (!user) throw new Error('test user')
  const dept = await db.department.findFirst({ where: { organizationId: user.organizationId } })
  if (!dept) throw new Error('no dept')

  const input = page.locator('input[placeholder*="Ask about"]').first()
  await input.fill(`Create a hiring request draft for a Senior Backend Engineer. Department name: ${dept.name}.`)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(30000)
  const lastMessage = await page.locator('.whitespace-pre-wrap').last().textContent().catch(() => '<none>')
  console.log('Last message:', (lastMessage ?? '').slice(0, 400))
  await browser.close()
}
main().catch(console.error)
