/**
 * Shared auth helper for production E2E tests.
 *
 * Logs in a user via the /login form and stores the cookies in the
 * browser context. Use this at the start of any test that exercises
 * authenticated routes.
 */

import type { Page } from 'playwright'

const PRODUCTION_URL = 'https://talentos-ai-lime.vercel.app'

export interface TestUser {
  email: string
  password: string
}

export async function login(page: Page, user: TestUser): Promise<void> {
  await page.goto(`${PRODUCTION_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', user.email)
  await page.fill('input[name="password"]', user.password)
  await page.click('button:has-text("Sign In")')
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })
}

export const ADMIN_USER: TestUser = {
  email: 'jordan.rivera@acmecompany.com',
  password: 'jordan.riveraTalentOS9!',
}

export const RECRUITER_USER: TestUser = {
  email: 'priya.patel@acmecompany.com',
  password: 'priya.patelTalentOS9!',
}
