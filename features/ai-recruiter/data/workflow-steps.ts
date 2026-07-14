import type { WorkflowStep } from '../types'

export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    id: 'understand',
    label: 'Understanding hiring request',
    description: 'Parsing role requirements, seniority, and team context',
    durationMs: 1800,
  },
  {
    id: 'job-description',
    label: 'Generating Job Description',
    description: 'Crafting a compelling, inclusive job posting',
    durationMs: 2200,
  },
  {
    id: 'skills-matrix',
    label: 'Creating Skills Matrix',
    description: 'Mapping required and preferred competencies',
    durationMs: 2000,
  },
  {
    id: 'screening-questions',
    label: 'Generating Screening Questions',
    description: 'Building recruiter phone screen questions',
    durationMs: 1900,
  },
  {
    id: 'interview-questions',
    label: 'Creating Interview Questions',
    description: 'Designing structured interview rounds',
    durationMs: 2100,
  },
  {
    id: 'hiring-package',
    label: 'Preparing Hiring Package',
    description: 'Assembling scorecard and final deliverables',
    durationMs: 2400,
  },
]
