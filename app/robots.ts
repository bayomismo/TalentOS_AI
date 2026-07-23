/**
 * robots.txt — indexable marketing surface, noindex on app pages.
 */
import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? 'https://talentos-ai-lime.vercel.app'
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/dashboard', '/settings', '/candidates', '/hiring-requests', '/job-library', '/ai-recruiter', '/interview-center', '/offers', '/reports', '/onboarding', '/copilot', '/analytics'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  }
}
