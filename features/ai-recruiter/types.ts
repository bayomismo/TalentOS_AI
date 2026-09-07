export type WorkflowStepId =
  | 'understand'
  | 'job-description'
  | 'skills-matrix'
  | 'screening-questions'
  | 'interview-questions'
  | 'hiring-package'

export type StepStatus = 'pending' | 'active' | 'complete'

export type WorkflowStep = {
  id: WorkflowStepId
  label: string
  description: string
  durationMs: number
}

export type WorkflowState = 'idle' | 'running' | 'complete'

export type RecentTask = {
  id: string
  title: string
  status: 'complete' | 'running' | 'draft'
  timestamp: string
  artifactCount: number
}

export type ScorecardCriterion = {
  category: string
  weight: number
  indicators: string[]
}

export type HiringPackage = {
  role: string
  department: string
  level: string
  jobDescription: string
  responsibilities: string[]
  requiredSkills: string[]
  niceToHave: string[]
  screeningQuestions: string[]
  interviewQuestions: {
    category: string
    questions: string[]
  }[]
  scorecard: ScorecardCriterion[]
}
