/**
 * "Why TalentOS" — trust section.
 *
 * Addresses the #1 fear of B2B AI buyers: "is this just hype?"
 * Honest, specific differentiators. No "trusted by Fortune 500"
 * because we're not there yet.
 */
import {
  ShieldCheckIcon,
  EyeOffIcon,
  ScaleIcon,
  SparklesIcon,
  GitBranchIcon,
  LockIcon,
} from 'lucide-react'

export function MarketingWhy() {
  return (
    <section
      id="why"
      className="border-b border-slate-200 bg-white py-20 sm:py-28 dark:border-slate-800 dark:bg-slate-950"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
          {/* Copy */}
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <ShieldCheckIcon className="h-3 w-3 text-emerald-600" />
              Built for teams that get audited
            </div>
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
              AI in hiring is a minefield. We navigate it.
            </h2>
            <p className="mt-4 text-balance text-lg text-slate-600 dark:text-slate-300">
              Most AI hiring tools are black boxes that score candidates on
              criteria you can&apos;t see, with no way to audit the decision.
              We took a different route.
            </p>

            <div className="mt-8 space-y-5">
              <TrustRow
                icon={<EyeOffIcon className="h-4 w-4" />}
                title="Compensation never reaches the AI"
                body="Salary, equity, and comp data are stripped from candidate records before any AI call. The model can't bias on what it can't see."
              />
              <TrustRow
                icon={<ScaleIcon className="h-4 w-4" />}
                title="AI proposes. Humans decide."
                body="TalentOS drafts, scores, and briefs. It never approves, declines, or closes a candidate. Every final call is a person."
              />
              <TrustRow
                icon={<GitBranchIcon className="h-4 w-4" />}
                title="Every AI call is logged"
                body="Full audit trail: which model, which prompt, which result. You can replay any AI decision and explain it to a regulator or a candidate."
              />
              <TrustRow
                icon={<LockIcon className="h-4 w-4" />}
                title="Tenant-isolated. SOC2-ready."
                body="Your candidates are behind a row-level tenant boundary. The same data isolation pattern used by enterprise HRIS platforms."
              />
            </div>
          </div>

          {/* Right side — visual showing the AI fairness layer */}
          <div className="relative">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950 dark:shadow-black/20">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="font-semibold">AI decision trail</span>
                <span className="font-mono">2026-07-23 14:32 UTC</span>
              </div>

              <div className="mt-4 space-y-3 text-sm">
                <Pipeline label="1. Candidate data" value="Ada Lovelace — Senior Frontend" />
                <Pipeline label="2. Compensation stripped" value="$XXX,XXX — REMOVED" muted />
                <Pipeline label="3. Protected attributes stripped" value="age, gender, photo — REMOVED" muted />
                <Pipeline label="4. AI analysis" value="gemini-flash-lite · 1,247 tokens" />
                <Pipeline label="5. Output" value="Score 94/100 — Strong match" highlight />
                <Pipeline label="6. Human decision" value="Pending your review →" />
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <div className="flex items-center gap-1.5">
                  <SparklesIcon className="h-3 w-3 text-emerald-600" />
                  Full prompt + response archived
                </div>
                <button className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
                  Replay →
                </button>
              </div>
            </div>

            {/* Trust badges below the card */}
            <div className="mt-6 grid grid-cols-3 gap-2">
              <Badge>HTTPS only</Badge>
              <Badge>RBAC built in</Badge>
              <Badge>Audit log</Badge>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function TrustRow({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          {title}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {body}
        </p>
      </div>
    </div>
  )
}

function Pipeline({
  label,
  value,
  highlight,
  muted,
}: {
  label: string
  value: string
  highlight?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0 dark:border-slate-800">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div
        className={`truncate font-mono text-xs ${
          highlight
            ? 'rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
            : muted
              ? 'text-slate-400 line-through dark:text-slate-500'
              : 'text-slate-700 dark:text-slate-200'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-center text-[11px] font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
      {children}
    </div>
  )
}
