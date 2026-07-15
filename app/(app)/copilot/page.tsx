'use client'

/**
 * Sprint 11.1 — AI Copilot UI.
 *
 * /copilot — the primary AI workspace. Uses the existing
 * TalentOS design language. Includes:
 *   - Header with role-aware suggested prompts
 *   - Conversation area
 *   - Message composer
 *   - Read-only result cards with record links
 *   - Action preview card with explicit Confirm / Cancel buttons
 *   - Loading / error / empty / security-check states
 *
 * The action preview card (PART 9) is the heart of Sprint 11.1.
 * It clearly distinguishes "AI interpreted your request" from
 * "This action has been executed" and requires an explicit click.
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SparklesIcon, LoaderIcon, ShieldAlertIcon, SendIcon, BrainIcon, UserIcon, ArrowRightIcon, CheckIcon, XIcon, EditIcon, ExternalLinkIcon, AlertCircleIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { askCopilotAction, executeCopilotActionAction, cancelCopilotActionAction, getRecentCopilotHistoryAction } from '@/features/copilot/actions/ask-copilot-action'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const ROLE_SUGGESTIONS: Record<string, string[]> = {
  ADMIN: [
    'Give me an executive hiring summary',
    'Which departments have the most open roles?',
    'What needs attention across hiring?',
  ],
  TA_LEAD: [
    'Which hiring requests are blocked?',
    'Which candidates are awaiting evaluation?',
    'Which offers need approval?',
  ],
  RECRUITER: [
    'What needs my attention today?',
    'Which candidates need interviews?',
    'Show selected candidates without offers',
    'Create a hiring request draft for a Senior Backend Engineer',
  ],
  HIRING_MANAGER: [
    'Summarize my open roles',
    'Which candidates are ready for review?',
  ],
  INTERVIEWER: [
    'Show my upcoming interviews',
    'Which evaluations do I need to complete?',
  ],
  VIEWER: [
    'How many open hiring requests exist?',
    'How many candidates are in each stage?',
  ],
  CANDIDATE: [
    'How many open hiring requests exist?',
  ],
  USER: [
    'Give me an executive hiring summary',
    'Which candidates are awaiting evaluation?',
    'Which offers need approval?',
  ],
}

// Shape of the response from askCopilotAction
interface OutcomeRead {
  kind: 'read_response'
  response: {
    answer: string
    summary?: string
    findings: Array<{ label: string; value: string }>
    records: Array<{ type: string; id: string; label: string; href: string }>
    suggestedQuestions: string[]
    limitations: string[]
  }
}
interface OutcomeActionPreview {
  kind: 'action_preview'
  actionId: string
  confirmationId: string
  preview: any
  expiresAt: string
  proposedArguments: Record<string, unknown>
}
interface OutcomeMissing {
  kind: 'action_missing_arguments'
  actionId: string
  missingFields: string[]
  question: string
}
interface OutcomeUnsupported {
  kind: 'unsupported_action'
  message: string
}
interface OutcomeBlocked {
  kind: 'blocked'
  reason: string
}
interface OutcomeError {
  kind: 'error'
  message: string
}
type Outcome = OutcomeRead | OutcomeActionPreview | OutcomeMissing | OutcomeUnsupported | OutcomeBlocked | OutcomeError

type ActionCardState = 'PREVIEW' | 'CONFIRMING' | 'EXECUTED' | 'CANCELLED' | 'EXPIRED' | 'FAILED'

interface ActionCard {
  confirmationId: string
  actionId: string
  preview: any
  proposedArguments: Record<string, unknown>
  state: ActionCardState
  result?: { resourceId: string; resourceType: string; canonicalUrl: string; label: string }
  failureReason?: string
  expiresAt: string
}

interface ChatMessage {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  outcome?: Outcome
  // For read responses:
  findings?: Array<{ label: string; value: string }>
  records?: Array<{ type: string; id: string; label: string; href: string }>
  suggestedQuestions?: string[]
  limitations?: string[]
  // For action cards:
  actionCard?: ActionCard
  // For unsupported / blocked:
  blocked?: boolean
  // Other
  createdAt: string
}

function actionLabel(actionId: string): string {
  return actionId.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase())
}

export default function CopilotPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<string>('USER')
  const [history, setHistory] = useState<Array<{ role: 'USER' | 'ASSISTANT'; content: string }>>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    startTransition(async () => {
      const h = await getRecentCopilotHistoryAction(30)
      if (h.ok) {
        const chat: ChatMessage[] = h.data.map(c => ({
          id: c.id,
          role: c.role as 'USER' | 'ASSISTANT',
          content: c.content,
          createdAt: c.createdAt,
        }))
        setMessages(chat)
        setHistory(chat.slice(-10).map(c => ({ role: c.role as 'USER' | 'ASSISTANT', content: c.content })))
      }
      try {
        const r = await fetch('/api/auth/session')
        const s = await r.json()
        if (s?.user?.role) setRole(s.user.role)
      } catch {}
    })
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  function ask(message: string) {
    if (!message.trim() || pending) return
    setError(null)
    const userMsg: ChatMessage = {
      id: 'tmp-u-' + Date.now(),
      role: 'USER',
      content: message,
      createdAt: new Date().toISOString(),
    }
    setMessages(m => [...m, userMsg])
    setInput('')
    startTransition(async () => {
      const result = await askCopilotAction({ message, history: history.slice(-10) })
      if (!result.ok) {
        const assistant: ChatMessage = {
          id: 'tmp-a-' + Date.now(),
          role: 'ASSISTANT',
          content: result.error?.message ?? 'TalentOS AI is temporarily unavailable.',
          blocked: true,
          createdAt: new Date().toISOString(),
        }
        setMessages(m => [...m, assistant])
        return
      }
      const data = result.data
      if (data.blockedReason) {
        const assistant: ChatMessage = {
          id: 'tmp-a-' + Date.now(),
          role: 'ASSISTANT',
          content: data.blockedReason,
          blocked: true,
          createdAt: new Date().toISOString(),
        }
        setMessages(m => [...m, assistant])
        return
      }
      const outcome = data.outcome
      if (!outcome) {
        const assistant: ChatMessage = {
          id: 'tmp-a-' + Date.now(),
          role: 'ASSISTANT',
          content: 'TalentOS AI did not return a result.',
          createdAt: new Date().toISOString(),
        }
        setMessages(m => [...m, assistant])
        return
      }
      if (outcome.kind === 'read_response') {
        const r = outcome.response
        const assistant: ChatMessage = {
          id: 'tmp-a-' + Date.now(),
          role: 'ASSISTANT',
          content: r.answer,
          findings: r.findings,
          records: r.records,
          suggestedQuestions: r.suggestedQuestions,
          limitations: r.limitations,
          createdAt: new Date().toISOString(),
        }
        setMessages(m => [...m, assistant])
        setHistory(h => [...h, { role: 'USER' as const, content: message }, { role: 'ASSISTANT' as const, content: r.answer }].slice(-10))
      } else if (outcome.kind === 'action_preview') {
        const assistant: ChatMessage = {
          id: 'tmp-a-' + Date.now(),
          role: 'ASSISTANT',
          content: `AI interpreted your request: ${actionLabel(outcome.actionId)}. Please review the preview below and confirm.`,
          actionCard: {
            confirmationId: outcome.confirmationId,
            actionId: outcome.actionId,
            preview: outcome.preview,
            proposedArguments: outcome.proposedArguments,
            state: 'PREVIEW',
            expiresAt: outcome.expiresAt,
          },
          createdAt: new Date().toISOString(),
        }
        setMessages(m => [...m, assistant])
      } else if (outcome.kind === 'action_missing_arguments') {
        const assistant: ChatMessage = {
          id: 'tmp-a-' + Date.now(),
          role: 'ASSISTANT',
          content: outcome.question,
          createdAt: new Date().toISOString(),
        }
        setMessages(m => [...m, assistant])
      } else if (outcome.kind === 'unsupported_action') {
        const assistant: ChatMessage = {
          id: 'tmp-a-' + Date.now(),
          role: 'ASSISTANT',
          content: outcome.message,
          blocked: true,
          createdAt: new Date().toISOString(),
        }
        setMessages(m => [...m, assistant])
      } else if (outcome.kind === 'error') {
        const assistant: ChatMessage = {
          id: 'tmp-a-' + Date.now(),
          role: 'ASSISTANT',
          content: outcome.message,
          blocked: true,
          createdAt: new Date().toISOString(),
        }
        setMessages(m => [...m, assistant])
      }
    })
  }

  function confirmAction(messageId: string, card: ActionCard) {
    setMessages(m => m.map(msg => msg.id === messageId && msg.actionCard
      ? { ...msg, actionCard: { ...card, state: 'CONFIRMING' } }
      : msg
    ))
    startTransition(async () => {
      const result = await executeCopilotActionAction({ confirmationId: card.confirmationId })
      if (!result.ok) {
        setMessages(m => m.map(msg => msg.id === messageId && msg.actionCard
          ? { ...msg, actionCard: { ...card, state: 'FAILED', failureReason: result.error?.message ?? 'Action failed.' } }
          : msg
        ))
        return
      }
      const data = result.data
      if (data.ok) {
        setMessages(m => m.map(msg => msg.id === messageId && msg.actionCard
          ? { ...msg, actionCard: { ...card, state: 'EXECUTED', result: data.result } }
          : msg
        ))
      } else {
        const failure = data.failure
        setMessages(m => m.map(msg => msg.id === messageId && msg.actionCard
          ? { ...msg, actionCard: { ...card, state: 'FAILED', failureReason: failure.message } }
          : msg
        ))
      }
    })
  }

  function cancelAction(messageId: string, card: ActionCard) {
    setMessages(m => m.map(msg => msg.id === messageId && msg.actionCard
      ? { ...msg, actionCard: { ...card, state: 'CANCELLED' } }
      : msg
    ))
    void cancelCopilotActionAction({ confirmationId: card.confirmationId })
  }

  const suggestions = ROLE_SUGGESTIONS[role] ?? ROLE_SUGGESTIONS.USER

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="border-b border-slate-200 bg-white px-8 py-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-white">
            <SparklesIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">AI Copilot</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Read-only intelligence + 3 controlled AI actions (Hiring Request draft, Schedule Interview, Offer draft)</p>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-3xl space-y-5">
          {(messages?.length ?? 0) === 0 ? (
            <EmptyState role={role} onPick={q => ask(q)} />
          ) : (
            (messages ?? []).map(m => (
              <MessageBubble
                key={m.id}
                message={m}
                onPick={ask}
                onConfirm={confirmAction}
                onCancel={cancelAction}
              />
            ))
          )}
          {pending && (
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white">
                <SparklesIcon className="h-4 w-4" />
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">
                <LoaderIcon className="mr-2 inline h-4 w-4 animate-spin" />
                TalentOS AI is thinking…
              </div>
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
              <ShieldAlertIcon className="mt-0.5 h-4 w-4 flex-none" />
              <p>{error}</p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-8 py-4 dark:border-slate-700 dark:bg-slate-800">
        <form
          onSubmit={e => { e.preventDefault(); ask(input) }}
          className="mx-auto flex max-w-3xl items-center gap-2"
        >
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={pending}
            placeholder="Ask about your hiring data… or say 'Create a hiring request draft for a Senior Backend Engineer'"
            className="h-11 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
          />
          <Button type="submit" size="default" disabled={pending || !input.trim()}>
            <SendIcon className="h-4 w-4" />
          </Button>
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-[10px] text-slate-500 dark:text-slate-400">
          TalentOS AI Copilot is read-only by default. The 3 AI actions (Hiring Request draft, Schedule Interview, Offer draft) require explicit human confirmation before any business mutation.
        </p>
      </div>
    </div>
  )
}

function EmptyState({ role, onPick }: { role: string; onPick: (q: string) => void }) {
  const suggestions = ROLE_SUGGESTIONS[role] ?? ROLE_SUGGESTIONS.USER
  return (
    <div className="space-y-6 py-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white">
        <BrainIcon className="h-7 w-7" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Ask the AI Copilot</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Get grounded answers from your authorized TalentOS data, or use one of the 3 controlled AI actions.
        </p>
      </div>
      <div className="grid gap-2 text-left md:grid-cols-2">
        {suggestions.map(s => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="group flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-emerald-950/20"
          >
            <span>{s}</span>
            <ArrowRightIcon className="h-3.5 w-3.5 text-slate-400 group-hover:text-emerald-600" />
          </button>
        ))}
      </div>
    </div>
  )
}

function MessageBubble({
  message,
  onPick,
  onConfirm,
  onCancel,
}: {
  message: ChatMessage
  onPick: (q: string) => void
  onConfirm: (id: string, card: ActionCard) => void
  onCancel: (id: string, card: ActionCard) => void
}) {
  const isUser = message.role === 'USER'
  return (
    <div className={cn('flex items-start gap-3', isUser && 'flex-row-reverse')}>
      <div className={cn(
        'flex h-8 w-8 flex-none items-center justify-center rounded-full text-white',
        isUser ? 'bg-slate-700' : 'bg-gradient-to-br from-emerald-500 to-emerald-600',
      )}>
        {isUser ? <UserIcon className="h-4 w-4" /> : <SparklesIcon className="h-4 w-4" />}
      </div>
      <div className={cn('max-w-[85%] space-y-3', isUser && 'text-right')}>
        <div className={cn(
          'inline-block rounded-lg px-4 py-3 text-left text-sm',
          isUser
            ? 'bg-slate-700 text-white'
            : message.blocked
              ? 'border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100'
              : 'border border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50',
        )}>
          {message.blocked && (
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
              <ShieldAlertIcon className="h-3.5 w-3.5" /> Security check
            </div>
          )}
          <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        </div>
        {!isUser && !message.blocked && message.actionCard && (
          <ActionPreviewCard messageId={message.id} card={message.actionCard} onConfirm={onConfirm} onCancel={onCancel} />
        )}
        {!isUser && !message.blocked && !message.actionCard && (
          <>
            {(message.findings ?? []).length > 0 && (
              <Card>
                <CardContent className="space-y-1.5 p-3">
                  {(message.findings ?? []).map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">{f.label}</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-50">{f.value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {(message.records ?? []).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Records</p>
                <div className="grid gap-1.5 md:grid-cols-2">
                  {(message.records ?? []).map(r => (
                    <a
                      key={r.id}
                      href={r.href}
                      className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-emerald-950/20"
                    >
                      <span className="truncate">{r.label}</span>
                      <ArrowRightIcon className="h-3 w-3 flex-none text-slate-400" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {(message.limitations ?? []).length > 0 && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                {(message.limitations ?? []).map((l, i) => <p key={i}>{l}</p>)}
              </div>
            )}
            {(message.suggestedQuestions ?? []).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Suggested follow-ups</p>
                <div className="flex flex-wrap gap-1.5">
                  {(message.suggestedQuestions ?? []).map((q, i) => (
                    <button
                      key={i}
                      onClick={() => onPick(q)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-emerald-950/20"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ActionPreviewCard({
  messageId,
  card,
  onConfirm,
  onCancel,
}: {
  messageId: string
  card: ActionCard
  onConfirm: (id: string, card: ActionCard) => void
  onCancel: (id: string, card: ActionCard) => void
}) {
  const preview = card.preview
  const isPreview = card.state === 'PREVIEW'
  const isConfirming = card.state === 'CONFIRMING'
  const isExecuted = card.state === 'EXECUTED'
  const isCancelled = card.state === 'CANCELLED'
  const isFailed = card.state === 'FAILED'

  // Build a flat list of fields to render
  const fields: Array<{ label: string; value: string; sensitive?: boolean }> = []
  if (preview) {
    if (typeof preview.title === 'string') fields.push({ label: 'Title', value: preview.title })
    if (typeof preview.department === 'string') fields.push({ label: 'Department', value: preview.department })
    if (typeof preview.level === 'string') fields.push({ label: 'Level', value: preview.level })
    if (typeof preview.jobType === 'string') fields.push({ label: 'Employment', value: preview.jobType })
    if (typeof preview.workArrangement === 'string') fields.push({ label: 'Work arrangement', value: preview.workArrangement })
    if (typeof preview.openings === 'number') fields.push({ label: 'Openings', value: String(preview.openings) })
    if (typeof preview.location === 'string') fields.push({ label: 'Location', value: preview.location })
    if (typeof preview.hiringManager === 'string') fields.push({ label: 'Hiring manager', value: preview.hiringManager })
    if (typeof preview.candidateName === 'string') fields.push({ label: 'Candidate', value: preview.candidateName })
    if (typeof preview.candidateId === 'string') fields.push({ label: 'Candidate ID', value: preview.candidateId })
    if (typeof preview.hiringRequestTitle === 'string') fields.push({ label: 'Hiring request', value: preview.hiringRequestTitle })
    if (typeof preview.type === 'string') fields.push({ label: 'Type', value: preview.type })
    if (typeof preview.scheduledAt === 'string') fields.push({ label: 'Scheduled at', value: preview.scheduledAt })
    if (typeof preview.durationMinutes === 'number') fields.push({ label: 'Duration', value: `${preview.durationMinutes} min` })
    if (typeof preview.timezone === 'string') fields.push({ label: 'Timezone', value: preview.timezone })
    if (Array.isArray(preview.participantNames)) fields.push({ label: 'Participants', value: preview.participantNames.join(', ') })
    // Compensation (sensitive)
    if (typeof preview.salaryAmount === 'number') {
      const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: preview.salaryCurrency || 'USD', maximumFractionDigits: 0 }).format(preview.salaryAmount)
      fields.push({ label: 'Salary', value: `${formatted} / ${(preview.salaryPeriod || 'YEAR').toLowerCase()}`, sensitive: true })
    }
    if (typeof preview.employmentType === 'string') fields.push({ label: 'Employment', value: preview.employmentType.toLowerCase() })
    if (typeof preview.willCreateAs === 'string') fields.push({ label: 'Status', value: preview.willCreateAs })
  }

  return (
    <div className={cn(
      'rounded-xl border-2 p-4',
      isExecuted ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-700 dark:bg-emerald-950/20' :
      isFailed ? 'border-red-300 bg-red-50/50 dark:border-red-700 dark:bg-red-950/20' :
      isCancelled ? 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50' :
      'border-amber-300 bg-amber-50/30 dark:border-amber-700 dark:bg-amber-950/10',
    )}>
      <div className="mb-3 flex items-center gap-2">
        {isExecuted ? <CheckIcon className="h-4 w-4 text-emerald-600" /> :
         isFailed ? <AlertCircleIcon className="h-4 w-4 text-red-600" /> :
         isCancelled ? <XIcon className="h-4 w-4 text-slate-500" /> :
         <AlertCircleIcon className="h-4 w-4 text-amber-600" />}
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
          {isExecuted ? 'EXECUTED' : isFailed ? 'FAILED' : isCancelled ? 'CANCELLED' : isConfirming ? 'CONFIRMING…' : 'AI ACTION PREVIEW'}
        </span>
      </div>

      {isPreview && (
        <p className="mb-3 text-[11px] text-slate-600 dark:text-slate-400">
          AI interpreted your request. This action has <strong>not</strong> been executed. Review the preview and click <strong>Confirm</strong> to proceed.
        </p>
      )}
      {isExecuted && card.result && (
        <p className="mb-3 text-[11px] text-emerald-700 dark:text-emerald-300">
          <strong>This action has been executed.</strong> The TalentOS service confirmed success.
        </p>
      )}
      {isFailed && card.failureReason && (
        <p className="mb-3 text-[11px] text-red-700 dark:text-red-300">
          {card.failureReason}
        </p>
      )}

      <dl className="space-y-1.5 text-xs">
        {fields.map((f, i) => (
          <div key={i} className="flex items-start justify-between gap-3 border-b border-slate-200/50 pb-1 last:border-0 dark:border-slate-700/50">
            <dt className="text-slate-500">{f.label}</dt>
            <dd className={cn('text-right font-medium', f.sensitive ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-slate-50')}>
              {f.sensitive ? '🔒 ' : ''}{f.value}
            </dd>
          </div>
        ))}
      </dl>

      {isExecuted && card.result && (
        <a
          href={card.result.canonicalUrl}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:bg-slate-800 dark:text-emerald-300"
        >
          Open in TalentOS <ExternalLinkIcon className="h-3 w-3" />
        </a>
      )}

      {isPreview && (
        <div className="mt-4 flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => onConfirm(messageId, card)}
            disabled={isConfirming}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <CheckIcon className="h-3.5 w-3.5" /> Confirm
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onCancel(messageId, card)}
            disabled={isConfirming}
          >
            <XIcon className="h-3.5 w-3.5" /> Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
