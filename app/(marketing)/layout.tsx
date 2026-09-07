/**
 * Sprint 17.5 — Marketing landing page layout.
 *
 * Distinct from the (app) layout: no sidebar, no auth gate, no theme
 * inversion. Pure marketing chrome.
 */
import '../globals.css'

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-50">
      {children}
    </div>
  )
}
