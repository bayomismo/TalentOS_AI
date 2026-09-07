'use client'

import { use } from 'react'
import { DecisionHubView } from './_components/decision-hub-view'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function DecisionHubPage({ params }: PageProps) {
  const { id } = use(params)
  return <DecisionHubView hiringRequestId={id} />
}
