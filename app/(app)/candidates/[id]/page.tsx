'use client'

import { use } from 'react'
import { CandidateProfileView } from './_components/candidate-profile-view'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function CandidateProfilePage({ params }: PageProps) {
  const { id } = use(params)
  return <CandidateProfileView id={id} />
}
