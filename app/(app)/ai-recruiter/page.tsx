'use client'

import { useState } from 'react'
import { CommandInput } from '@/features/ai-recruiter/components/command-input'
import { Greeting } from '@/features/ai-recruiter/components/greeting'
import { ProgressTimeline } from '@/features/ai-recruiter/components/progress-timeline'
import { RecentTasks } from '@/features/ai-recruiter/components/recent-tasks'
import { SuggestedPrompts } from '@/features/ai-recruiter/components/suggested-prompts'
import { useAiWorkflow } from '@/features/ai-recruiter/hooks/use-ai-workflow'
import { extractRoleFromPrompt } from '@/features/ai-recruiter/data/mock-hiring-package'
import { RECENT_TASKS } from '@/features/ai-recruiter/data/mock-recent-tasks'

export default function AiRecruiterPage() {
  const [prompt, setPrompt] = useState('')
  const {
    workflowState,
    activeStepIndex,
    stepStatuses,
    steps,
    startWorkflow,
    resetWorkflow,
  } = useAiWorkflow()

  const role = prompt ? extractRoleFromPrompt(prompt) : null
  const isWorking = workflowState === 'running'

  function handleSubmit() {
    if (!prompt.trim() || isWorking) return
    startWorkflow()
  }

  function handleReset() {
    setPrompt('')
    resetWorkflow()
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 p-8 md:p-12">
      <Greeting role={role} isWorking={isWorking} />

      <div className="space-y-4">
        <CommandInput
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleSubmit}
          disabled={workflowState === 'complete'}
          isRunning={isWorking}
        />

        {workflowState === 'complete' && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
            <span>
              Hiring package for{' '}
              <span className="font-semibold">{role}</span> is ready to review.
            </span>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md px-2 py-1 text-xs font-medium underline-offset-2 hover:underline"
            >
              Start a new package
            </button>
          </div>
        )}
      </div>

      <ProgressTimeline
        steps={steps}
        stepStatuses={stepStatuses}
        activeStepIndex={activeStepIndex}
        visible={isWorking || workflowState === 'complete'}
      />

      {!isWorking && workflowState !== 'complete' && (
        <SuggestedPrompts
          onSelect={p => setPrompt(p)}
          disabled={isWorking}
        />
      )}

      <RecentTasks tasks={RECENT_TASKS} />
    </div>
  )
}
