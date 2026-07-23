import { notFound } from 'next/navigation'
import Link from 'next/link'
import { SparklesIcon, MapPinIcon, BriefcaseIcon, BuildingIcon, CheckCircle2Icon, ArrowLeftIcon } from 'lucide-react'
import { db } from '@/lib/db'

/**
 * Sprint 17 — Public job posting.
 *
 * Public, unauthenticated view of a job. Reachable via /jobs/[slug]
 * when the org has enabled public posting on a JobDescription.
 *
 * Layout: simple, ATS-style, no app chrome. Designed to be
 * shareable on LinkedIn / company careers site / email.
 *
 * Tenant isolation: scoped by publicSlug, not by orgId. The slug
 * is a long random string so it's not enumerable.
 */

export const metadata = {
  title: 'Job · TalentOS',
  description: 'Open position, view details and apply.',
}

const SKILL_LEVEL_LABELS: Record<string, string> = {
  JUNIOR: 'Junior',
  MID: 'Mid-level',
  SENIOR: 'Senior',
  STAFF: 'Staff',
  PRINCIPAL: 'Principal',
  LEAD: 'Lead',
  EXECUTIVE: 'Executive',
}

const JOB_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  INTERNSHIP: 'Internship',
  TEMPORARY: 'Temporary',
}

async function getPublicJob(slug: string) {
  return db.jobDescription.findFirst({
    where: { publicSlug: slug, publicEnabled: true },
    select: {
      id: true,
      title: true,
      level: true,
      jobType: true,
      summary: true,
      description: true,
      responsibilities: true,
      requiredSkills: true,
      niceToHave: true,
      perks: true,
      publicPostedAt: true,
      organization: {
        select: { name: true, website: true, logoUrl: true, industry: true, size: true, country: true },
      },
    },
  })
}

export default async function PublicJobPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const job = await getPublicJob(slug)
  if (!job) notFound()

  const o = job.organization

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Minimal top bar */}
      <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link
            href={`https://talentos-ai-lime.vercel.app`}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to TalentOS
          </Link>
          {o.logoUrl ? (
            <img src={o.logoUrl} alt={o.name} className="h-6 w-auto" />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
              <BuildingIcon className="h-4 w-4" />
              {o.name}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10 sm:py-16">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {job.publicPostedAt && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <SparklesIcon className="h-3 w-3" />
                Hiring
              </span>
            )}
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              {SKILL_LEVEL_LABELS[job.level] ?? job.level}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              {JOB_TYPE_LABELS[job.jobType] ?? job.jobType}
            </span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl dark:text-slate-50">
            {job.title}
          </h1>
          {job.summary && (
            <p className="mt-3 text-lg text-slate-600 dark:text-slate-300">
              {job.summary}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <BuildingIcon className="h-4 w-4" />
              {o.name}
            </span>
            {o.country && (
              <span className="inline-flex items-center gap-1.5">
                <MapPinIcon className="h-4 w-4" />
                {o.country}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <BriefcaseIcon className="h-4 w-4" />
              {JOB_TYPE_LABELS[job.jobType] ?? job.jobType}
            </span>
          </div>
        </div>

        {/* Description */}
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            About the role
          </h2>
          <div className="prose prose-slate dark:prose-invert max-w-none whitespace-pre-line text-slate-700 dark:text-slate-200">
            {job.description}
          </div>
        </section>

        {/* Responsibilities */}
        {job.responsibilities.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              What you&apos;ll do
            </h2>
            <ul className="space-y-2">
              {job.responsibilities.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-slate-700 dark:text-slate-200">
                  <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Required skills */}
        {job.requiredSkills.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              What we&apos;re looking for
            </h2>
            <div className="flex flex-wrap gap-2">
              {job.requiredSkills.map((s, i) => (
                <span
                  key={i}
                  className="rounded-md bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                >
                  {s}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Nice to have */}
        {job.niceToHave.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Nice to have
            </h2>
            <div className="flex flex-wrap gap-2">
              {job.niceToHave.map((s, i) => (
                <span
                  key={i}
                  className="rounded-md bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                >
                  {s}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Perks */}
        {job.perks.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Perks
            </h2>
            <ul className="space-y-1.5 text-slate-700 dark:text-slate-200">
              {job.perks.map((p, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* About company */}
        {(o.industry || o.size) && (
          <section className="mb-8 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              About {o.name}
            </h2>
            <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-300">
              {o.industry && <span><strong>Industry:</strong> {o.industry}</span>}
              {o.size && <span><strong>Size:</strong> {o.size}</span>}
              {o.country && <span><strong>Location:</strong> {o.country}</span>}
            </div>
            {o.website && (
              <a
                href={o.website}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-sm text-emerald-600 hover:underline"
              >
                Visit company website →
              </a>
            )}
          </section>
        )}

        {/* Apply CTA — stub for now */}
        <section className="sticky bottom-0 -mx-6 mt-10 border-t border-slate-200 bg-white/90 px-6 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90 sm:-mx-10 sm:rounded-xl sm:px-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-50">Interested in this role?</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Apply via the TalentOS workspace or reach out directly.</p>
            </div>
            <Link
              href={`https://talentos-ai-lime.vercel.app/login?callbackUrl=/candidates/new?jobTitle=${encodeURIComponent(job.title)}`}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-emerald-500 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
            >
              Apply on TalentOS
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <p>Powered by <a href="https://talentos-ai-lime.vercel.app" className="hover:underline">TalentOS</a></p>
      </footer>
    </div>
  )
}
