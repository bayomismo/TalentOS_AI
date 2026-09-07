'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { WORKFLOW_STEPS } from '../data/workflow-steps'
import type { StepStatus, WorkflowState } from '../types'

export function useAiWorkflow() {
  const [workflowState, setWorkflowState] = useState<WorkflowState>('idle')
  const [activeStepIndex, setActiveStepIndex] = useState(-1)
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(
    WORKFLOW_STEPS.map(() => 'pending')
  )
  const [completedArtifacts, setCompletedArtifacts] = useState<string[]>([])
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearWorkflowTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const resetWorkflow = useCallback(() => {
    clearWorkflowTimeout()
    setWorkflowState('idle')
    setActiveStepIndex(-1)
    setStepStatuses(WORKFLOW_STEPS.map(() => 'pending'))
    setCompletedArtifacts([])
  }, [clearWorkflowTimeout])

  const startWorkflow = useCallback(() => {
    clearWorkflowTimeout()
    setWorkflowState('running')
    setActiveStepIndex(0)
    setStepStatuses(WORKFLOW_STEPS.map((_, i) => (i === 0 ? 'active' : 'pending')))
    setCompletedArtifacts([])
  }, [clearWorkflowTimeout])

  useEffect(() => {
    if (workflowState !== 'running' || activeStepIndex < 0) return

    const currentStep = WORKFLOW_STEPS[activeStepIndex]
    if (!currentStep) return

    timeoutRef.current = setTimeout(() => {
      setStepStatuses(prev => {
        const next = [...prev]
        next[activeStepIndex] = 'complete'
        return next
      })

      setCompletedArtifacts(prev => [...prev, currentStep.id])

      const nextIndex = activeStepIndex + 1
      if (nextIndex < WORKFLOW_STEPS.length) {
        setActiveStepIndex(nextIndex)
        setStepStatuses(prev => {
          const next = [...prev]
          next[nextIndex] = 'active'
          return next
        })
      } else {
        setWorkflowState('complete')
        setActiveStepIndex(-1)
      }
    }, currentStep.durationMs)

    return clearWorkflowTimeout
  }, [workflowState, activeStepIndex, clearWorkflowTimeout])

  useEffect(() => {
    return clearWorkflowTimeout
  }, [clearWorkflowTimeout])

  const progress =
    workflowState === 'complete'
      ? 100
      : activeStepIndex >= 0
        ? Math.round(
            ((stepStatuses.filter(s => s === 'complete').length +
              (stepStatuses[activeStepIndex] === 'active' ? 0.5 : 0)) /
              WORKFLOW_STEPS.length) *
              100
          )
        : 0

  return {
    workflowState,
    activeStepIndex,
    stepStatuses,
    completedArtifacts,
    progress,
    steps: WORKFLOW_STEPS,
    startWorkflow,
    resetWorkflow,
  }
}
