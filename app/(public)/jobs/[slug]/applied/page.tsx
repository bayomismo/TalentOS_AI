/**
 * Sprint 17.6 — Post-application thanks page.
 *
 * Shown after a candidate successfully submits an application. Public.
 * Soft-pitches "track future applications" via a free TalentOS sign-up.
 */
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2Icon, SparklesIcon, MailIcon } from 'lucide-react'
import { db } from '@/lib/db'

export const metadata = {
  title: 'Application submitted · TalentOS',
  description: 'Your application has been received.',
  robots: { index: false, follow: false },
}

async function getJob(slug: string) {
  return db.jobDescription.findFirst({
    where: { publicSlug: slug, publicEnabled: true },
    select: {
      title: true,
      organization: { select: { name: true } },
    },
  })
}

export default async function AppliedPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const job = await getJob(slug)
  if (!job) notFound()

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 py-10 text-center">
        {/* Success icon */}
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/60">
          <CheckCircle2Icon className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
        </div>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
          You're all set!
        </h1>

        <p className="mt-4 text-base leading-relaxed text-slate-600 dark:text-slate-300">
          Your application for{' '}
          <strong className="font-semibold text-slate-900 dark:text-slate-100">
            {job.title}
          </strong>{' '}
          at <strong className="font-semibold text-slate-900 dark:text-slate-100">{job.organization.name}</strong>{' '}
          has been received.
        </p>

        {/* What happens next */}
        <div className="mt-8 w-full rounded-xl border border-slate-200 bg-white p-6 text-left dark:border-slate-700 dark:bg-slate-800">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            What happens next
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
            <li className="flex items-start gap-2">
              <MailIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                <strong>{job.organization.name}</strong> will review your application and reach out by email.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                If your profile matches what they're looking for, they'll schedule an interview.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                No further action needed from you — sit tight.
              </span>
            </li>
          </ul>
        </div>

        {/* Footer actions */}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href={`/jobs/${slug}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            ← Back to job
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
          >
            Create a TalentOS account
          </Link>
        </div>

        <p className="mt-10 text-xs text-slate-500 dark:text-slate-400">
          Powered by{' '}
          <a href="https://talentos-ai-lime.vercel.app" className="hover:underline">
            TalentOS
          </a>
        </p>
      </main>
    </div>
  )
}
