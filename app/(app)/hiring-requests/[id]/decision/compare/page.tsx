'use client'

import { use, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ComparisonView } from './_components/comparison-view'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function ComparePage({ params }: PageProps) {
  const { id } = use(params)
  const router = useRouter()
  const sp = useSearchParams()
  const ids = sp.get('ids')?.split(',').filter(Boolean) ?? []

  useEffect(() => {
    if (ids.length < 2 || ids.length > 4) {
      router.replace(`/hiring-requests/${id}/decision`)
    }
  }, [id, ids.length, router])

  if (ids.length < 2 || ids.length > 4) return null

  return <ComparisonView hiringRequestId={id} candidateIds={ids} />
}
