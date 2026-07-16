'use client'

import { useState, useTransition } from 'react'
import { AlertCircleIcon, CheckIcon, CopyIcon, Loader2Icon, MailIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { inviteTeamMemberAction, skipTeamInviteAction, completeOnboardingAction } from '@/lib/onboarding/actions'

interface Invite {
  email: string
  url: string
}

export function InviteTeamForm() {
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState<typeof ROLES[number]['value']>('RECRUITER')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [invites, setInvites] = useState<Invite[]>([])
  const [copied, setCopied] = useState<string | null>(null)

  function add(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email || !firstName || !lastName) {
      setError('Email, first name, and last name are required.')
      return
    }
    if (invites.some(i => i.email.toLowerCase() === email.toLowerCase())) {
      setError('You have already added this email.')
      return
    }
    startTransition(async () => {
      const r = await inviteTeamMemberAction({ email, firstName, lastName, role })
      if (!r.ok) { setError(r.error?.message ?? 'Failed to send invite.'); return }
      setInvites(prev => [...prev, { email, url: r.invitationUrl! }])
      setEmail('')
      setFirstName('')
      setLastName('')
      setRole('RECRUITER')
    })
  }

  function copy(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(url)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  function finish() {
    setError(null)
    startTransition(async () => {
      if (invites.length > 0) {
        await skipTeamInviteAction().catch(() => null)
      } else {
        await skipTeamInviteAction().catch(() => null)
      }
      const r = await completeOnboardingAction()
      if (!r.ok) { setError(r.error?.message ?? 'Failed to complete onboarding.'); return }
      window.location.href = '/dashboard'
    })
  }

  function skipAll() {
    setError(null)
    startTransition(async () => {
      await skipTeamInviteAction().catch(() => null)
      const r = await completeOnboardingAction()
      if (!r.ok) { setError(r.error?.message ?? 'Failed to complete onboarding.'); return }
      window.location.href = '/dashboard'
    })
  }

  return (
    <div className="mt-6 space-y-5">
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          <AlertCircleIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={add} className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="firstName" className="block text-xs font-medium text-slate-700 dark:text-slate-300">First name</label>
            <input
              id="firstName"
              type="text"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label htmlFor="lastName" className="block text-xs font-medium text-slate-700 dark:text-slate-300">Last name</label>
            <input
              id="lastName"
              type="text"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-slate-700 dark:text-slate-300">Work email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="teammate@yourcompany.com"
              className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
            />
          </div>
          <div>
            <label htmlFor="role" className="block text-xs font-medium text-slate-700 dark:text-slate-300">Role</label>
            <select
              id="role"
              value={role}
              onChange={e => setRole(e.target.value as any)}
              className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
            >
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending
              ? <><Loader2Icon className="h-3.5 w-3.5 animate-spin" /> Adding…</>
              : <><MailIcon className="h-3.5 w-3.5" /> Add to invite list</>}
          </Button>
        </div>
      </form>

      {invites.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500">Invitations ready to send</p>
          {invites.map(inv => (
            <div key={inv.email} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">{inv.email}</p>
                <p className="truncate text-xs text-slate-500">Click copy and send the link to your teammate.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => copy(inv.url)}>
                {copied === inv.url ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon className="h-3.5 w-3.5" /> Copy link</>}
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={skipAll} disabled={pending}>
          Skip for now
        </Button>
        <Button onClick={finish} disabled={pending}>
          {pending ? <><Loader2Icon className="h-4 w-4 animate-spin" /> Finishing…</> : 'Continue to dashboard'}
        </Button>
      </div>
    </div>
  )
}

const ROLES = [
  { value: 'ADMIN', label: 'Administrator' },
  { value: 'TA_LEAD', label: 'Talent Acquisition Lead' },
  { value: 'RECRUITER', label: 'Recruiter' },
  { value: 'HIRING_MANAGER', label: 'Hiring Manager' },
  { value: 'INTERVIEWER', label: 'Interviewer' },
  { value: 'VIEWER', label: 'Viewer' },
] as const
