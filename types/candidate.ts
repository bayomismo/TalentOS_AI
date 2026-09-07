export type Candidate = {
  id: string
  name: string
  email: string
  position: string
  stage: 'applied' | 'screening' | 'interview' | 'offer' | 'hired'
  rating: number
  appliedAt: Date
  avatar: string
}
