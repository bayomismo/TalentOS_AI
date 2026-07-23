/**
 * Hero section.
 *
 * Trust-led: "The hiring tool your candidates actually respond to."
 *
 * The "screenshot" on the right is rendered as live HTML — using the
 * same Tailwind tokens as the actual app. That way it:
 *   1. Looks identical to the product (because it IS the product)
 *   2. Has zero asset cost and zero load time
 *   3. Can be replaced with a real screenshot later, drop-in
 */
import Link from 'next/link'
import { SparklesIcon, FileTextIcon, UserPlusIcon, SendIcon, CheckIcon } from 'lucide-react'

export function MarketingHero() {
  return (
    <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-white via-slate-50/30 to-white py-20 sm:py-28 dark:border-slate-800 dark:from-slate-950 dark:via-slate-900/30 dark:to-slate-950">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          {/* Copy */}
          <div className="text-center lg:text-left">
            {/* Eyebrow */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Free during beta — no credit card
            </div>

            {/* Headline */}
            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl dark:text-white">
              The hiring tool{' '}
              <span className="relative inline-block">
                <span className="relative z-10">your candidates</span>
                <span className="absolute bottom-1 left-0 z-0 h-3 w-full bg-emerald-200/60 sm:bottom-2 sm:h-4 dark:bg-emerald-800/50" />
              </span>{' '}
              actually respond to.
            </h1>

            {/* Subhead */}
            <p className="mx-auto mt-6 max-w-xl text-balance text-lg leading-relaxed text-slate-600 lg:mx-0 dark:text-slate-300">
              AI-generated job descriptions, ranked CVs, and personalized
              interview kits — built for real teams, not enterprise theater.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row lg:items-start">
              <Link
                href="/signup"
                className="inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-6 text-base font-medium text-white transition-colors hover:bg-slate-800 sm:w-auto dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
              >
                Start hiring free →
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-6 text-base font-medium text-slate-900 transition-colors hover:bg-slate-50 sm:w-auto dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                See it in action
              </Link>
            </div>

            {/* Trust line */}
            <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
              <CheckIcon className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />
              Set up in 2 minutes
              <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>
              <CheckIcon className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />
              No credit card
              <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>
              <CheckIcon className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />
              Self-serve onboarding
            </p>
          </div>

          {/* Product mockup — the AI Recruiter wizard */}
          <HeroProductMockup />
        </div>
      </div>
    </section>
  )
}

/**
 * Inline HTML mockup of the AI Recruiter wizard.
 *
 * This is honest: it's styled with the same Tailwind tokens as the
 * real app. Not a Photoshop render, not an AI-generated image —
 * actual component code. When real screenshots are captured, swap
 * this for <Image src="/screenshots/ai-recruiter.png" ... />.
 */
function HeroProductMockup() {
  return (
    <div className="relative">
      {/* Browser frame */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40">
        {/* Chrome */}
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/80" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-400/80" />
          </div>
          <div className="ml-2 flex-1 truncate rounded-md bg-white px-3 py-1 text-xs text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700">
            talentos.app/ai-recruiter
          </div>
        </div>

        {/* Wizard body */}
        <div className="p-5">
          {/* Step indicator */}
          <div className="mb-4 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-semibold text-white">
              ✓
            </span>
            <span>Job title</span>
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-semibold text-white">
              ✓
            </span>
            <span>Skills</span>
            <span className="h-px flex-1 bg-emerald-500" />
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-semibold text-white">
              3
            </span>
            <span className="font-medium text-slate-900 dark:text-slate-100">
              Generate
            </span>
          </div>

          {/* Title */}
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Senior Frontend Engineer
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Generating job description with AI…
          </p>

          {/* Streaming output */}
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/50 p-4 text-[13px] leading-relaxed dark:border-slate-700 dark:bg-slate-800/30">
            <p className="text-slate-700 dark:text-slate-200">
              <strong className="font-semibold text-slate-900 dark:text-white">
                About the role
              </strong>
            </p>
            <p className="mt-2 text-slate-600 dark:text-slate-300">
              We&apos;re looking for a Senior Frontend Engineer to help us ship
              the next generation of our platform. You&apos;ll work across our
              React + TypeScript stack, partnering with design and product
              to build interfaces that{' '}
              <span className="bg-emerald-200/60 dark:bg-emerald-800/40">
                feel effortless to use
              </span>
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-emerald-500 align-middle" />
            </p>
          </div>

          {/* AI tag */}
          <div className="mt-3 flex items-center justify-between">
            <div className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              <SparklesIcon className="h-3 w-3" />
              Generated with AI · 2,400 tokens
            </div>
            <div className="text-[11px] text-slate-400">Auto-saved</div>
          </div>
        </div>
      </div>

      {/* Floating cards around the mockup */}
      <div className="pointer-events-none absolute -bottom-6 -left-6 hidden rotate-[-4deg] sm:block">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-2 text-xs">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              <FileTextIcon className="h-3 w-3" />
            </div>
            <div>
              <div className="font-medium text-slate-900 dark:text-slate-100">
                Job posted
              </div>
              <div className="text-[10px] text-slate-500">3 seconds ago</div>
            </div>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute -right-4 -top-4 hidden rotate-[3deg] sm:block">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-2 text-xs">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
              <UserPlusIcon className="h-3 w-3" />
            </div>
            <div>
              <div className="font-medium text-slate-900 dark:text-slate-100">
                +1 new candidate
              </div>
              <div className="text-[10px] text-slate-500">Ada L. — ranked 94/100</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
