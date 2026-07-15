'use client'

/**
 * Candidate detail view — client component, data from Prisma.
 */

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import {
  ArrowLeftIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  FileTextIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  StarIcon,
} from 'lucide-react'

import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/features/shared/components/status-badge'
import { getCandidateDetailAction, type CandidateDetail } from '../actions'
import { cn } from '@/lib/utils'

const STAGE_ORDER = ['applied', 'screening', 'interview', 'offer', 'hired'] as const

export function CandidateProfileView({ id }: { id: string }) {
  const [candidate, setCandidate] = useState<CandidateDetail | null | undefined>(undefined)
  const [, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      try {
        const result = await getCandidateDetailAction(id)
        setCandidate(result)
      } catch (err) {
        console.error('[candidate-profile] failed to load candidate', err)
        setCandidate(null)
      }
    })
  }, [id])

  if (candidate === undefined) {
    return (
      <div className="space-y-8 p-8">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800" />
      </div>
    )
  }

  if (candidate === null) {
    return (
      <div className="space-y-8 p-8">
        <Link
          href="/candidates"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-slate-400 dark:hover:text-slate-50"
        >
          <ArrowLeftIcon className="h-4 w-4" aria-hidden />
          Back to candidates
        </Link>
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-base font-semibold text-slate-900 dark:text-slate-50">
              Candidate not found
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              The candidate you&apos;re looking for doesn&apos;t exist or has been removed.
            </p>
            <Button className="mt-5">
              <Link href="/candidates">View all candidates</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const stageIndex = STAGE_ORDER.indexOf(candidate.stage as (typeof STAGE_ORDER)[number])
  const safeStageIndex = stageIndex === -1 ? 0 : stageIndex

  return (
    <div className="space-y-8 p-8">
      <Link
        href="/candidates"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-slate-400 dark:hover:text-slate-50"
      >
        <ArrowLeftIcon className="h-4 w-4" aria-hidden />
        Back to candidates
      </Link>

      <PageHeader
        title={candidate.name}
        description={`${candidate.position} · ${candidate.email}`}
        badge={<StatusBadge stage={candidate.stage} />}
        actions={
          <>
            <Button variant="outline">
              <MailIcon className="h-4 w-4" aria-hidden />
              Message
            </Button>
            <Button variant="outline">
              <CalendarIcon className="h-4 w-4" aria-hidden />
              Schedule interview
            </Button>
            <Button>Move to next stage</Button>
          </>
        }
        meta={
          <>
            <MetaItem icon={StarIcon}>
              <span
                className="text-amber-500"
                role="img"
                aria-label={`${candidate.rating} out of 5 stars`}
              >
                {Array.from({ length: 5 }).map((_, i) => (
                  <StarIcon
                    key={i}
                    aria-hidden
                    className={cn(
                      'inline h-3.5 w-3.5',
                      i < candidate.rating ? 'fill-current' : 'opacity-30'
                    )}
                  />
                ))}
              </span>
              <span className="ml-1 text-slate-600 dark:text-slate-300">
                {candidate.rating}/5
              </span>
            </MetaItem>
            <MetaItem icon={ClockIcon}>
              Applied {new Date(candidate.appliedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </MetaItem>
            {candidate.location && <MetaItem icon={MapPinIcon}>{candidate.location}</MetaItem>}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Pipeline progress</CardTitle>
              <CardDescription>
                Where {candidate.name.split(' ')[0]} is in the hiring funnel.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="grid grid-cols-1 gap-2 md:grid-cols-5">
                {STAGE_ORDER.map((stage, idx) => {
                  const reached = idx <= safeStageIndex
                  const current = idx === safeStageIndex
                  return (
                    <li
                      key={stage}
                      className={cn(
                        'flex flex-col items-start gap-1.5 rounded-lg border px-3 py-3 transition-colors',
                        current
                          ? 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/30'
                          : reached
                            ? 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
                            : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                            current
                              ? 'bg-emerald-500 text-white'
                              : reached
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                          )}
                        >
                          {reached ? <CheckCircle2Icon className="h-3 w-3" /> : idx + 1}
                        </span>
                        <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {idx + 1}
                        </span>
                      </div>
                      <p
                        className={cn(
                          'text-sm font-semibold capitalize',
                          current
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-slate-700 dark:text-slate-200'
                        )}
                      >
                        {stage}
                      </p>
                      {current && (
                        <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                          Current
                        </span>
                      )}
                    </li>
                  )
                })}
              </ol>
            </CardContent>
          </Card>

          {candidate.jobDescriptionSummary && (
            <Card>
              <CardHeader>
                <CardTitle>Role context</CardTitle>
                <CardDescription>The job this candidate applied for.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {candidate.jobDescriptionSummary}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ContactRow icon={MailIcon} label="Email" value={candidate.email} />
              {candidate.location && <ContactRow icon={MapPinIcon} label="Location" value={candidate.location} />}
              <ContactRow icon={FileTextIcon} label="Department" value={candidate.department} />
              {candidate.source && <ContactRow icon={FileTextIcon} label="Source" value={candidate.source} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Internal notes</CardTitle>
              <CardDescription>Private to your hiring team.</CardDescription>
            </CardHeader>
            <CardContent>
              <textarea
                rows={4}
                placeholder="Add a note for the team…"
                aria-label="Internal note"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
              />
              <Button size="sm" className="mt-2">Save note</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function MetaItem({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </span>
  )
}

function ContactRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700/50">
        <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
        <p className="truncate text-sm text-slate-900 dark:text-slate-50">{value}</p>
      </div>
    </div>
  )
}
