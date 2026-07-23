/**
 * Sprint 17.5 — Root marketing page.
 *
 * Public landing. Logged-in users get a small client-side nudge to
 * /dashboard; the page itself is server-rendered and fully static
 * (no per-request auth() call), which keeps the build simple and
 * the marketing page fast.
 */
import type { Metadata } from 'next'
import { MarketingHeader } from './_components/marketing-header'
import { MarketingHero } from './_components/marketing-hero'
import { MarketingFeatures } from './_components/marketing-features'
import { MarketingHow } from './_components/marketing-how'
import { MarketingWhy } from './_components/marketing-why'
import { MarketingFinalCta } from './_components/marketing-final-cta'
import { MarketingFooter } from './_components/marketing-footer'
import { LoggedInRedirect } from './_components/logged-in-redirect'

const APP_URL = process.env.APP_URL ?? 'https://talentos-ai-lime.vercel.app'

export const metadata: Metadata = {
  title: 'TalentOS — The hiring tool your candidates actually respond to',
  description:
    'AI-generated job descriptions, ranked CVs, and personalized interview kits for real teams. Free during beta. Self-serve onboarding. No credit card.',
  metadataBase: new URL(APP_URL),
  openGraph: {
    title: 'TalentOS — The hiring tool your candidates actually respond to',
    description:
      'AI-generated job descriptions, ranked CVs, and personalized interview kits. Free during beta.',
    url: '/',
    siteName: 'TalentOS',
    type: 'website',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'TalentOS — AI hiring copilot',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TalentOS — The hiring tool your candidates actually respond to',
    description:
      'AI-generated job descriptions, ranked CVs, and personalized interview kits. Free during beta.',
    images: ['/og.png'],
  },
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function MarketingHome() {
  return (
    <>
      <LoggedInRedirect />
      <MarketingHeader />
      <main>
        <MarketingHero />
        <MarketingFeatures />
        <MarketingHow />
        <MarketingWhy />
        <MarketingFinalCta />
      </main>
      <MarketingFooter />

      {/* JSON-LD for SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'TalentOS',
            applicationCategory: 'BusinessApplication',
            operatingSystem: 'Web',
            offers: {
              '@type': 'Offer',
              price: '0',
              priceCurrency: 'USD',
              description: 'Free during beta',
            },
            description:
              'AI hiring copilot: job descriptions, CV ranking, and interview kits.',
            url: APP_URL,
          }),
        }}
      />
    </>
  )
}
