'use client'

/**
 * Sprint 10 — Offer Detail (`/offers/[id]`).
 *
 * Premium review page with two clearly separated sections:
 *   1. OFFER FACTS  (compensation, dates, terms, status)
 *   2. OFFER LETTER (editable AI-assisted or manually-written content)
 *
 * Action bar offers the full lifecycle: edit (DRAFT), submit for
 * approval, approve, issue, record response, withdraw.
 *
 * Compensation fields are conditionally rendered based on the
 * caller's `offer.view_compensation` permission (server-side).
 */

import { use, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import {
  getOfferDetailAction,
  getOfferActivityAction,
  approveOfferAction,
  issueOfferAction,
  recordOfferResponseAction,
  submitOfferForApprovalAction,
  setOfferDraftContentAction,
  generateOfferDraftAction,
  editOfferAction,
  type OfferDetail,
} from '@/features/offers/actions/offer-actions'
import { OfferStatusBadge } from '@/features/offers/components/offer-status-badge'
import { CheckIcon, EyeIcon, EyeOffIcon, LoaderIcon, ShieldAlertIcon, SparklesIcon } from 'lucide-react'

interface PageProps {
  params: Promise<{ id: string }>
}

function fmtMoney(amount: number, currency: string, period: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount) + ` / ${period}`
  } catch {
    return `${amount} ${currency} / ${period}`
  }
}
function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

export default function OfferDetailPage({ params }: PageProps) {
  const router = useRouter()
  const { id } = use(params)
  const [detail, setDetail] = useState<OfferDetail | null>(null)
  const [activity, setActivity] = useState<Array<any>>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [actionPending, setActionPending] = useState<string | null>(null)

  // Letter editor state
  const [letterText, setLetterText] = useState<string>('')
  const [letterDirty, setLetterDirty] = useState(false)
  const [letterOpen, setLetterOpen] = useState(true)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)

  // Action confirmation
  const [confirmAction, setConfirmAction] = useState<null | 'approve' | 'issue' | 'accept' | 'decline' | 'withdraw'>(null)
  const [declineReason, setDeclineReason] = useState('')
  const [withdrawReason, setWithdrawReason] = useState('')

  function load() {
    startTransition(async () => {
      const [d, a] = await Promise.all([getOfferDetailAction(id), getOfferActivityAction(id)])
      if (d.ok) {
        setDetail(d.data)
        const initial = (d.data.draftContent as any)?.fullText ?? ''
        setLetterText(initial)
        setLetterDirty(false)
      } else {
        setError(d.error.message)
      }
      if (a.ok) setActivity(a.data)
    })
  }

  useEffect(() => { load() }, [id])

  async function doAction(kind: 'submit' | 'approve' | 'issue' | 'accept' | 'decline' | 'withdraw' | 'regen' | 'saveLetter', payload?: any) {
    setActionPending(kind)
    setError(null)
    try {
      let result: any
      if (kind === 'submit')   result = await submitOfferForApprovalAction(id)
      if (kind === 'approve')  result = await approveOfferAction(id, true)
      if (kind === 'issue')    result = await issueOfferAction(id, true)
      if (kind === 'accept')   result = await recordOfferResponseAction(id, 'ACCEPTED', { confirm: true })
      if (kind === 'decline')  result = await recordOfferResponseAction(id, 'DECLINED', { reason: declineReason || undefined })
      if (kind === 'withdraw') result = await recordOfferResponseAction(id, 'WITHDRAWN', { reason: withdrawReason })
      if (kind === 'regen')    result = await generateOfferDraftAction(id)
      if (kind === 'saveLetter') {
        const sections = parseLetter(letterText)
        result = await setOfferDraftContentAction(id, sections)
      }
      if (result?.ok) {
        if (kind === 'regen' && result.data?.draft) {
          const sections = (result.data.draft as any)
          const text = sectionsToText(sections)
          setLetterText(text)
          setLetterDirty(false)
        }
        setConfirmAction(null)
        setDeclineReason('')
        setWithdrawReason('')
        setShowRegenerateConfirm(false)
        load()
      } else {
        setError(result?.error?.message ?? 'Action failed')
      }
    } finally {
      setActionPending(null)
    }
  }

  if (error && !detail) {
    return (
      <div className="space-y-6 p-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
        <Button variant="outline" onClick={() => router.push('/offers')}>← Back to offers</Button>
      </div>
    )
  }
  if (!detail) {
    return <div className="p-8 text-sm text-slate-500">Loading offer…</div>
  }

  const isDraft = detail.status === 'DRAFT'
  const isPending = detail.status === 'PENDING_APPROVAL'
  const isApproved = detail.status === 'APPROVED'
  const isIssued = detail.status === 'ISSUED'
  const isTerminal = ['ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'].includes(detail.status)
  const isCreator = true // server enforces; the button presence matches permission
  const hasComp = detail.salaryAmount != null

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <button onClick={() => router.push('/offers')} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">← All offers</button>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{detail.title}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {detail.candidateName} · {detail.hiringRequestTitle} · {detail.department ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <OfferStatusBadge status={detail.status} />
          {detail.selfApproved && (
            <span title="This offer was self-approved by the only available ADMIN (escape hatch)" className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
              Self-approved (ADMIN escape hatch)
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300" role="alert">
          <ShieldAlertIcon className="mt-0.5 h-4 w-4 flex-none" />
          <p>{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* LEFT: facts + letter */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Offer facts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasComp ? (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <Fact label="Base salary" value={fmtMoney(detail.salaryAmount!, detail.salaryCurrency!, detail.salaryPeriod!)} />
                  {detail.bonusAmount != null && <Fact label="Bonus" value={`${detail.bonusAmount} ${detail.salaryCurrency}`} />}
                  {detail.equityAmount && <Fact label="Equity" value={detail.equityAmount} />}
                  {detail.commissionAmount != null && <Fact label="Commission" value={`${detail.commissionAmount} ${detail.salaryCurrency}`} />}
                  {detail.vacationDays != null && <Fact label="Vacation" value={`${detail.vacationDays} days`} />}
                  {detail.probationPeriodDays != null && <Fact label="Probation" value={`${detail.probationPeriodDays} days`} />}
                  {detail.noticePeriodDays != null && <Fact label="Notice" value={`${detail.noticePeriodDays} days`} />}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Compensation is restricted to authorized roles.</p>
              )}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <Fact label="Employment type" value={detail.employmentType ?? '—'} />
                <Fact label="Work arrangement" value={detail.workArrangement ?? '—'} />
                <Fact label="Start date" value={fmtDate(detail.startDate)} />
                <Fact label="Offer expires" value={fmtDate(detail.expiresAt)} />
                <Fact label="Created" value={fmtDate(detail.createdAt)} />
                <Fact label="Updated" value={fmtDate(detail.updatedAt)} />
              </div>
              {detail.benefits && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-500">Benefits</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{detail.benefits}</p>
                </div>
              )}
              {detail.additionalTerms && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-500">Additional terms</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{detail.additionalTerms}</p>
                </div>
              )}
              {detail.notes && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-500">Notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{detail.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle>Offer letter</CardTitle>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {detail.aiGeneratedAt
                      ? <>AI-generated draft on {fmtDate(detail.aiGeneratedAt)} · {detail.aiPromptVersion} · {detail.aiModelUsed ?? 'model'}</>
                      : 'Manually written'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {detail.aiGeneratedAt && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">
                      <SparklesIcon className="h-3 w-3" /> AI-generated
                    </span>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setLetterOpen(o => !o)}>
                    {letterOpen ? <EyeOffIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
                    {letterOpen ? 'Hide' : 'Show'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            {letterOpen && (
              <CardContent>
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                  AI-generated draft. Review employment terms and legal language before issuing.
                </p>
                <textarea
                  value={letterText}
                  onChange={e => { setLetterText(e.target.value); setLetterDirty(true) }}
                  disabled={isTerminal}
                  rows={20}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => doAction('saveLetter')} disabled={!letterDirty || actionPending === 'saveLetter'}>
                    {actionPending === 'saveLetter' && <LoaderIcon className="mr-1.5 h-3 w-3 animate-spin" />}
                    Save letter
                  </Button>
                  {!isTerminal && (
                    <>
                      {showRegenerateConfirm ? (
                        <>
                          <span className="text-xs text-amber-700 dark:text-amber-300">Regenerated content will replace your current AI draft. Continue?</span>
                          <Button size="sm" variant="outline" onClick={() => doAction('regen')}>Yes, regenerate</Button>
                          <Button size="sm" variant="ghost" onClick={() => setShowRegenerateConfirm(false)}>Cancel</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setShowRegenerateConfirm(true)}>
                          <SparklesIcon className="mr-1.5 h-3 w-3" /> Regenerate with AI
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        </div>

        {/* RIGHT: workflow + activity */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Workflow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isDraft && (
                <Button className="w-full" onClick={() => doAction('submit')} disabled={!!actionPending}>
                  Submit for approval
                </Button>
              )}
              {isPending && (
                <>
                  <Button className="w-full" onClick={() => setConfirmAction('approve')} disabled={!!actionPending}>
                    Approve offer
                  </Button>
                  <Button className="w-full" variant="outline" onClick={() => doAction('submit')} disabled={!!actionPending}>
                    Return for changes
                  </Button>
                </>
              )}
              {isApproved && (
                <Button className="w-full" onClick={() => setConfirmAction('issue')} disabled={!!actionPending}>
                  Mark as issued
                </Button>
              )}
              {isIssued && (
                <>
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => setConfirmAction('accept')} disabled={!!actionPending}>
                    Record accepted
                  </Button>
                  <Button className="w-full" variant="outline" onClick={() => setConfirmAction('decline')} disabled={!!actionPending}>
                    Record declined
                  </Button>
                  <Button className="w-full" variant="ghost" onClick={() => setConfirmAction('withdraw')} disabled={!!actionPending}>
                    Withdraw offer
                  </Button>
                </>
              )}
              {isTerminal && (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                  This offer is in a terminal state. No further actions are available.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="text-xs text-slate-500">No activity yet.</p>
              ) : (
                <ol className="space-y-3">
                  {activity.map((a) => (
                    <li key={a.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{a.title}</p>
                      {a.actorName && <p className="text-[10px] text-slate-500">by {a.actorName}</p>}
                      <p className="text-[10px] text-slate-400">{new Date(a.occurredAt).toLocaleString()}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Confirmation dialogs */}
      {confirmAction === 'approve' && (
        <ConfirmDialog
          title="Approve this offer?"
          body="Confirm that compensation, benefits, and employment terms have been reviewed."
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => doAction('approve')}
          confirmLabel="Approve"
        />
      )}
      {confirmAction === 'issue' && (
        <ConfirmDialog
          title="Mark this offer as issued?"
          body="This records the human-confirmed action that the offer was sent/shared externally. No real email is sent by TalentOS in this sprint."
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => doAction('issue')}
          confirmLabel="Mark as issued"
        />
      )}
      {confirmAction === 'accept' && (
        <ConfirmDialog
          title="Record offer accepted?"
          body="This is a human-authorized action. The candidate's stage may update to HIRED if defined."
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => doAction('accept')}
          confirmLabel="Yes, accepted"
        />
      )}
      {confirmAction === 'decline' && (
        <ConfirmDialog
          title="Record offer declined?"
          body="Optionally record a reason (visible only to authorized roles)."
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => doAction('decline')}
          confirmLabel="Record declined"
        >
          <input
            value={declineReason}
            onChange={e => setDeclineReason(e.target.value)}
            placeholder="Reason (optional)"
            className="mt-3 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </ConfirmDialog>
      )}
      {confirmAction === 'withdraw' && (
        <ConfirmDialog
          title="Withdraw this offer?"
          body="A reason is required for withdrawal."
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => doAction('withdraw')}
          confirmLabel="Withdraw"
          confirmDisabled={!withdrawReason.trim()}
        >
          <input
            value={withdrawReason}
            onChange={e => setWithdrawReason(e.target.value)}
            placeholder="Reason (required)"
            className="mt-3 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </ConfirmDialog>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-50">{value}</p>
    </div>
  )
}

function ConfirmDialog({
  title, body, children, onCancel, onConfirm, confirmLabel, confirmDisabled,
}: {
  title: string; body: string; children?: React.ReactNode;
  onCancel: () => void; onConfirm: () => void; confirmLabel: string; confirmDisabled?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{title}</h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{body}</p>
        {children}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm} disabled={confirmDisabled}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}

// Letter helpers
function sectionsToText(sections: any): string {
  if (typeof sections === 'string') return sections
  if (!sections || typeof sections !== 'object') return ''
  const order = ['title', 'opening', 'roleSummary', 'compensationSection', 'benefitsSection', 'employmentTermsSection', 'startDateSection', 'acceptanceInstructions', 'closing']
  const lines: string[] = []
  for (const k of order) {
    if (sections[k]) lines.push(`# ${k}\n${sections[k]}`)
  }
  if (Array.isArray(sections.disclaimers) && sections.disclaimers.length > 0) {
    lines.push('# disclaimers\n' + sections.disclaimers.map((d: string) => `- ${d}`).join('\n'))
  }
  return lines.join('\n\n')
}
function parseLetter(text: string): any {
  const sections: any = {}
  const disclaimers: string[] = []
  const blocks = text.split(/\n\n(?=# )/g)
  for (const b of blocks) {
    const m = b.match(/^# (\w+)\n([\s\S]*)$/)
    if (!m) continue
    const key = m[1]
    const body = m[2].trim()
    if (key === 'disclaimers') {
      disclaimers.push(...body.split('\n').map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean))
    } else {
      sections[key] = body
    }
  }
  if (disclaimers.length) sections.disclaimers = disclaimers
  sections.fullText = text
  return sections
}
