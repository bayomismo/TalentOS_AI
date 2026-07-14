import { PagePlaceholder } from '@/components/layout/page-placeholder'

interface CandidateProfilePageProps {
  params: Promise<{ id: string }>
}

export default async function CandidateProfilePage({
  params,
}: CandidateProfilePageProps) {
  const { id } = await params

  return <PagePlaceholder title={`Candidate Profile — ${id}`} />
}
