'use client'

/**
 * Sprint 12 — Data Management page.
 *
 * ADMIN-only. Two distinct flows:
 *
 *   A. Clean Demo & Test Data (auto-classified)
 *      Removes records that match well-known demo/E2E patterns
 *      (sprint*-test, acmecompany.com, etc.). Preserves everything
 *      else including the Organization, ADMINs, prompt templates,
 *      and audit logs. Confirmation phrase: "CLEAN DEMO DATA".
 *
 *   B. Reset Talent Data (explicit, destructive)
 *      Wipes ALL operational records in the organization: hiring
 *      requests, candidates, interviews, decisions, offers,
 *      activities, AI tasks, AI conversations, copilot confirmations,
 *      job descriptions. Preserves: Organization, all User accounts
 *      (including current ADMIN), Departments, PromptTemplate,
 *      AuditLog, auth configuration. Confirmation phrase:
 *      "RESET TALENT DATA".
 *
 * The UI shows BOTH options side-by-side, with a clear label
 * distinguishing the auto-classified cleanup from the destructive
 * reset. Each requires its own typed confirmation.
 */

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangleIcon,
  LoaderIcon,
  CheckIcon,
  Trash2Icon,
  LockIcon,
  ShieldCheckIcon,
  DatabaseIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import {
  previewDataManagementAction,
  executeDataCleanupAction,
  previewBusinessResetAction,
  executeBusinessResetAction,
} from '../actions'

export function DataManagementPage() {
  return (
    <div className="space-y-6">
      <DataManagementPageInner />
    </div>
  )
}

function DataManagementPageInner() {
  const router = useRouter()
  const [cleanPreview, setCleanPreview] = useState<any>(null)
  const [resetPreview, setResetPreview] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [activeConfirm, setActiveConfirm] = useState<'clean' | 'reset' | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [result, setResult] = useState<{ kind: 'clean' | 'reset'; data: any } | null>(null)

  function load() {
    setLoading(true)
    Promise.all([previewDataManagementAction(), previewBusinessResetAction()])
      .then(([c, r]) => {
        if (c.ok) setCleanPreview(c.data)
        else setError(c.error?.message ?? 'Failed to load clean preview')
        if (r.ok) setResetPreview(r.data)
        else setError((prev) => prev ?? r.error?.message ?? 'Failed to load reset preview')
      })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  function runClean() {
    setError(null)
    startTransition(async () => {
      const res = await executeDataCleanupAction(confirmation)
      if (!res.ok) { setError(res.error?.message ?? 'Cleanup failed'); return }
      setResult({ kind: 'clean', data: res.data })
      setActiveConfirm(null)
      setConfirmation('')
      load()
      router.refresh()
    })
  }
  function runReset() {
    setError(null)
    startTransition(async () => {
      const res = await executeBusinessResetAction(confirmation)
      if (!res.ok) { setError(res.error?.message ?? 'Reset failed'); return }
      setResult({ kind: 'reset', data: res.data })
      setActiveConfirm(null)
      setConfirmation('')
      load()
      router.refresh()
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
  if (!cleanPreview || !resetPreview) return null

  const cleanTotalRemovable =
    cleanPreview.removable.testUsers +
    cleanPreview.removable.testCandidates +
    cleanPreview.removable.testHiringRequests
  const resetTotalToDelete =
    resetPreview.toDelete.hiringRequests +
    resetPreview.toDelete.candidates +
    resetPreview.toDelete.interviews +
    resetPreview.toDelete.candidateDecisions +
    resetPreview.toDelete.offers +
    resetPreview.toDelete.activities +
    resetPreview.toDelete.aiTasks

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseIcon className="h-5 w-5" /> Data Management
          </CardTitle>
          <CardDescription>
            Inspect and remove data from your organization. Two flows are available:
            automatic demo/test cleanup and an explicit destructive reset.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
              {error}
            </div>
          )}

          {result && (
            <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                <CheckIcon className="h-4 w-4" />
                {result.kind === 'clean' ? 'Demo/Test cleanup complete' : 'Business data reset complete'}
              </div>
              <div className="text-xs text-emerald-800 dark:text-emerald-300">
                {result.kind === 'clean' ? (
                  <>
                    Removed {result.data.removed.users} users, {result.data.removed.candidates} candidates, {result.data.removed.hiringRequests} hiring requests, {result.data.removed.interviews} interviews, {result.data.removed.decisions} decisions, {result.data.removed.offers} offers.
                  </>
                ) : (
                  <>
                    Removed {result.data.deleted.hiringRequests} hiring requests, {result.data.deleted.candidates} candidates, {result.data.deleted.interviews} interviews, {result.data.deleted.candidateDecisions} decisions, {result.data.deleted.offers} offers, {result.data.deleted.activities} activities, {result.data.deleted.aiTasks} AI tasks, {result.data.deleted.aiConversations} AI conversations, {result.data.deleted.copilotConfirmations} copilot confirmations.
                  </>
                )}
              </div>
              <div className="mt-2 text-xs text-emerald-800 dark:text-emerald-300">
                Preserved: <span className="font-semibold">{result.data.preserved.organization}</span>, {result.data.preserved.adminCount} ADMINs, {result.data.preserved.promptTemplates ?? 0} prompt templates, {result.data.preserved.auditLogs ?? 0} audit log entries.
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                <LockIcon className="h-4 w-4" /> Always protected
              </div>
              <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
                <li>Organization: <span className="font-semibold">{cleanPreview.organization.name}</span></li>
                <li>Active ADMINs: <span className="font-semibold">{cleanPreview.protected.admins}</span></li>
                <li>All User accounts (current org)</li>
                <li>Prompt templates: <span className="font-semibold">{cleanPreview.protected.promptTemplates}</span></li>
                <li>Audit log entries (security history)</li>
                <li>Authentication configuration</li>
                <li>RBAC / role configuration</li>
              </ul>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                <AlertTriangleIcon className="h-4 w-4" /> Demo/Test (auto-classified)
              </div>
              <ul className="space-y-1 text-sm text-amber-900 dark:text-amber-200">
                <li>Test users: <span className="font-semibold">{cleanPreview.removable.testUsers}</span></li>
                <li>Test candidates: <span className="font-semibold">{cleanPreview.removable.testCandidates}</span></li>
                <li>Test hiring requests: <span className="font-semibold">{cleanPreview.removable.testHiringRequests}</span></li>
                <li className="pt-1 text-xs">Associated cascades:</li>
                <li className="ml-3 text-xs">Interviews: {cleanPreview.removable.associated.interviews}</li>
                <li className="ml-3 text-xs">Decisions: {cleanPreview.removable.associated.decisions}</li>
                <li className="ml-3 text-xs">Offers: {cleanPreview.removable.associated.offers}</li>
                <li className="ml-3 text-xs">Activities: {cleanPreview.removable.associated.activities}</li>
              </ul>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              <ShieldCheckIcon className="h-4 w-4" /> Preserved as potentially real
            </div>
            <p className="text-sm text-emerald-900 dark:text-emerald-200">
              Records that do not match our test/demo patterns are preserved:{' '}
              <span className="font-semibold">{cleanPreview.potentiallyReal.users} users</span>,{' '}
              <span className="font-semibold">{cleanPreview.potentiallyReal.candidates} candidates</span>,{' '}
              <span className="font-semibold">{cleanPreview.potentiallyReal.hiringRequests} hiring requests</span>.
            </p>
          </div>

          {activeConfirm !== 'reset' && (
            <div className="mt-6 flex justify-end">
              <Button
                onClick={() => setActiveConfirm('clean')}
                variant="outline"
                disabled={cleanTotalRemovable === 0}
              >
                <Trash2Icon className="h-4 w-4" /> Clean Demo & Test Data
              </Button>
            </div>
          )}

          {activeConfirm === 'clean' && (
            <ConfirmBox
              title="Clean Demo & Test Data"
              warning="This will remove all records auto-classified as demo/test data. It does NOT touch records classified as potentially real. This action cannot be undone."
              phrase="CLEAN DEMO DATA"
              pending={pending}
              confirmation={confirmation}
              setConfirmation={setConfirmation}
              onCancel={() => { setActiveConfirm(null); setConfirmation('') }}
              onConfirm={runClean}
            />
          )}
        </CardContent>
      </Card>

      {/* Destructive Reset */}
      <Card className="border-red-200 dark:border-red-900/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-300">
            <RefreshCwIcon className="h-5 w-5" /> Reset Talent Data (Destructive)
          </CardTitle>
          <CardDescription>
            Removes ALL operational data in this organization: hiring requests, candidates, interviews, decisions, offers, activities, AI tasks, AI conversations, copilot confirmations, and job descriptions. Use this to start fresh before go-live or after a pilot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 dark:border-red-900/40 dark:bg-red-950/20">
            <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
              <Stat label="Hiring Requests" value={resetPreview.toDelete.hiringRequests} />
              <Stat label="Candidates" value={resetPreview.toDelete.candidates} />
              <Stat label="Candidate Skills" value={resetPreview.toDelete.candidateSkills} />
              <Stat label="Interviews" value={resetPreview.toDelete.interviews} />
              <Stat label="Evaluations" value={resetPreview.toDelete.interviewEvaluations} />
              <Stat label="Decisions" value={resetPreview.toDelete.candidateDecisions} />
              <Stat label="Offers" value={resetPreview.toDelete.offers} />
              <Stat label="Activities" value={resetPreview.toDelete.activities} />
              <Stat label="AI Tasks" value={resetPreview.toDelete.aiTasks} />
              <Stat label="AI Conversations" value={resetPreview.toDelete.aiConversations} />
              <Stat label="Copilot Confirms" value={resetPreview.toDelete.copilotConfirmations} />
              <Stat label="Job Descriptions" value={resetPreview.toDelete.jobDescriptions} />
            </div>
            <div className="mt-3 border-t border-red-200 pt-3 text-xs text-red-800 dark:border-red-900/40 dark:text-red-300">
              <strong>Always preserved:</strong> Organization, current ADMIN, {resetPreview.preserved.totalUsers} user accounts, {resetPreview.preserved.departments} departments, {resetPreview.preserved.promptTemplates} prompt templates, {resetPreview.preserved.auditLogs} audit log entries.
            </div>
          </div>

          {activeConfirm !== 'clean' && (
            <div className="mt-6 flex justify-end">
              <Button
                onClick={() => setActiveConfirm('reset')}
                variant="destructive"
                disabled={resetTotalToDelete === 0}
              >
                <AlertTriangleIcon className="h-4 w-4" /> Reset Talent Data
              </Button>
            </div>
          )}

          {activeConfirm === 'reset' && (
            <ConfirmBox
              title="Reset Talent Data"
              warning="This will permanently delete ALL operational data in your organization. This is destructive and cannot be undone. Protected items (organization, users, audit logs, prompt templates) will be preserved."
              phrase="RESET TALENT DATA"
              pending={pending}
              confirmation={confirmation}
              setConfirmation={setConfirmation}
              onCancel={() => { setActiveConfirm(null); setConfirmation('') }}
              onConfirm={runReset}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded bg-white/60 px-2 py-1 dark:bg-slate-800/50">
      <span className="text-xs text-slate-600 dark:text-slate-300">{label}</span>
      <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">{value}</span>
    </div>
  )
}

function ConfirmBox({
  title,
  warning,
  phrase,
  pending,
  confirmation,
  setConfirmation,
  onCancel,
  onConfirm,
}: {
  title: string
  warning: string
  phrase: string
  pending: boolean
  confirmation: string
  setConfirmation: (v: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="mt-6 rounded-lg border-2 border-red-300 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/20">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-900 dark:text-red-200">
        <AlertTriangleIcon className="h-4 w-4" /> {title}
      </div>
      <p className="mb-3 text-xs text-red-800 dark:text-red-300">{warning}</p>
      <p className="mb-2 text-xs text-red-800 dark:text-red-300">
        To confirm, type <code className="rounded bg-white px-1.5 py-0.5 font-mono text-red-900 dark:bg-slate-800 dark:text-red-200">{phrase}</code> below.
      </p>
      <input
        value={confirmation}
        onChange={e => setConfirmation(e.target.value)}
        placeholder={phrase}
        className="h-10 w-full rounded-md border border-red-300 bg-white px-3 text-sm font-mono focus:border-red-500 focus:outline-none dark:border-red-700 dark:bg-slate-800"
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button variant="destructive" disabled={pending || confirmation.trim() !== phrase} onClick={onConfirm}>
          {pending ? <><LoaderIcon className="h-4 w-4 animate-spin" /> Working…</> : 'Run'}
        </Button>
      </div>
    </div>
  )
}
