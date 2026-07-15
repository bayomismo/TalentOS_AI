/**
 * Sprint 9 — Accept Invitation page.
 *
 * PART 16: the inviter copies the invitation URL and sends it manually
 * (no email provider yet — PART 17). The URL carries the token in the
 * hash fragment so it is never sent to the server in plaintext. The
 * page reads it, prompts for name + password, and POSTs to the
 * `acceptInvitationAction` server action.
 */
import { Suspense } from 'react'
import { AcceptInviteForm } from './_components/accept-invite-form'
import { Sparkles } from 'lucide-react'

export const metadata = {
  title: 'Accept invitation · TalentOS AI',
}

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 mb-4">
            <Sparkles className="h-6 w-6 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Join your team
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Set your name and password to accept the invitation.
          </p>
        </div>

        <Suspense fallback={<div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-white" />}>
          <AcceptInviteForm />
        </Suspense>
      </div>
    </div>
  )
}
