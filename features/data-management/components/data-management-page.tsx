'use client'

/**
 * Sprint 12 — Data Management page.
 *
 * ADMIN-only safe cleanup of demo/test/E2E records. Previews the
 * impact before deletion, requires a typed confirmation phrase,
 * and shows the protected records that will be preserved.
 */

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShieldCheckIcon,
  ShieldOffIcon,
  AlertTriangleIcon,
  LoaderIcon,
  CheckIcon,
  Trash2Icon,
  DatabaseIcon,
  LockIcon,
  KeyIcon,
  UsersIcon,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { previewDataManagementAction, executeDataCleanupAction } from '../actions'
import { cn } from '@/lib/utils'

export function DataManagementPage() {
  const [preview, setPreview] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)

  function load() {
    setLoading(true)
    previewDataManagementAction()
      .then(r => { if (r.ok) setPreview(r.data); else setError(r.error?.message ?? 'Failed') })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  function run() {
    setError(null)
    startTransition(async () => {
      const res = await executeDataCleanupAction(confirmation)
      if (!res.ok) { setError(res.error?.message ?? 'Cleanup failed'); return }
      setResult(res.data)
      setConfirming(false)
      setConfirmation('')
      load()
    })
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-slate-500">
          <LoaderIcon className="h-4 w-4 animate-spin" /> Loading data inventory…
        </CardContent>
      </Card>
    )
  }
  if (!preview) return null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Data Management</CardTitle>
          <CardDescription>
            Inspect and safely remove demo, test, and E2E records from your organization. Protected system records are always preserved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                <LockIcon className="h-4 w-4" /> Protected (preserved)
              </div>
              <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
                <li>Organization: <span className="font-semibold">{preview.organization.name}</span></li>
                <li>Active ADMINs: <span className="font-semibold">{preview.protected.admins}</span></li>
                <li>Prompt templates: <span className="font-semibold">{preview.protected.promptTemplates}</span></li>
                <li>Active sessions: <span className="font-semibold">{preview.protected.authSessions}</span></li>
                <li>Pending invitations: <span className="font-semibold">{preview.protections?.invitations ?? preview.protected.invitations ?? 0}</span></li>
              </ul>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                <AlertTriangleIcon className="h-4 w-4" /> Removable (test/demo data)
              </div>
              <ul className="space-y-1 text-sm text-amber-900 dark:text-amber-200">
                <li>Test users: <span className="font-semibold">{preview.removable.testUsers}</span></li>
                <li>Test candidates: <span className="font-semibold">{preview.removable.testCandidates}</span></li>
                <li>Test hiring requests: <span className="font-semibold">{preview.removable.testHiringRequests}</span></li>
                <li className="pt-1 text-xs">Associated cascades:</li>
                <li className="ml-3 text-xs">Interviews: {preview.removable.associated.interviews}</li>
                <li className="ml-3 text-xs">Decisions: {preview.removable.associated.decisions}</li>
                <li className="ml-3 text-xs">Offers: {preview.removable.associated.offers}</li>
                <li className="ml-3 text-xs">Activities: {preview.removable.associated.activities}</li>
                <li className="ml-3 text-xs">AI tasks: {preview.removable.associated.aiTasks}</li>
                <li className="ml-3 text-xs">Copilot confirmations: {preview.removable.associated.copilotConfirmations}</li>
              </ul>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              <ShieldCheckIcon className="h-4 w-4" /> Preserved (potentially real)
            </div>
            <p className="text-sm text-emerald-900 dark:text-emerald-200">
              Records that do not match our test/demo patterns are preserved:{' '}
              <span className="font-semibold">{preview.potentiallyReal.users} users</span>,{' '}
              <span className="font-semibold">{preview.potentiallyReal.candidates} candidates</span>,{' '}
              <span className="font-semibold">{preview.potentiallyReal.hiringRequests} hiring requests</span>.
            </p>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
              {error}
            </div>
          )}

          {result && (
            <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                <CheckIcon className="h-4 w-4" /> Cleanup complete
              </div>
              <div className="text-xs text-emerald-800 dark:text-emerald-300">
                Removed {result.removed.users} users, {result.removed.candidates} candidates, {result.removed.hiringRequests} hiring requests, {result.removed.interviews} interviews, {result.removed.decisions} decisions, {result.removed.offers} offers, {result.removed.activities} activities, {result.removed.aiTasks} AI tasks, {result.removed.copilotConfirmations} Copilot confirmations.
              </div>
              <div className="mt-2 text-xs text-emerald-800 dark:text-emerald-300">
                Preserved: <span className="font-semibold">{result.preserved.organization}</span>, {result.preserved.admins} ADMINs, {result.preserved.promptTemplates} prompt templates, {result.preserved.auditLogs} audit log entries.
              </div>
            </div>
          )}

          {!confirming ? (
            <div className="mt-6 flex justify-end">
              <Button
                onClick={() => setConfirming(true)}
                variant="destructive"
                disabled={preview.removable.testUsers === 0 && preview.removable.testCandidates === 0 && preview.removable.testHiringRequests === 0}
              >
                <Trash2Icon className="h-4 w-4" /> Clean Demo & Test Data
              </Button>
            </div>
          ) : (
            <div className="mt-6 rounded-lg border-2 border-red-300 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/20">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-900 dark:text-red-200">
                <AlertTriangleIcon className="h-4 w-4" /> This action cannot be undone
              </div>
              <p className="mb-3 text-xs text-red-800 dark:text-red-300">
                To confirm, type <code className="rounded bg-white px-1.5 py-0.5 font-mono text-red-900 dark:bg-slate-800 dark:text-red-200">CLEAN DEMO DATA</code> below.
              </p>
              <input
                value={confirmation}
                onChange={e => setConfirmation(e.target.value)}
                placeholder="CLEAN DEMO DATA"
                className="h-10 w-full rounded-md border border-red-300 bg-white px-3 text-sm font-mono focus:border-red-500 focus:outline-none dark:border-red-700 dark:bg-slate-800"
              />
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setConfirming(false); setConfirmation('') }} disabled={pending}>
                  Cancel
                </Button>
                <Button variant="destructive" disabled={pending || confirmation.trim() !== 'CLEAN DEMO DATA'} onClick={run}>
                  {pending ? <><LoaderIcon className="h-4 w-4 animate-spin" /> Cleaning…</> : 'Run cleanup'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
