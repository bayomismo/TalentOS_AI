'use client'

/**
 * Sprint 13 — Profile section.
 *
 * Reads the authenticated user's profile via getOwnProfileAction
 * and persists changes via updateOwnProfileAction. NEVER reads or
 * sends a userId from the browser — the server derives it from the
 * session.
 */

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckIcon, Loader2Icon, AlertCircleIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { getOwnProfileAction, updateOwnProfileAction } from '@/lib/onboarding/actions'

export function ProfileSection() {
  const router = useRouter()
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [timezone, setTimezone] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState('')
  const [bio, setBio] = useState('')
  const [pending, startTransition] = useTransition()
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getOwnProfileAction()
      .then(r => {
        if (r.ok && r.data) {
          setProfile(r.data)
          setFirstName(r.data.firstName)
          setLastName(r.data.lastName)
          setJobTitle(r.data.jobTitle ?? '')
          setTimezone(r.data.timezone ?? '')
          setPhone(r.data.phone ?? '')
          setLocation(r.data.location ?? '')
          setBio(r.data.bio ?? '')
        } else {
          setError(r.error?.message ?? 'Failed to load profile.')
        }
      })
      .finally(() => setLoading(false))
  }, [])

  function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const r = await updateOwnProfileAction({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        jobTitle: jobTitle || null,
        timezone: timezone || null,
        phone: phone || null,
        location: location || null,
        bio: bio || null,
      })
      if (!r.ok) { setError(r.error?.message ?? 'Failed to save.'); return }
      setSavedAt(Date.now())
      // Refresh so header reflects new name
      router.refresh()
    })
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-slate-500">
          <Loader2Icon className="h-4 w-4 animate-spin" /> Loading your profile…
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile information</CardTitle>
        <CardDescription>
          Update your personal details. This information is visible to your teammates across TalentOS.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
            <AlertCircleIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <form onSubmit={save} className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-2xl font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {(firstName[0] ?? '?').toUpperCase()}{(lastName[0] ?? '').toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                {firstName} {lastName}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{profile?.email}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                {profile?.role} · {profile?.organizationName}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField id="firstName" label="First name" value={firstName} onChange={setFirstName} required maxLength={64} />
            <TextField id="lastName" label="Last name" value={lastName} onChange={setLastName} required maxLength={64} />
            <TextField id="email" label="Email" value={profile?.email ?? ''} readOnly hint="Email changes require re-verification. Contact support." />
            <TextField id="jobTitle" label="Job title" value={jobTitle} onChange={setJobTitle} maxLength={64} placeholder="Head of Talent" />
            <TextField id="phone" label="Phone" value={phone} onChange={setPhone} maxLength={32} />
            <TextField id="location" label="Location" value={location} onChange={setLocation} maxLength={128} />
            <TextField id="timezone" label="Time zone" value={timezone} onChange={setTimezone} maxLength={80} placeholder="America/New_York" />
          </div>

          <div>
            <label htmlFor="bio" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Bio</label>
            <textarea
              id="bio"
              value={bio}
              onChange={e => setBio(e.target.value)}
              maxLength={2000}
              rows={4}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
              placeholder="Tell your team a bit about yourself…"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              {savedAt && (
                <p className="flex items-center gap-1 text-xs text-emerald-600">
                  <CheckIcon className="h-3 w-3" /> Saved.
                </p>
              )}
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? <><Loader2Icon className="h-4 w-4 animate-spin" /> Saving…</> : 'Save changes'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function TextField({
  id, label, value, onChange, required, maxLength, readOnly, hint, placeholder,
}: {
  id: string
  label: string
  value: string
  onChange?: (v: string) => void
  required?: boolean
  maxLength?: number
  readOnly?: boolean
  hint?: string
  placeholder?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={e => onChange?.(e.target.value)}
        required={required}
        maxLength={maxLength}
        readOnly={readOnly}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 read-only:bg-slate-50 read-only:text-slate-500 dark:read-only:bg-slate-800"
      />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}
