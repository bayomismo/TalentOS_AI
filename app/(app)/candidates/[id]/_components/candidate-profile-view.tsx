'use client'

/**
 * Candidate detail view — client component, data from Prisma.
 *
 * Sprint 6: includes the AI match analysis block (score breakdown,
 * strengths, gaps, concerns, recommendation, reasoning) when present.
 */

import Link from 'next/link'
import { use, useEffect, useState, useTransition } from 'react'
import {
  ArrowLeftIcon,
  AwardIcon,
  BriefcaseIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  ClipboardListIcon,
  FileTextIcon,
  GraduationCapIcon,
  MailIcon,
  MapPinIcon,
  MicIcon,
  PhoneIcon,
  ScaleIcon,
  SparklesIcon,
  StarIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TrendingUpIcon,
} from 'lucide-react'

import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/features/shared/components/status-badge'
import { getCandidateDetailAction, type CandidateDetail, type MatchAnalysisBlock } from '../actions'
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
  const firstName = candidate.name.split(' ')[0] ?? candidate.name

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
            {(candidate.stage === 'screening' || candidate.stage === 'interview') && (
              <Link
                href={`/candidates/${candidate.id}/interview-kit`}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700"
              >
                <SparklesIcon className="h-4 w-4" aria-hidden />
                Generate Interview Kit
              </Link>
            )}
            {candidate.latestInterview && (
              <Link
                href={`/candidates/${candidate.id}/interview-kit/${candidate.latestInterview.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                <MicIcon className="h-4 w-4" aria-hidden />
                Open Interview Kit
              </Link>
            )}
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
            {candidate.yearsExperience !== null && (
              <MetaItem icon={BriefcaseIcon}>
                {candidate.yearsExperience} {candidate.yearsExperience === 1 ? 'year' : 'years'} experience
              </MetaItem>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* AI Match Analysis (Sprint 6) */}
          {candidate.analysis && <AnalysisCard analysis={candidate.analysis} firstName={firstName} />}

          {/* Sprint 7: Interview kit + latest evaluation */}
          {(candidate.latestInterview || candidate.interviewCounts.total > 0) && (
            <InterviewCard
              candidateId={candidate.id}
              latestInterview={candidate.latestInterview}
              counts={candidate.interviewCounts}
              stage={candidate.stage}
            />
          )}

          {/* Sprint 8: Decision Hub entry */}
          <DecisionSection
            candidateId={candidate.id}
            hiringRequestId={candidate.hiringRequestId}
            matchScore={candidate.matchScore}
            finalDecision={candidate.finalDecision}
            hasInterview={candidate.latestInterview !== null}
            hasEvaluation={candidate.latestInterview?.hasEvaluation ?? false}
            stage={candidate.stage}
          />

          {/* Profile summary */}
          {candidate.summary && (
            <Card>
              <CardHeader>
                <CardTitle>Profile summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                  {candidate.summary}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Pipeline progress */}
          <Card>
            <CardHeader>
              <CardTitle>Pipeline progress</CardTitle>
              <CardDescription>
                Where {firstName} is in the hiring funnel.
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

          {/* Work experience */}
          {candidate.experiences.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Work experience</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {candidate.experiences.map((exp, idx) => (
                  <div
                    key={`${exp.company}-${idx}`}
                    className="border-l-2 border-slate-200 pl-4 dark:border-slate-700"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                        {exp.title} <span className="font-normal text-slate-500">@ {exp.company}</span>
                      </h3>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {new Date(exp.startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
                        {' – '}
                        {exp.isCurrent
                          ? 'Present'
                          : exp.endDate
                            ? new Date(exp.endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
                            : ''}
                      </span>
                    </div>
                    {exp.location && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">{exp.location}</p>
                    )}
                    {exp.description && (
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{exp.description}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Education */}
          {candidate.educations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Education</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {candidate.educations.map((ed, idx) => (
                  <div
                    key={`${ed.institution}-${idx}`}
                    className="flex items-start gap-3"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700/50">
                      <GraduationCapIcon className="h-4 w-4 text-slate-500" aria-hidden />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                        {ed.degree} · {ed.field}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {ed.institution}
                        {ed.endDate && ` · ${new Date(ed.endDate).getFullYear()}`}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Certifications */}
          {candidate.certifications.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Certifications</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {candidate.certifications.map((cert, idx) => (
                  <div key={`${cert.name}-${idx}`} className="flex items-center gap-2 text-sm">
                    <AwardIcon className="h-4 w-4 text-amber-500" aria-hidden />
                    <span className="font-medium text-slate-900 dark:text-slate-50">{cert.name}</span>
                    <span className="text-slate-500 dark:text-slate-400">· {cert.issuer}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

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
              {candidate.phone && <ContactRow icon={PhoneIcon} label="Phone" value={candidate.phone} />}
              {candidate.location && <ContactRow icon={MapPinIcon} label="Location" value={candidate.location} />}
              <ContactRow icon={FileTextIcon} label="Department" value={candidate.department} />
              {candidate.source && <ContactRow icon={FileTextIcon} label="Source" value={candidate.source} />}
            </CardContent>
          </Card>

          {/* Skills */}
          {candidate.skills.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Skills</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {candidate.skills.map(skill => (
                    <span
                      key={skill}
                      className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Source CV */}
          {candidate.cvFiles.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Source CV</CardTitle>
                <CardDescription>The CV used to create this candidate.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {candidate.cvFiles.map(f => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-800/40"
                  >
                    <FileTextIcon className="h-4 w-4 text-slate-500" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900 dark:text-slate-50">
                        {f.fileName}
                      </p>
                      <p className="text-slate-500 dark:text-slate-400">
                        {f.fileType} · {(f.fileSize / 1024).toFixed(1)} KB ·{' '}
                        {new Date(f.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

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

// -----------------------------------------------------------------------------
// AI Match Analysis block (Sprint 6)
// -----------------------------------------------------------------------------

function AnalysisCard({ analysis, firstName }: { analysis: MatchAnalysisBlock; firstName: string }) {
  const scoreColor = scoreToColor(analysis.overallScore)
  const recColor = recommendationToColor(analysis.recommendation)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-4 w-4 text-emerald-600" aria-hidden />
          <CardTitle>AI match analysis</CardTitle>
        </div>
        <CardDescription>
          {analysis.analyzedAt
            ? `Last analyzed ${new Date(analysis.analyzedAt).toLocaleString()}`
            : 'Analyzed against the linked job description.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex flex-col items-center gap-2 md:items-start">
            <ScoreRing score={analysis.overallScore} color={scoreColor} />
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Overall match
            </p>
          </div>

          <div className="flex-1 space-y-3">
            <ScoreBar label="Skills" score={analysis.skillsScore} />
            <ScoreBar label="Experience" score={analysis.experienceScore} />
            <ScoreBar label="Role" score={analysis.roleScore} />
            <ScoreBar label="Education" score={analysis.educationScore} />
          </div>
        </div>

        {analysis.recommendation && (
          <div
            className={cn(
              'rounded-xl border p-4',
              recColor.bg,
              recColor.border
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  recColor.chip
                )}
              >
                {analysis.recommendation}
              </span>
              <span className={cn('text-sm font-medium', recColor.text)}>AI recommendation</span>
            </div>
            {analysis.reasoning && (
              <p className={cn('mt-2 text-sm leading-relaxed', recColor.text)}>
                {analysis.reasoning}
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <InsightList
            icon={ThumbsUpIcon}
            title="Strengths"
            items={analysis.strengths}
            tone="emerald"
          />
          <InsightList
            icon={TrendingUpIcon}
            title="Gaps"
            items={analysis.gaps}
            tone="amber"
          />
          <InsightList
            icon={ThumbsDownIcon}
            title="Concerns"
            items={analysis.concerns}
            tone="rose"
          />
        </div>
      </CardContent>
    </Card>
  )
}

function ScoreRing({ score, color }: { score: number; color: { ring: string; text: string } }) {
  return (
    <div className="relative flex h-28 w-28 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="44"
          stroke="currentColor"
          strokeWidth="8"
          fill="transparent"
          className="text-slate-200 dark:text-slate-700"
        />
        <circle
          cx="50"
          cy="50"
          r="44"
          stroke="currentColor"
          strokeWidth="8"
          fill="transparent"
          strokeDasharray={`${(score / 100) * 276.46} 276.46`}
          strokeLinecap="round"
          className={color.ring}
        />
      </svg>
      <div className="flex flex-col items-center">
        <span className={cn('text-2xl font-bold tabular-nums', color.text)}>{score}</span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">/ 100</span>
      </div>
    </div>
  )
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const color = scoreToColor(score)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-700 dark:text-slate-200">{label}</span>
        <span className={cn('font-semibold tabular-nums', color.text)}>{score}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          className={cn('h-full transition-all', color.bar)}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  )
}

function InsightList({
  icon: Icon,
  title,
  items,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  items: string[]
  tone: 'emerald' | 'amber' | 'rose'
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/40">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{title}</p>
        </div>
        <p className="mt-2 text-xs italic text-slate-400">None identified</p>
      </div>
    )
  }

  const toneClasses = {
    emerald: {
      bg: 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30',
      icon: 'text-emerald-600',
      title: 'text-emerald-700 dark:text-emerald-300',
    },
    amber: {
      bg: 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30',
      icon: 'text-amber-600',
      title: 'text-amber-700 dark:text-amber-300',
    },
    rose: {
      bg: 'border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30',
      icon: 'text-rose-600',
      title: 'text-rose-700 dark:text-rose-300',
    },
  }[tone]

  return (
    <div className={cn('rounded-lg border p-3', toneClasses.bg)}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5', toneClasses.icon)} aria-hidden />
        <p className={cn('text-xs font-medium uppercase tracking-wider', toneClasses.title)}>{title}</p>
      </div>
      <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-200">
        {items.map((item, idx) => (
          <li key={idx} className="flex gap-1.5">
            <span className="text-slate-400">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function scoreToColor(score: number) {
  if (score >= 80) {
    return {
      ring: 'text-emerald-500',
      bar: 'bg-emerald-500',
      text: 'text-emerald-700 dark:text-emerald-400',
    }
  }
  if (score >= 60) {
    return {
      ring: 'text-sky-500',
      bar: 'bg-sky-500',
      text: 'text-sky-700 dark:text-sky-400',
    }
  }
  if (score >= 40) {
    return {
      ring: 'text-amber-500',
      bar: 'bg-amber-500',
      text: 'text-amber-700 dark:text-amber-400',
    }
  }
  return {
    ring: 'text-rose-500',
    bar: 'bg-rose-500',
    text: 'text-rose-700 dark:text-rose-400',
  }
}

function recommendationToColor(rec: string | null) {
  switch (rec) {
    case 'Strong Match':
      return {
        bg: 'bg-emerald-50/60 dark:bg-emerald-950/30',
        border: 'border-emerald-200 dark:border-emerald-900',
        chip: 'bg-emerald-500 text-white',
        text: 'text-emerald-900 dark:text-emerald-200',
      }
    case 'Good Match':
      return {
        bg: 'bg-sky-50/60 dark:bg-sky-950/30',
        border: 'border-sky-200 dark:border-sky-900',
        chip: 'bg-sky-500 text-white',
        text: 'text-sky-900 dark:text-sky-200',
      }
    case 'Potential Match':
      return {
        bg: 'bg-amber-50/60 dark:bg-amber-950/30',
        border: 'border-amber-200 dark:border-amber-900',
        chip: 'bg-amber-500 text-white',
        text: 'text-amber-900 dark:text-amber-200',
      }
    case 'Weak Match':
      return {
        bg: 'bg-orange-50/60 dark:bg-orange-950/30',
        border: 'border-orange-200 dark:border-orange-900',
        chip: 'bg-orange-500 text-white',
        text: 'text-orange-900 dark:text-orange-200',
      }
    case 'Not Recommended':
      return {
        bg: 'bg-rose-50/60 dark:bg-rose-950/30',
        border: 'border-rose-200 dark:border-rose-900',
        chip: 'bg-rose-500 text-white',
        text: 'text-rose-900 dark:text-rose-200',
      }
    default:
      return {
        bg: 'bg-slate-50 dark:bg-slate-800/40',
        border: 'border-slate-200 dark:border-slate-700',
        chip: 'bg-slate-500 text-white',
        text: 'text-slate-900 dark:text-slate-200',
      }
  }
}

// -----------------------------------------------------------------------------
// Sprint 7: Interview kit + latest evaluation card
// -----------------------------------------------------------------------------

interface InterviewCardProps {
  candidateId: string
  latestInterview: NonNullable<CandidateDetail['latestInterview']> | null
  counts: CandidateDetail['interviewCounts']
  stage: CandidateDetail['stage']
}

function InterviewCard({ candidateId, latestInterview, counts, stage }: InterviewCardProps) {
  const eligibleForKit = stage === 'screening' || stage === 'interview'
  const linkToKit = latestInterview
    ? `/candidates/${candidateId}/interview-kit/${latestInterview.id}`
    : `/candidates/${candidateId}/interview-kit`

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MicIcon className="h-4 w-4 text-emerald-600" aria-hidden />
            <CardTitle>Interview</CardTitle>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              {counts.total} total · {counts.completed} completed · {counts.upcoming} upcoming
            </span>
          </div>
        </div>
        <CardDescription>
          AI-generated, personalized interview kit + structured evaluation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {latestInterview ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Interview status
              </div>
              <div className="mt-1 text-sm font-semibold capitalize text-slate-900 dark:text-slate-50">
                {latestInterview.status.replace(/_/g, ' ').toLowerCase()}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {latestInterview.type.replace(/_/g, ' ')} · {latestInterview.durationMinutes} min
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Interview score
              </div>
              <div
                className={cn(
                  'mt-1 text-2xl font-bold',
                  latestInterview.interviewScore != null && latestInterview.interviewScore >= 70
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : latestInterview.interviewScore != null && latestInterview.interviewScore >= 50
                      ? 'text-amber-700 dark:text-amber-300'
                      : latestInterview.interviewScore != null
                        ? 'text-rose-700 dark:text-rose-300'
                        : 'text-slate-500 dark:text-slate-400'
                )}
              >
                {latestInterview.interviewScore != null ? `${latestInterview.interviewScore} / 100` : 'Not yet evaluated'}
              </div>
              {latestInterview.recommendation && (
                <div className="mt-0.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                  {latestInterview.recommendation.replace(/_/g, ' ')}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Interviewers
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {latestInterview.participantNames.length === 0 ? (
                  <span className="text-sm text-slate-500 dark:text-slate-400">None assigned</span>
                ) : (
                  latestInterview.participantNames.map(n => (
                    <span
                      key={n}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      {n}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No interview has been scheduled for this candidate yet.
            {eligibleForKit && ' Generate an AI-personalized kit to get started.'}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={linkToKit}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              'bg-emerald-600 text-white hover:bg-emerald-700'
            )}
          >
            <SparklesIcon className="h-4 w-4" />
            {latestInterview ? 'Open interview kit' : eligibleForKit ? 'Generate interview kit' : 'View'}
          </Link>
          {latestInterview && !latestInterview.hasEvaluation && latestInterview.status !== 'COMPLETED' && (
            <Link
              href={`/candidates/${candidateId}/interview-kit/${latestInterview.id}/evaluate`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              <ClipboardListIcon className="h-4 w-4" />
              Start evaluation
            </Link>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          AI is decision support. The human interviewer / hiring manager remains
          responsible for the final call.
        </p>
      </CardContent>
    </Card>
  )
}

// -----------------------------------------------------------------------------
// Sprint 8: Decision Hub section
// -----------------------------------------------------------------------------

interface DecisionSectionProps {
  candidateId: string
  hiringRequestId: string
  matchScore: number | null
  finalDecision: CandidateDetail['finalDecision']
  hasInterview: boolean
  hasEvaluation: boolean
  stage: CandidateDetail['stage']
}

type Readiness = 'NOT_READY' | 'NEEDS_INTERVIEW' | 'AWAITING_EVALUATION' | 'READY_FOR_REVIEW'

const READINESS_INFO: Record<Readiness, { label: string; description: string; className: string }> = {
  NOT_READY: {
    label: 'Not ready',
    description: 'Awaiting AI CV analysis.',
    className: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  NEEDS_INTERVIEW: {
    label: 'Needs interview',
    description: 'AI analysis complete. Schedule an interview to continue.',
    className: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  AWAITING_EVALUATION: {
    label: 'Awaiting evaluation',
    description: 'Interview in progress or completed without a scorecard.',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  READY_FOR_REVIEW: {
    label: 'Ready for review',
    description: 'AI analysis + human interview scorecard both available.',
    className: 'bg-green-100 text-green-800 border-green-200',
  },
}

function computeReadiness(
  matchScore: number | null,
  hasInterview: boolean,
  hasEvaluation: boolean,
): Readiness {
  if (matchScore === null) return 'NOT_READY'
  if (!hasInterview) return 'NEEDS_INTERVIEW'
  if (!hasEvaluation) return 'AWAITING_EVALUATION'
  return 'READY_FOR_REVIEW'
}

function DecisionSection({
  candidateId,
  hiringRequestId,
  matchScore,
  finalDecision,
  hasInterview,
  hasEvaluation,
  stage,
}: DecisionSectionProps) {
  const readiness = computeReadiness(matchScore, hasInterview, hasEvaluation)
  const info = READINESS_INFO[readiness]

  const decisionBadge: Record<NonNullable<typeof finalDecision>['decision'], { label: string; className: string }> = {
    SELECTED: { label: 'Selected', className: 'bg-green-100 text-green-800' },
    REJECT: { label: 'Rejected', className: 'bg-red-100 text-red-800' },
    HOLD: { label: 'On hold', className: 'bg-yellow-100 text-yellow-800' },
    ADVANCE: { label: 'Advanced', className: 'bg-blue-100 text-blue-800' },
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ScaleIcon className="h-4 w-4 text-violet-600" aria-hidden />
            <CardTitle>Decision</CardTitle>
          </div>
          <span
            className={cn('rounded border px-2 py-0.5 text-xs font-medium', info.className)}
          >
            {info.label}
          </span>
        </div>
        <CardDescription>
          {info.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {finalDecision && (
          <div className={cn('rounded p-3 text-sm', decisionBadge[finalDecision.decision].className)}>
            <p className="font-semibold">
              {decisionBadge[finalDecision.decision].label} by {finalDecision.decidedByName} on{' '}
              {new Date(finalDecision.decidedAt).toLocaleDateString()}
            </p>
            {finalDecision.notes && (
              <p className="mt-1 text-xs">“{finalDecision.notes}”</p>
            )}
            {finalDecision.reason && (
              <p className="mt-1 text-xs italic">Reason: {finalDecision.reason}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <p className="font-semibold text-slate-700">AI CV Match</p>
            <p className="text-lg font-semibold text-slate-900">{matchScore ?? '—'}</p>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <p className="font-semibold text-slate-700">Interview status</p>
            <p className="text-sm text-slate-900">
              {!hasInterview
                ? 'Not scheduled'
                : hasEvaluation
                  ? 'Scorecard submitted'
                  : 'Pending scorecard'}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Link
            href={`/hiring-requests/${hiringRequestId}/decision`}
            className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"
          >
            <ScaleIcon className="h-3.5 w-3.5" aria-hidden />
            Open Decision Hub
            <ArrowLeftIcon className="h-3 w-3 rotate-180" aria-hidden />
          </Link>
          {readiness === 'NEEDS_INTERVIEW' && (stage === 'screening' || stage === 'interview') && (
            <Link
              href={`/candidates/${candidateId}/interview-kit`}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
            >
              <MicIcon className="h-3.5 w-3.5" aria-hidden />
              Prepare Interview Kit
            </Link>
          )}
        </div>
        <p className="text-xs italic text-slate-500">
          AI is decision support. The human hiring manager remains responsible for the final call.
        </p>
      </CardContent>
    </Card>
  )
}
