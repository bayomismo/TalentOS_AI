'use client'

/**
 * AI Recruiter wizard — the orchestrator.
 *
 * Owns the input phase, the "generating" phase (animated workflow), the
 * review phase, the save phase, and the friendly error/retry phase.
 *
 * Save flow: the review screen dispatches `save-start` with an intent
 * ('draft' | 'create'). A `useEffect` reacts to phase transitions and
 * runs the right server action. The reducer + effect pattern keeps the
 * side effect isolated to one place.
 *
 * On successful save it publishes `HiringRequestCreated` and
 * `ActivityRecorded` events to the global bus. The Dashboard and any
 * other subscriber react without a page reload.
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  FileTextIcon,
  RefreshCcwIcon,
  SparklesIcon,
  UserPlusIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CommandInput } from '@/features/ai-recruiter/components/command-input'
import { Greeting } from '@/features/ai-recruiter/components/greeting'
import { ProgressTimeline } from '@/features/ai-recruiter/components/progress-timeline'
import { RecentTasks } from '@/features/ai-recruiter/components/recent-tasks'
import { SuggestedPrompts } from '@/features/ai-recruiter/components/suggested-prompts'
import { useAiWorkflow } from '@/features/ai-recruiter/hooks/use-ai-workflow'

import { useEventBus } from '@/lib/events'
import type { EmploymentType, JobDescriptionDraft } from '@/lib/events/types'

import {
  createHiringRequestAction,
  generateJobDescriptionAction,
  saveHiringRequestDraftAction,
  type ActionResult,
  type CreateHiringRequestSuccess,
  type GenerateJobDescriptionSuccess,
  type SaveDraftSuccess,
  getJobTemplateForPrefillAction,
} from '../actions'
import { useWizard, useDraft, usePhase, WizardProvider, type WizardState } from './wizard-state'
import { ReviewScreen } from './review-screen'
import { extractRoleFromPrompt } from '@/features/ai-recruiter/data/mock-hiring-package'

// -----------------------------------------------------------------------------
// Static suggested prompts
// -----------------------------------------------------------------------------

const PROMPTS = [
  'Hire a Senior Frontend Developer',
  'Hire a Senior Backend Engineer',
  'Hire a Product Manager',
  'Hire a UX Designer',
  'Hire a Data Scientist',
  'Hire a DevOps Engineer',
] as const

const COMPANY_SUMMARY =
  'TalentOS is a modern talent acquisition platform that helps companies hire better, faster, and fairer. We combine structured workflows with AI-assisted candidate evaluation.'

// -----------------------------------------------------------------------------
// Provider (state + bus)
// -----------------------------------------------------------------------------

export function AiRecruiterWizard() {
  return (
    <WizardProvider>
      <WizardInner />
    </WizardProvider>
  )
}

// -----------------------------------------------------------------------------
// Inner: the actual flow
// -----------------------------------------------------------------------------

type SaveIntent = 'draft' | 'create' | null

function WizardInner() {
  const { state, dispatch } = useWizard()
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const bus = useEventBus()
  const { workflowState, activeStepIndex, stepStatuses, steps, startWorkflow, resetWorkflow } = useAiWorkflow()
  const saveIntentRef = useRef<SaveIntent>(null)
  const searchParams = useSearchParams()
  const templatePrefillApplied = useRef<string | null>(null)

  const draft = useDraft()
  const phase = usePhase()

  // Sprint 15 P1 — Job Library handoff.
  // If the URL has ?template=<id>, prefill the prompt with the template
  // (title + summary + key skills) so the user can adjust and generate,
  // or edit and save-as directly. We only apply once per template id.
  useEffect(() => {
    const templateId = searchParams?.get('template')
    if (!templateId) return
    if (templatePrefillApplied.current === templateId) return
    if (state.prompt) return
    templatePrefillApplied.current = templateId
    let cancelled = false
    ;(async () => {
      const r = await getJobTemplateForPrefillAction(templateId)
      if (cancelled || !r.ok) return
      const t = r.template
      const prompt = [
        `Use this job description as the starting point:`,
        ``,
        `Title: ${t.title}`,
        `Level: ${t.level}`,
        ``,
        t.summary ? `Summary: ${t.summary}` : '',
        ``,
        `Required skills: ${t.requiredSkills.join(', ') || '(none listed)'}`,
        ``,
        `Original description:`,
        t.description.slice(0, 1500),
        ``,
        `Refine and tailor this for our team, then generate a fresh draft.`,
      ].filter(Boolean).join('\n')
      dispatch({ type: 'set-prompt', prompt })
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Heuristic — turn the user's free-form prompt into wizard meta fields.
  const inferMeta = (prompt: string): {
    role: string
    department: string
    employmentType: EmploymentType
    experience: string
  } => {
    const role = extractRoleFromPrompt(prompt)
    const lower = prompt.toLowerCase()
    const department = lower.includes('design') || lower.includes('ux')
      ? 'Design'
      : lower.includes('data')
        ? 'Data'
        : lower.includes('product')
          ? 'Product'
          : 'Engineering'
    const experience = lower.includes('senior') || lower.includes('staff') || lower.includes('principal')
      ? '5+ years'
      : lower.includes('junior')
        ? '1-3 years'
        : lower.includes('intern')
          ? 'Entry level / Intern'
          : '3+ years'
    return { role, department, employmentType: 'FULL_TIME', experience }
  }

  async function handleSubmit(prompt: string) {
    if (!prompt.trim()) return
    setError(null)
    resetWorkflow()
    const meta = inferMeta(prompt)
    dispatch({ type: 'set-prompt', prompt })

    startWorkflow()

    startTransition(async () => {
      const result: ActionResult<GenerateJobDescriptionSuccess> = await generateJobDescriptionAction({
        role: meta.role,
        department: meta.department,
        employmentType: meta.employmentType,
        experience: meta.experience,
        location: 'Remote (Europe)',
        companySummary: COMPANY_SUMMARY,
        extraContext: prompt,
      })

      // Let the workflow animation play even if the call returns very fast
      // — users see the engine doing its thing.
      await new Promise(resolve => setTimeout(resolve, 800))

      if (!result.ok) {
        setError(result.error.message)
        dispatch({ type: 'generate-error', error: result.error })
        resetWorkflow()
        return
      }

      dispatch({
        type: 'generate-success',
        draft: result.data.draft,
        aiTaskId: result.data.aiTaskId,
        usage: result.data.usage,
        model: result.data.model,
      })

      bus.publish({
        type: 'JobDescriptionGenerated',
        payload: { jobDescription: snapshotFromDraft(result.data.draft), source: 'wizard' },
      })
    })
  }

  // Save side-effect: when the reducer puts the wizard into the 'saving'
  // phase, run the right action based on the saved intent.
  useEffect(() => {
    if (phase !== 'saving') return
    const intent = saveIntentRef.current
    if (!intent || !draft) return

    let cancelled = false
    ;(async () => {
      setError(null)
      if (intent === 'draft') {
        const result: ActionResult<SaveDraftSuccess> = await saveHiringRequestDraftAction({ draft })
        if (cancelled) return
        if (!result.ok) {
          setError(result.error.message)
          dispatch({ type: 'save-error', error: result.error })
          return
        }
        dispatch({ type: 'save-success', hiringRequestId: result.data.jobDescription.id })
        return
      }

      const result: ActionResult<CreateHiringRequestSuccess> = await createHiringRequestAction({
        draft,
        aiTaskId: state.aiTaskId,
      })
      if (cancelled) return
      if (!result.ok) {
        setError(result.error.message)
        dispatch({ type: 'save-error', error: result.error })
        return
      }

      dispatch({
        type: 'save-success',
        hiringRequestId: result.data.hiringRequest.id,
        savedHiringRequestId: result.data.hiringRequest.id,
      })

      bus.publish({
        type: 'HiringRequestCreated',
        payload: {
          hiringRequest: result.data.hiringRequest,
          jobDescription: result.data.jobDescription,
          activity: result.data.activity,
          aiTask: result.data.aiTask,
        },
      })
      bus.publish({ type: 'ActivityRecorded', payload: { activity: result.data.activity } })
      if (result.data.aiTask) {
        bus.publish({ type: 'AITaskCompleted', payload: { aiTask: result.data.aiTask } })
      }
    })()

    return () => {
      cancelled = true
    }
    // We intentionally only react to phase + draft identity — re-renders
    // caused by other state slices must not re-run the save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, draft, state.aiTaskId])

  // The review screen dispatches save-start with an intent via this helper.
  function beginSave(intent: 'draft' | 'create') {
    saveIntentRef.current = intent
    dispatch({ type: 'save-start' })
  }

  // ---- Renders ------------------------------------------------------------

  if (phase === 'review' || phase === 'saving' || phase === 'saved' || phase === 'error') {
    return (
      <div
        className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8 md:p-12"
        role="region"
        aria-label="Hiring request review"
      >
        <ReviewScreen onSaveDraft={() => beginSave('draft')} onCreate={() => beginSave('create')} />
        {phase === 'saved' && state.lastSavedHiringRequestId && (
          <SavedBanner
            hiringRequestTitle={state.prompt}
            hiringRequestId={state.savedHiringRequestId}
          />
        )}
        {phase === 'error' && error && (
          <ErrorBanner
            message={error}
            onRetry={() => {
              saveIntentRef.current = null
              dispatch({ type: 'reset' })
            }}
          />
        )}
        {/* ARIA live region for screen readers — announces phase changes. */}
        <p className="sr-only" aria-live="polite">
          {phase === 'saving' && 'Saving hiring request, please wait.'}
          {phase === 'saved' && 'Hiring request saved.'}
          {phase === 'error' && (error ?? 'An error occurred.')}
        </p>
      </div>
    )
  }

  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-10 p-8 md:p-12"
      role="region"
      aria-label="AI Recruiter wizard"
    >
      <Greeting role={state.prompt ? extractRoleFromPrompt(state.prompt) : null} isWorking={phase === 'generating'} />

      <div className="space-y-4">
        <CommandInput
          value={state.prompt}
          onChange={v => dispatch({ type: 'set-prompt', prompt: v })}
          onSubmit={() => handleSubmit(state.prompt)}
          disabled={phase === 'generating'}
          isRunning={phase === 'generating'}
          ariaLabel="Describe the role you want to hire for"
        />

        <AnimatePresence>
          {phase === 'generating' && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              role="status"
              aria-live="polite"
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <SparklesIcon className="h-4 w-4 animate-pulse text-emerald-500" />
              <span>
                Calling the AI engine — usually takes 15–30 seconds. Hang tight.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ProgressTimeline
        steps={steps}
        stepStatuses={stepStatuses}
        activeStepIndex={activeStepIndex}
        visible={phase === 'generating' || workflowState === 'complete'}
      />

      {phase === 'idle' && (
        <SuggestedPrompts
          onSelect={p => {
            dispatch({ type: 'set-prompt', prompt: p })
            void handleSubmit(p)
          }}
        />
      )}

      {phase === 'idle' && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Or pick a popular role
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Popular role templates">
            {PROMPTS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  dispatch({ type: 'set-prompt', prompt: p })
                  void handleSubmit(p)
                }}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/30"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      <RecentTasksSection />
    </div>
  )
}

// -----------------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------------

function SavedBanner({
  hiringRequestTitle,
  hiringRequestId,
}: {
  hiringRequestTitle: string
  /** Real hiring-request id (set only on the create path). */
  hiringRequestId: string | null
}) {
  const addCandidatesHref = hiringRequestId
    ? `/hiring-requests/${hiringRequestId}/candidates`
    : null
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      role="status"
      aria-live="polite"
      className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-white">
          <CheckCircle2Icon className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-emerald-800 dark:text-emerald-200">
            {hiringRequestId ? 'Hiring request created' : 'Draft saved'}
          </p>
          <p className="mt-0.5 text-sm text-emerald-700/80 dark:text-emerald-300/80">
            {hiringRequestId
              ? `${hiringRequestTitle || 'The new role'} is now in the open pipeline. The dashboard, recent activity, and open-positions list have been updated automatically.`
              : `${hiringRequestTitle || 'The draft'} is saved. You can keep editing or come back later.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {addCandidatesHref && (
              <Link
                href={addCandidatesHref}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                <UserPlusIcon className="h-3.5 w-3.5" />
                Add Candidates
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </Link>
            )}
            <Link
              href={`/hiring-requests${hiringRequestId ? `/${hiringRequestId}` : ''}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200"
            >
              {hiringRequestId ? 'View Hiring Request' : 'View in Hiring Requests'}
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200"
            >
              <FileTextIcon className="h-3.5 w-3.5" />
              Go to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950/30"
    >
      <AlertCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold text-rose-800 dark:text-rose-200">
          The AI engine hit a snag
        </p>
        <p className="mt-0.5 text-sm text-rose-700/80 dark:text-rose-300/80">
          {message}
        </p>
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-rose-600/80 dark:text-rose-400/80">
          <ClockIcon className="h-3 w-3" aria-hidden />
          This is usually transient — try again in a moment.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCcwIcon className="h-3.5 w-3.5" aria-hidden />
        Try again
      </Button>
    </div>
  )
}

function RecentTasksSection() {
  const { state } = useWizard()
  if (state.phase !== 'idle') return null
  return <RecentTasks tasks={defaultRecentTasks()} />
}

function defaultRecentTasks() {
  return [
    { id: 'w-1', title: 'Senior Frontend Developer', status: 'complete' as const, timestamp: 'Just now', artifactCount: 6 },
    { id: 'w-2', title: 'DevOps Engineer', status: 'complete' as const, timestamp: 'Yesterday', artifactCount: 6 },
    { id: 'w-3', title: 'Product Manager — Growth', status: 'running' as const, timestamp: '3 days ago', artifactCount: 4 },
  ]
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function snapshotFromDraft(draft: JobDescriptionDraft) {
  return {
    id: 'pending',
    title: draft.title,
    summary: draft.summary,
    responsibilities: draft.responsibilities,
    requiredSkills: draft.requiredSkills,
    preferredSkills: draft.preferredSkills,
    qualifications: draft.qualifications,
    benefits: draft.benefits,
    screeningQuestions: draft.screeningQuestions,
    interviewQuestions: draft.interviewQuestions,
  }
}

// Type re-export so consumers don't reach into wizard-state.
export type { WizardState }
