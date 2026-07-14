'use client'

/**
 * Wizard state machine + context.
 *
 * Owns the four phases of the AI Hiring Request wizard:
 *   idle → generating → review → saving → saved | error
 *
 * The state, draft, and dispatch live in a React context. Child
 * components consume `useWizard()` to read state and dispatch transitions.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'

import type {
  EmploymentType,
  EvaluationCriterion,
  JobDescriptionDraft,
} from '@/lib/events/types'

// -----------------------------------------------------------------------------
// Phases
// -----------------------------------------------------------------------------

export type WizardPhase =
  | 'idle'
  | 'generating'
  | 'review'
  | 'saving'
  | 'saved'
  | 'error'

export interface WizardError {
  code: string
  message: string
  retryable: boolean
}

export interface WizardState {
  phase: WizardPhase
  prompt: string
  draft: JobDescriptionDraft | null
  error: WizardError | null
  aiTaskId: string | null
  lastSavedHiringRequestId: string | null
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null
  model: string | null
}

type WizardAction =
  | { type: 'set-prompt'; prompt: string }
  | { type: 'set-employment'; employmentType: EmploymentType }
  | { type: 'set-experience'; experience: string }
  | { type: 'set-location'; location: string }
  | { type: 'set-department'; department: string }
  | { type: 'generate-start' }
  | { type: 'generate-success'; draft: JobDescriptionDraft; aiTaskId: string; usage: WizardState['usage']; model: string }
  | { type: 'generate-error'; error: WizardError }
  | { type: 'patch-draft'; patch: Partial<JobDescriptionDraft> }
  | { type: 'patch-meta'; patch: Partial<JobDescriptionDraft['meta']> }
  | { type: 'patch-list'; field: keyof JobDescriptionDraft; index: number; value: string }
  | { type: 'add-list-item'; field: keyof JobDescriptionDraft; value: string }
  | { type: 'remove-list-item'; field: keyof JobDescriptionDraft; index: number }
  | { type: 'patch-criterion'; id: string; patch: Partial<EvaluationCriterion> }
  | { type: 'remove-criterion'; id: string }
  | { type: 'add-criterion' }
  | { type: 'save-start' }
  | { type: 'save-success'; hiringRequestId: string }
  | { type: 'save-error'; error: WizardError }
  | { type: 'reset' }

const initialState: WizardState = {
  phase: 'idle',
  prompt: '',
  draft: null,
  error: null,
  aiTaskId: null,
  lastSavedHiringRequestId: null,
  usage: null,
  model: null,
}

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'set-prompt':
      return { ...state, prompt: action.prompt, phase: 'idle', error: null }

    case 'set-employment':
      if (!state.draft) return state
      return {
        ...state,
        draft: { ...state.draft, meta: { ...state.draft.meta, employmentType: action.employmentType } },
      }

    case 'set-experience':
      if (!state.draft) return state
      return {
        ...state,
        draft: { ...state.draft, meta: { ...state.draft.meta, experience: action.experience } },
      }

    case 'set-location':
      if (!state.draft) return state
      return {
        ...state,
        draft: { ...state.draft, meta: { ...state.draft.meta, location: action.location } },
      }

    case 'set-department':
      if (!state.draft) return state
      return {
        ...state,
        draft: { ...state.draft, meta: { ...state.draft.meta, department: action.department } },
      }

    case 'generate-start':
      return {
        ...state,
        phase: 'generating',
        error: null,
        draft: null,
        aiTaskId: null,
        usage: null,
        model: null,
      }

    case 'generate-success':
      return {
        ...state,
        phase: 'review',
        draft: action.draft,
        aiTaskId: action.aiTaskId,
        usage: action.usage,
        model: action.model,
        error: null,
      }

    case 'generate-error':
      return {
        ...state,
        phase: 'error',
        error: action.error,
        draft: null,
      }

    case 'patch-draft':
      if (!state.draft) return state
      return { ...state, draft: { ...state.draft, ...action.patch } }

    case 'patch-meta':
      if (!state.draft) return state
      return {
        ...state,
        draft: { ...state.draft, meta: { ...state.draft.meta, ...action.patch } },
      }

    case 'patch-list': {
      if (!state.draft) return state
      const list = state.draft[action.field] as unknown as string[]
      if (!Array.isArray(list)) return state
      const next = list.slice()
      next[action.index] = action.value
      return { ...state, draft: { ...state.draft, [action.field]: next } }
    }

    case 'add-list-item': {
      if (!state.draft) return state
      const list = (state.draft[action.field] as unknown as string[]) ?? []
      const next = [...list, action.value].filter(v => v.trim().length > 0)
      return { ...state, draft: { ...state.draft, [action.field]: next } }
    }

    case 'remove-list-item': {
      if (!state.draft) return state
      const list = state.draft[action.field] as unknown as string[]
      if (!Array.isArray(list)) return state
      const next = list.slice()
      next.splice(action.index, 1)
      return { ...state, draft: { ...state.draft, [action.field]: next } }
    }

    case 'patch-criterion': {
      if (!state.draft) return state
      return {
        ...state,
        draft: {
          ...state.draft,
          evaluationCriteria: state.draft.evaluationCriteria.map(c =>
            c.id === action.id ? { ...c, ...action.patch } : c
          ),
        },
      }
    }

    case 'remove-criterion': {
      if (!state.draft) return state
      return {
        ...state,
        draft: {
          ...state.draft,
          evaluationCriteria: state.draft.evaluationCriteria.filter(c => c.id !== action.id),
        },
      }
    }

    case 'add-criterion': {
      if (!state.draft) return state
      return {
        ...state,
        draft: {
          ...state.draft,
          evaluationCriteria: [
            ...state.draft.evaluationCriteria,
            {
              id: `crit-${Date.now()}`,
              category: 'New criterion',
              weight: 10,
              indicators: [],
            },
          ],
        },
      }
    }

    case 'save-start':
      return { ...state, phase: 'saving', error: null }

    case 'save-success':
      return {
        ...state,
        phase: 'saved',
        lastSavedHiringRequestId: action.hiringRequestId,
      }

    case 'save-error':
      return { ...state, phase: 'error', error: action.error }

    case 'reset':
      return { ...initialState }

    default:
      return state
  }
}

// -----------------------------------------------------------------------------
// Context
// -----------------------------------------------------------------------------

interface WizardContextValue {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}

const WizardContext = createContext<WizardContextValue | null>(null)

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const value = useMemo(() => ({ state, dispatch }), [state])
  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext)
  if (!ctx) {
    throw new Error('useWizard must be used inside <WizardProvider>')
  }
  return ctx
}

// -----------------------------------------------------------------------------
// Selector hooks
// -----------------------------------------------------------------------------

export function useDraft(): JobDescriptionDraft | null {
  return useWizard().state.draft
}

export function usePhase(): WizardPhase {
  return useWizard().state.phase
}

export function usePrompt(): string {
  return useWizard().state.prompt
}

export function useDispatchDraft() {
  const { dispatch } = useWizard()

  const patch = useCallback((patch: Partial<JobDescriptionDraft>) => {
    dispatch({ type: 'patch-draft', patch })
  }, [dispatch])

  const patchMeta = useCallback((patch: Partial<JobDescriptionDraft['meta']>) => {
    dispatch({ type: 'patch-meta', patch })
  }, [dispatch])

  const patchList = useCallback(
    (field: keyof JobDescriptionDraft, index: number, value: string) => {
      dispatch({ type: 'patch-list', field, index, value })
    },
    [dispatch]
  )

  const addListItem = useCallback(
    (field: keyof JobDescriptionDraft, value: string) => {
      dispatch({ type: 'add-list-item', field, value })
    },
    [dispatch]
  )

  const removeListItem = useCallback(
    (field: keyof JobDescriptionDraft, index: number) => {
      dispatch({ type: 'remove-list-item', field, index })
    },
    [dispatch]
  )

  const patchCriterion = useCallback(
    (id: string, patch: Partial<EvaluationCriterion>) => {
      dispatch({ type: 'patch-criterion', id, patch })
    },
    [dispatch]
  )

  const removeCriterion = useCallback((id: string) => {
    dispatch({ type: 'remove-criterion', id })
  }, [dispatch])

  const addCriterion = useCallback(() => {
    dispatch({ type: 'add-criterion' })
  }, [dispatch])

  return { patch, patchMeta, patchList, addListItem, removeListItem, patchCriterion, removeCriterion, addCriterion }
}
