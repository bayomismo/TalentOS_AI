/**
 * Final CTA — last shot at conversion before the user leaves.
 */
import Link from 'next/link'
import { CheckIcon } from 'lucide-react'

export function MarketingFinalCta() {
  return (
    <section className="relative overflow-hidden bg-slate-900 py-20 sm:py-28 dark:bg-slate-950">
      {/* Soft emerald glow */}
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[40rem] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-emerald-400/5 blur-3xl" />

      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Stop babysitting your hiring pipeline.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-balance text-lg text-slate-300">
          Set up TalentOS in 2 minutes. Write your first AI-generated job
          description today. No credit card, no sales call, no commitment.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-6 text-base font-medium text-white transition-colors hover:bg-emerald-400 sm:w-auto"
          >
            Start hiring free →
          </Link>
          <Link
            href="/login"
            className="inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-transparent px-6 text-base font-medium text-slate-100 transition-colors hover:bg-slate-800 sm:w-auto"
          >
            Sign in
          </Link>
        </div>

        <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-300">
          <li className="inline-flex items-center gap-1.5">
            <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
            Free during beta
          </li>
          <li className="inline-flex items-center gap-1.5">
            <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
            2-minute setup
          </li>
          <li className="inline-flex items-center gap-1.5">
            <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
            No credit card
          </li>
          <li className="inline-flex items-center gap-1.5">
            <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
            Self-serve
          </li>
        </ul>
      </div>
    </section>
  )
}
