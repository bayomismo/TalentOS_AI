'use client'

import { use } from 'react'
import { WorkspaceView } from './_components/workspace-view'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function CandidateWorkspacePage({ params }: PageProps) {
  const { id } = use(params)
  return <WorkspaceView hiringRequestId={id} />
}
