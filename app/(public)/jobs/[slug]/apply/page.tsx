/**
 * Sprint 17.6 — Public job application form.
 *
 * NO AUTH REQUIRED. Any visitor to /jobs/[slug]/apply can submit.
 * The server action handles validation, rate limiting, candidate
 * creation, CV parsing, activity logging, and admin notification.
 *
 * The form is a client component (for file upload + dynamic UI),
 * but the page itself is a server component (for fast initial
 * render + OG metadata + job title prefill).
 */
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
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
      organization: {
        select: { name: true, website: true, logoUrl: true },
      },
      hiringRequests: {
        where: { status: { in: ['DRAFT', 'OPEN', 'ON_HOLD'] } },
        select: { id: true, status: true },
        take: 1,
      },
    },
  })
}

export default async function PublicApplyPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const job = await getPublicJob(slug)
  if (!job) notFound()
  if (!job.hiringRequests[0]) notFound()

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
