export type Position = {
  id: string
  title: string
  department: string
  openings: number
  filled: number
  /** Total candidates on this HR (any stage, any analysis state). */
  candidates: number
  /** Candidates that have an AI match score. */
  analyzed?: number
  /** Candidates in SCREENING / INTERVIEW / OFFER / HIRED. */
  shortlisted?: number
  status: 'active' | 'closed'
  createdAt: Date
}
