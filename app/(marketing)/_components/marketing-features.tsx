/**
 * Features section — 3 product feature cards.
 *
 * Lead with AI Job Descriptions (the most visual, most shareable
 * feature). The other two are ranked CVs and personalized interview kits.
 *
 * Each card is honest: the "screenshot" is real HTML using the same
 * design tokens as the app.
 */
import {
  FileTextIcon,
  SparklesIcon,
  UsersIcon,
  CalendarIcon,
  ClipboardListIcon,
  CheckCircle2Icon,
} from 'lucide-react'

export function MarketingFeatures() {
  return (
    <section
      id="features"
      className="border-b border-slate-200 bg-white py-20 sm:py-28 dark:border-slate-800 dark:bg-slate-950"
    >
      <div className="mx-auto max-w-6xl px-6">
        {/* Section header */}
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <SparklesIcon className="h-3 w-3 text-emerald-600" />
            The full pipeline, in one place
          </div>
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
            Three things every hiring team does. Each one faster.
          </h2>
          <p className="mt-4 text-balance text-lg text-slate-600 dark:text-slate-300">
            TalentOS covers the parts of hiring that eat your week — without
            turning your team into tool-juggling operators.
          </p>
        </div>

        {/* Cards grid */}
        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {/* Card 1 — AI Job Descriptions (LEAD) */}
          <FeatureCard
            badge="Lead feature"
            icon={<FileTextIcon className="h-5 w-5" />}
            title="AI job descriptions that don't read like AI"
            description="Tell us the role in plain English. We draft a complete job description — responsibilities, requirements, benefits — calibrated to your tone and seniority level."
            visual={<AiJobDescriptionMock />}
          />

          {/* Card 2 — Ranked CVs */}
          <FeatureCard
            icon={<UsersIcon className="h-5 w-5" />}
            title="CVs ranked before you've opened the first one"
            description="Upload a batch of CVs. TalentOS scores each candidate against the role, surfaces the top matches, and gives you a one-paragraph 'why this person' for each."
            visual={<RankedCvsMock />}
          />

          {/* Card 3 — Interview kits */}
          <FeatureCard
            icon={<ClipboardListIcon className="h-5 w-5" />}
            title="Interviewers walk in prepared"
            description="TalentOS generates a personalized interview kit for every candidate — role-specific questions, signals to look for, red flags. Your team arrives sharp instead of winging it."
            visual={<InterviewKitMock />}
          />
        </div>

        {/* Below the cards — small flat list of everything else */}
        <div className="mt-16">
          <p className="text-center text-sm font-medium text-slate-500 dark:text-slate-400">
            Plus the rest of the pipeline:
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-600 dark:text-slate-300">
            <Flat label="Public job posting" />
            <Flat label="CSV candidate import" />
            <Flat label="Bulk actions" />
            <Flat label="Decision briefs" />
            <Flat label="Interview scheduling" />
            <Flat label="Offer drafting" />
            <Flat label="Google Calendar sync" />
            <Flat label="24h email reminders" />
            <Flat label="Analytics & reports" />
          </div>
        </div>
      </div>
    </section>
  )
}

function FeatureCard({
  badge,
  icon,
  title,
  description,
  visual,
}: {
  badge?: string
  icon: React.ReactNode
  title: string
  description: string
  visual: React.ReactNode
}) {
  return (
    <div className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:border-slate-300 hover:shadow-xl hover:shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:shadow-black/20">
      {/* Badge */}
      {badge && (
        <div className="absolute -top-3 left-6 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {badge}
        </div>
      )}

      {/* Icon */}
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
        {icon}
      </div>

      {/* Title */}
      <h3 className="mt-4 text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
        {title}
      </h3>

      {/* Description */}
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        {description}
      </p>

      {/* Visual */}
      <div className="mt-6 flex-1">{visual}</div>
    </div>
  )
}

function Flat({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-600" />
      {label}
    </div>
  )
}

// ─── Visual mocks (inline HTML, not images) ──────────────────────────

function AiJobDescriptionMock() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/30">
      <div className="border-b border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
        Senior Frontend Engineer · Acme Talent
      </div>
      <div className="space-y-1.5 p-3 text-[11px] leading-relaxed text-slate-700 dark:text-slate-200">
        <p className="font-semibold text-slate-900 dark:text-white">
          About the role
        </p>
        <p className="text-slate-600 dark:text-slate-300">
          We&apos;re hiring a Senior Frontend Engineer to lead the rebuild of
          our core product.
        </p>
        <p className="font-semibold text-slate-900 dark:text-white">
          What you&apos;ll do
        </p>
        <p className="text-slate-600 dark:text-slate-300">
          Ship features end-to-end. Partner with design. Mentor mid-level
          engineers.
        </p>
        <p className="text-slate-400">…</p>
      </div>
    </div>
  )
}

function RankedCvsMock() {
  const rows = [
    { name: 'Ada Lovelace', score: 94, label: 'Strong match' },
    { name: 'Grace Hopper', score: 91, label: 'Strong match' },
    { name: 'Linus T.', score: 78, label: 'Match' },
    { name: 'Margaret H.', score: 71, label: 'Match' },
  ]
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="grid grid-cols-[1fr_auto] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
        <span>Candidate</span>
        <span>AI score</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.name}
          className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-slate-100 px-3 py-2 text-[11px] last:border-0 dark:border-slate-800"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-[9px] font-semibold text-slate-700 dark:from-slate-700 dark:to-slate-600 dark:text-slate-200">
              {r.name.split(' ').map((s) => s[0]).join('')}
            </div>
            <div>
              <div className="font-medium text-slate-900 dark:text-slate-100">
                {r.name}
              </div>
              <div className="text-[10px] text-slate-500">{r.label}</div>
            </div>
          </div>
          <div
            className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
              r.score >= 85
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
            }`}
          >
            {r.score}
          </div>
        </div>
      ))}
    </div>
  )
}

function InterviewKitMock() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
        Interview kit · Ada Lovelace
      </div>
      <div className="space-y-2 p-3 text-[11px]">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[9px] font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
            Q1
          </div>
          <p className="text-slate-700 dark:text-slate-200">
            Walk me through a system you designed end-to-end.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[9px] font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
            Q2
          </div>
          <p className="text-slate-700 dark:text-slate-200">
            How do you balance speed and quality under a deadline?
          </p>
        </div>
        <div className="flex items-start gap-2">
          <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[9px] font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
            Q3
          </div>
          <p className="text-slate-700 dark:text-slate-200">
            Tell me about a teammate you changed your mind because of.
          </p>
        </div>
        <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Signals to look for
          </div>
          <p className="mt-1 text-slate-600 dark:text-slate-300">
            Specificity over handwaving; revisits past decisions
          </p>
        </div>
      </div>
    </div>
  )
}
