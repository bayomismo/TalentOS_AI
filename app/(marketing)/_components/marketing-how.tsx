/**
 * How it works — 3 steps, no fluff.
 */
import { PencilLineIcon, FileUpIcon, MessageSquareTextIcon } from 'lucide-react'

export function MarketingHow() {
  return (
    <section
      id="how"
      className="border-b border-slate-200 bg-slate-50/50 py-20 sm:py-28 dark:border-slate-800 dark:bg-slate-900/30"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
            Set up in 2 minutes. Hire by Friday.
          </h2>
          <p className="mt-4 text-balance text-lg text-slate-600 dark:text-slate-300">
            Onboarding is self-serve. No sales call. No setup fee.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          <Step
            n="1"
            icon={<PencilLineIcon className="h-5 w-5" />}
            title="Describe the role in a sentence"
            body="Tell us the title, the level, and what you're looking for. AI drafts the full job description."
          />
          <Step
            n="2"
            icon={<FileUpIcon className="h-5 w-5" />}
            title="Add candidates"
            body="Paste in CVs, share a public application link, or import a CSV. TalentOS scores every one against the role."
          />
          <Step
            n="3"
            icon={<MessageSquareTextIcon className="h-5 w-5" />}
            title="Run interviews that don't suck"
            body="Interviewers get a personalized kit. Candidates get clear communication. You get a structured summary."
          />
        </div>
      </div>
    </section>
  )
}

function Step({
  n,
  icon,
  title,
  body,
}: {
  n: string
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="relative">
      {/* Big number behind */}
      <div className="absolute -top-4 left-0 select-none text-7xl font-bold leading-none text-slate-200/70 sm:text-8xl dark:text-slate-800/60">
        {n}
      </div>
      <div className="relative">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm">
          {icon}
        </div>
        <h3 className="mt-4 text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {body}
        </p>
      </div>
    </div>
  )
}
