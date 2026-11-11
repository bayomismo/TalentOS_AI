/**
 * Sprint 17.6 / Sprint 19 — Public job application form.
 *
 * NO AUTH REQUIRED. Any visitor to /jobs/[slug]/apply can submit.
 * The server action handles validation, rate limiting, candidate
 * creation, CV parsing, activity logging, and hiring-team notification.
 *
 * The form is a client component (for file upload + dynamic UI),
 * but the page itself is a server component (for fast initial
 * render + OG metadata + job title prefill).
 *
 * Sprint 19 (audit P1-11 / P2-09 / P2-31): the requisition behind the
 * posting is resolved through `JobDescription.publicHiringRequestId` —
 * ONE deterministic requisition per posting — instead of an unordered
 * `take: 1`. A posting whose requisition is closed, filled, paused or
 * still a draft no longer renders a dead apply form; it says the role
 * is not accepting applications.
 */
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { resolvePublicRequisition, isAcceptingPublicState } from '@/app/(public)/_lib/public-requisition'
import { publicConsentText } from '@/app/(public)/_lib/consent'
import { PublicApplyForm } from './_components/public-apply-form'

export const metadata = {
  title: 'Apply · TalentOS',
  description: 'Submit your application for this position.',
  robots: { index: false, follow: false },
}

async function getPublicJob(slug: string) {
  return db.jobDescription.findFirst({
    where: { publicSlug: slug, publicEnabled: true },
    select: {
      id: true,
      title: true,
      level: true,
      jobType: true,
      publicPostedAt: true,
      publicHiringRequestId: true,
      organizationId: true,
      organization: {
        select: { name: true, website: true, logoUrl: true },
      },
    },
  })
}

/** The message shown when the role is not accepting applications. */
function closedCopy(state: string): { title: string; body: string } {
  switch (state) {
    case 'DRAFT':
      return {
        title: 'This position is not open yet',
        body: 'The posting exists, but the role has not been opened for applications. Please check back later.',
      }
    case 'ON_HOLD':
      return {
        title: 'This position is on hold',
        body: 'The hiring team has paused this role. Applications are not being accepted right now — please check back later.',
      }
    case 'MISSING':
      return {
        title: 'This position is not accepting applications',
        body: 'No open requisition is attached to this posting.',
      }
    default:
      return {
        title: 'This position is closed',
        body: 'The hiring team has filled this role, so applications are no longer being accepted.',
      }
  }
}

export default async function PublicApplyPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const job = await getPublicJob(slug)
  if (!job) notFound()

  const resolution = await resolvePublicRequisition({
    id: job.id,
    organizationId: job.organizationId,
    publicHiringRequestId: job.publicHiringRequestId,
  })

  if (!isAcceptingPublicState(resolution.state)) {
    const copy = closedCopy(resolution.state)
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
            <Link
              href={`/jobs/${slug}`}
              className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              ← Back to job
            </Link>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {job.organization.name}
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-2xl px-6 py-16 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {copy.title}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{copy.body}</p>
          <Link
            href={`/jobs/${slug}`}
            className="mt-8 inline-flex h-10 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            ← Back to the job description
          </Link>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Minimal top bar (matches the public job page) */}
      <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <a
            href={`/jobs/${slug}`}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            ← Back to job
          </a>
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {job.organization.name}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 sm:py-16">
        {/* Title */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
            Apply for {job.title}
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {job.organization.name} · Takes about 2 minutes
          </p>
        </div>

        <PublicApplyForm
          jobSlug={slug}
          jobTitle={job.title}
          organizationName={job.organization.name}
          consentText={publicConsentText(job.organization.name)}
        />

        <p className="mt-8 text-center text-xs text-slate-500 dark:text-slate-400">
          Your information is shared only with {job.organization.name} and stored securely in TalentOS.
          <br />
          <a href={`/jobs/${slug}`} className="text-emerald-600 hover:underline">
            ← Back to job description
          </a>
        </p>
      </main>
    </div>
  )
}
