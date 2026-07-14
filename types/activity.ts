export type Activity = {
  id: string
  type: 'application' | 'moved' | 'interview' | 'offer' | 'hired'
  candidateName: string
  positionTitle: string
  timestamp: Date
  details?: string
}
