/**
 * Sprint 9 — Unauthorized page.
 *
 * Friendly access-denied experience. We do NOT distinguish between
 * "you are not logged in", "you are logged in but lack permission",
 * and "the resource exists in another tenant" — that would leak
 * cross-tenant resource existence (PART 21).
 */
import { ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export const metadata = {
  title: 'Access denied · TalentOS AI',
}

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40 mb-4">
          <ShieldOff className="h-7 w-7 text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Access denied
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          You don't have permission to view this resource, or it doesn't exist.
          If you believe this is a mistake, contact your organization administrator.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
          <Button>
            <Link href="/login">Sign in as a different user</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
