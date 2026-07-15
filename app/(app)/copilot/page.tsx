'use client'

export const dynamic = 'force-dynamic'

/**
 * Sprint 11 — AI Copilot UI.
 *
 * /copilot — the primary AI workspace. Uses the existing
 * TalentOS design language. Includes:
 *   - Header with role-aware suggested prompts
 *   - Conversation area
 *   - Message composer
 *   - Result cards with record links
 *   - Loading / error / empty states
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SparklesIcon, LoaderIcon, ShieldAlertIcon, SendIcon, BrainIcon, UserIcon, ArrowRightIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { askCopilotAction, getRecentCopilotHistoryAction } from '@/features/copilot/actions/ask-copilot-action'
import { cn } from '@/lib/utils'

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

interface ChatMessage {
  id: string
  role: 'USER' | 'ASSISTANT' | 'SYSTEM'
  content: string
  findings?: Array<{ label: string; value: string }>
  records?: Array<{ type: string; id: string; label: string; href: string }>
  suggestedQuestions?: string[]
  limitations?: string[]
  blocked?: boolean
  blockedReason?: string
  toolIds?: string[]
  createdAt: string
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
      // Fetch history
      const h = await getRecentCopilotHistoryAction(30)
      if (h.ok) {
        // Convert conversation rows to ChatMessage[]
        const chat: ChatMessage[] = h.data.map(c => ({
          id: c.id,
          role: c.role as 'USER' | 'ASSISTANT',
          content: c.content,
          createdAt: c.createdAt,
        }))
        // We don't have a 'SYSTEM' role in the data; type-guard it
        setMessages(chat)
        setMessages(chat)
        // Also set the condensed history for multi-turn
        setHistory(chat.slice(-10).map(c => ({ role: c.role as 'USER' | 'ASSISTANT', content: c.content })))
      }
      // Try to detect role from session
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
      const r = data.response!
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
    })
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
            <p className="text-xs text-slate-500 dark:text-slate-400">Read-only intelligence over your authorized TalentOS data</p>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-3xl space-y-5">
          {(messages?.length ?? 0) === 0 ? (
            <EmptyState role={role} onPick={q => ask(q)} />
          ) : (
            (messages ?? []).map(m => <MessageBubble key={m.id} message={m} onPick={ask} />)
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
            placeholder="Ask about your hiring data… (e.g. 'Which offers need approval?')"
            className="h-11 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
          />
          <Button type="submit" size="default" disabled={pending || !input.trim()}>
            <SendIcon className="h-4 w-4" />
          </Button>
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-[10px] text-slate-500 dark:text-slate-400">
          TalentOS AI Copilot is read-only. It cannot create, edit, approve, or issue offers or other records. Use the relevant TalentOS page for actions.
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
          Get grounded answers from your authorized TalentOS data. Every answer is sourced from real records.
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

function MessageBubble({ message, onPick }: { message: ChatMessage; onPick: (q: string) => void }) {
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
        {!isUser && !message.blocked && (
          <>
            {message.findings && message.findings.length > 0 && (
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
            {message.records && message.records.length > 0 && (
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
            {message.limitations && message.limitations.length > 0 && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                {(message.limitations ?? []).map((l, i) => <p key={i}>{l}</p>)}
              </div>
            )}
            {message.suggestedQuestions && message.suggestedQuestions.length > 0 && (
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
