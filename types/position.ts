export type Position = {
  id: string
  title: string
  department: string
  openings: number
  candidates: number
  status: 'active' | 'closed'
  createdAt: Date
}
