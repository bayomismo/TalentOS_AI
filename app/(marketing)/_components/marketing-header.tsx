/**
 * Marketing site header — Logo + nav + sign in / start free.
 *
 * Sticky, transparent, no background. Sits over a white/dark page.
 */
import Link from 'next/link'

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200/60 bg-white/80 backdrop-blur-md dark:border-slate-800/60 dark:bg-slate-950/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="m22 11-3-3m0 0-3 3m3-3v8" />
            </svg>
          </div>
          <span className="text-base font-semibold tracking-tight">
            TalentOS
          </span>
        </Link>

        {/* Center nav */}
        <nav className="hidden items-center gap-7 text-sm text-slate-600 md:flex dark:text-slate-300">
          <a href="#features" className="transition-colors hover:text-slate-900 dark:hover:text-white">
            Features
          </a>
          <a href="#how" className="transition-colors hover:text-slate-900 dark:hover:text-white">
            How it works
          </a>
          <a href="#why" className="transition-colors hover:text-slate-900 dark:hover:text-white">
            Why TalentOS
          </a>
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 sm:inline-block dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  )
}
