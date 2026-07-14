'use client'

/**
 * AI Recruiter wizard — the orchestrator.
 *
 * Owns the input phase, the "generating" phase (animated workflow), the
 * review phase, the save phase, and the friendly error/retry phase.
 *
 * On successful save it publishes `HiringRequestCreated` and
 * `ActivityRecorded` events to the global bus. The Dashboard and any
 * other subscriber react without a page reload.
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CalendarIcon,
  ClockIcon,
  FileTextIcon,
  RefreshCcwIcon,
  SparklesIcon,
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
} from '../actions'
import { useWizard, useDraft, usePhase, WizardProvider } from './wizard-state'
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
      <EventBridge>
        <WizardInner />
      </EventBridge>
    </WizardProvider>
  )
}

// -----------------------------------------------------------------------------
// Bridge: subscribes the wizard to bus events, and exposes the bus for save
// -----------------------------------------------------------------------------

function EventBridge({ children }: { children: React.ReactNode }) {
  // The EventBusProvider is at the root layout, so we just render children.
  return <>{children}</>
}

// -----------------------------------------------------------------------------
// Inner: the actual flow
// -----------------------------------------------------------------------------

function WizardInner() {
  const { state, dispatch } = useWizard()
  const [error, setError] = useState<string | null>(null)
  const [_, startTransition] = useTransition()
  const bus = useEventBus()
  const { workflowState, activeStepIndex, stepStatuses, steps, startWorkflow, resetWorkflow } = useAiWorkflow()

  const draft = useDraft()
  const phase = usePhase()

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

      // Give the workflow animation a moment to play even if the call
      // returns very fast (so users see what the engine is doing).
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

  async function handleSaveDraft() {
    if (!draft) return
    setError(null)
    dispatch({ type: 'save-start' })
    const result: ActionResult<SaveDraftSuccess> = await saveHiringRequestDraftAction({ draft })
    if (!result.ok) {
      setError(result.error.message)
      dispatch({ type: 'save-error', error: result.error })
      return
    }
    dispatch({ type: 'save-success', hiringRequestId: result.data.jobDescription.id })
  }

  async function handleCreate() {
    if (!draft) return
    setError(null)
    dispatch({ type: 'save-start' })
    const result: ActionResult<CreateHiringRequestSuccess> = await createHiringRequestAction({
      draft,
      aiTaskId: state.aiTaskId,
    })
    if (!result.ok) {
      setError(result.error.message)
      dispatch({ type: 'save-error', error: result.error })
      return
    }

    dispatch({ type: 'save-success', hiringRequestId: result.data.hiringRequest.id })

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
  }

  // ---- Renders ------------------------------------------------------------

  if (phase === 'review' || phase === 'saving' || phase === 'saved' || phase === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8 md:p-12">
        {phase !== 'error' && <SaveWatcher onSaveDraft={handleSaveDraft} onCreate={handleCreate} />}
        <ReviewScreen />
        {phase === 'saved' && (
          <SavedBanner hiringRequestTitle={state.prompt} />
        )}
        {phase === 'error' && error && (
          <ErrorBanner message={error} onRetry={() => dispatch({ type: 'reset' })} />
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 p-8 md:p-12">
      <Greeting role={state.prompt ? extractRoleFromPrompt(state.prompt) : null} isWorking={phase === 'generating'} />

      <div className="space-y-4">
        <CommandInput
          value={state.prompt}
          onChange={v => dispatch({ type: 'set-prompt', prompt: v })}
          onSubmit={() => handleSubmit(state.prompt)}
          disabled={phase === 'generating'}
          isRunning={phase === 'generating'}
        />

        <AnimatePresence>
          {phase === 'generating' && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
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
          <div className="flex flex-wrap gap-2">
            {PROMPTS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  dispatch({ type: 'set-prompt', prompt: p })
                  void handleSubmit(p)
                }}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/30"
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

function SaveWatcher({
  onSaveDraft,
  onCreate,
}: {
  onSaveDraft: () => Promise<void>
  onCreate: () => Promise<void>
}) {
  const { state } = useWizard()
  if (state.phase !== 'saving') return null
  return null
}

function SavedBanner({ hiringRequestTitle }: { hiringRequestTitle: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-white">
          <CalendarIcon className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-emerald-800 dark:text-emerald-200">
            Hiring request created
          </p>
          <p className="mt-0.5 text-sm text-emerald-700/80 dark:text-emerald-300/80">
            {hiringRequestTitle} is now in the open pipeline. The dashboard, recent activity, and open-positions list have been updated automatically.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/hiring-requests"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
            >
              View in Hiring Requests
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200"
            >
              <FileTextIcon className="h-3.5 w-3.5" />
              Open Dashboard
            </Link>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950/30">
      <AlertCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
      <div className="flex-1">
        <p className="font-semibold text-rose-800 dark:text-rose-200">
          The AI engine hit a snag
        </p>
        <p className="mt-0.5 text-sm text-rose-700/80 dark:text-rose-300/80">
          {message}
        </p>
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-rose-600/80 dark:text-rose-400/80">
          <ClockIcon className="h-3 w-3" />
          This is usually transient — try again in a moment.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCcwIcon className="h-3.5 w-3.5" />
        Try again
      </Button>
    </div>
  )
}

function RecentTasksSection() {
  // Use the existing RecentTasks component with the latest activity from bus.
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
