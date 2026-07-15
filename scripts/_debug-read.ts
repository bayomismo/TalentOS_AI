import { chromium } from 'playwright'
async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.goto('https://talentos-ai-lime.vercel.app/login', { waitUntil: 'networkidle' })
  await page.fill('input[name="email"], input[type="email"]', 'sprint10-test@acmecompany.com')
  await page.fill('input[name="password"], input[type="password"]', 'Sprint10Pwd9!')
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })
  await page.goto('https://talentos-ai-lime.vercel.app/copilot', { waitUntil: 'networkidle' })
  const input = page.locator('input[placeholder*="Ask about"]').first()
  await input.fill('Which positions are currently open?')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(20000)
  const lastMessage = await page.locator('.whitespace-pre-wrap').last().textContent().catch(() => '<none>')
  console.log('Last message:', (lastMessage ?? '').slice(0, 200))
  await browser.close()
}
main()
