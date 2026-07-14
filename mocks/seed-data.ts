import type { Activity, Candidate, Metric, Position } from '@/types'

const positions: Position[] = [
  {
    id: 'pos-001',
    title: 'Senior Software Engineer',
    department: 'Engineering',
    openings: 3,
    candidates: 24,
    status: 'active',
    createdAt: new Date('2024-05-15'),
  },
  {
    id: 'pos-002',
    title: 'Product Manager',
    department: 'Product',
    openings: 1,
    candidates: 18,
    status: 'active',
    createdAt: new Date('2024-06-01'),
  },
  {
    id: 'pos-003',
    title: 'UX/UI Designer',
    department: 'Design',
    openings: 2,
    candidates: 12,
    status: 'active',
    createdAt: new Date('2024-06-10'),
  },
  {
    id: 'pos-004',
    title: 'Data Scientist',
    department: 'Data',
    openings: 2,
    candidates: 15,
    status: 'active',
    createdAt: new Date('2024-06-15'),
  },
]

const candidates: Candidate[] = [
  {
    id: 'cand-001',
    name: 'Sarah Chen',
    email: 'sarah.chen@email.com',
    position: 'Senior Software Engineer',
    stage: 'interview',
    rating: 5,
    appliedAt: new Date('2024-07-01'),
    avatar: '👩‍💼',
  },
  {
    id: 'cand-002',
    name: 'Marcus Johnson',
    email: 'marcus.j@email.com',
    position: 'Senior Software Engineer',
    stage: 'offer',
    rating: 4,
    appliedAt: new Date('2024-07-03'),
    avatar: '👨‍💼',
  },
  {
    id: 'cand-003',
    name: 'Elena Rodriguez',
    email: 'elena.r@email.com',
    position: 'Product Manager',
    stage: 'screening',
    rating: 4,
    appliedAt: new Date('2024-07-05'),
    avatar: '👩‍💼',
  },
  {
    id: 'cand-004',
    name: 'James Williams',
    email: 'james.w@email.com',
    position: 'Senior Software Engineer',
    stage: 'applied',
    rating: 3,
    appliedAt: new Date('2024-07-08'),
    avatar: '👨‍💼',
  },
  {
    id: 'cand-005',
    name: 'Priya Patel',
    email: 'priya.p@email.com',
    position: 'UX/UI Designer',
    stage: 'interview',
    rating: 5,
    appliedAt: new Date('2024-07-02'),
    avatar: '👩‍💼',
  },
  {
    id: 'cand-006',
    name: 'David Kim',
    email: 'david.k@email.com',
    position: 'Data Scientist',
    stage: 'hired',
    rating: 5,
    appliedAt: new Date('2024-06-20'),
    avatar: '👨‍💼',
  },
  {
    id: 'cand-007',
    name: 'Lisa Anderson',
    email: 'lisa.a@email.com',
    position: 'UX/UI Designer',
    stage: 'applied',
    rating: 4,
    appliedAt: new Date('2024-07-10'),
    avatar: '👩‍💼',
  },
  {
    id: 'cand-008',
    name: 'Alex Turner',
    email: 'alex.t@email.com',
    position: 'Senior Software Engineer',
    stage: 'screening',
    rating: 4,
    appliedAt: new Date('2024-07-09'),
    avatar: '👨‍💼',
  },
]

const activities: Activity[] = [
  {
    id: 'act-001',
    type: 'hired',
    candidateName: 'David Kim',
    positionTitle: 'Data Scientist',
    timestamp: new Date('2024-07-14T14:30:00'),
    details: 'Offer accepted',
  },
  {
    id: 'act-002',
    type: 'offer',
    candidateName: 'Marcus Johnson',
    positionTitle: 'Senior Software Engineer',
    timestamp: new Date('2024-07-13T10:15:00'),
    details: 'Offer extended',
  },
  {
    id: 'act-003',
    type: 'interview',
    candidateName: 'Priya Patel',
    positionTitle: 'UX/UI Designer',
    timestamp: new Date('2024-07-12T16:45:00'),
    details: 'Final round interview completed',
  },
  {
    id: 'act-004',
    type: 'application',
    candidateName: 'Alex Turner',
    positionTitle: 'Senior Software Engineer',
    timestamp: new Date('2024-07-09T09:20:00'),
    details: 'New application received',
  },
  {
    id: 'act-005',
    type: 'moved',
    candidateName: 'Elena Rodriguez',
    positionTitle: 'Product Manager',
    timestamp: new Date('2024-07-08T13:00:00'),
    details: 'Moved to screening stage',
  },
]

const metrics: Metric[] = [
  {
    label: 'Open Positions',
    value: 8,
    change: 2,
    trend: 'up',
  },
  {
    label: 'Active Candidates',
    value: 97,
    change: 12,
    trend: 'up',
  },
  {
    label: 'Avg. Time to Hire',
    value: '23 days',
    change: -3,
    trend: 'down',
  },
  {
    label: 'Offer Conversion',
    value: '64%',
    change: 5,
    trend: 'up',
  },
  {
    label: 'Pipeline Health',
    value: '92%',
    change: 3,
    trend: 'up',
  },
  {
    label: 'Candidates Hired (YTD)',
    value: 18,
    change: 4,
    trend: 'up',
  },
]

export const data = {
  positions,
  candidates,
  activities,
  metrics,
}

export function getCandidatesByStage() {
  return {
    applied: candidates.filter(c => c.stage === 'applied'),
    screening: candidates.filter(c => c.stage === 'screening'),
    interview: candidates.filter(c => c.stage === 'interview'),
    offer: candidates.filter(c => c.stage === 'offer'),
    hired: candidates.filter(c => c.stage === 'hired'),
  }
}

export function getMetrics(): Metric[] {
  return metrics
}

export function getActivities(): Activity[] {
  return activities
}

export function getPositions(): Position[] {
  return positions
}

export function getCandidates(): Candidate[] {
  return candidates
}
