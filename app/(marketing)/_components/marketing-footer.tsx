/**
 * Footer — minimal, no clutter. Just enough links to look legit.
 */
import Link from 'next/link'

export function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white py-12 dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-white">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="m22 11-3-3m0 0-3 3m3-3v8" />
                </svg>
              </div>
              <span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
                TalentOS
              </span>
            </div>
            <p className="mt-3 max-w-sm text-sm text-slate-500 dark:text-slate-400">
              The hiring tool your candidates actually respond to. Built for
              real teams, not enterprise theater.
            </p>
          </div>

          {/* Links — Product */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-900 dark:text-white">
              Product
            </h4>
            <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-400">
              <li>
                <a href="#features" className="hover:text-slate-900 dark:hover:text-white">
                  Features
                </a>
              </li>
              <li>
                <a href="#how" className="hover:text-slate-900 dark:hover:text-white">
                  How it works
                </a>
              </li>
              <li>
                <a href="#why" className="hover:text-slate-900 dark:hover:text-white">
                  Why TalentOS
                </a>
              </li>
            </ul>
          </div>

          {/* Links — Company */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-900 dark:text-white">
              Get started
            </h4>
            <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-400">
              <li>
                <Link href="/signup" className="hover:text-slate-900 dark:hover:text-white">
                  Start free
                </Link>
              </li>
              <li>
                <Link href="/login" className="hover:text-slate-900 dark:hover:text-white">
                  Sign in
                </Link>
              </li>
              <li>
                <Link href="/forgot-password" className="hover:text-slate-900 dark:hover:text-white">
                  Forgot password
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-slate-200 pt-6 text-xs text-slate-500 sm:flex-row dark:border-slate-800 dark:text-slate-400">
          <p>© {new Date().getFullYear()} TalentOS. All rights reserved.</p>
          <p>Free during beta · No credit card · Self-serve</p>
        </div>
      </div>
    </footer>
  )
}
