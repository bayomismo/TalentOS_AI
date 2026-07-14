'use client'

/**
 * Review screen — every section is editable.
 *
 * Rendered after a successful `generateJobDescriptionAction`. The user
 * can tweak anything before clicking "Create Hiring Request".
 */

import {
  AlertCircleIcon,
  BriefcaseIcon,
  BuildingIcon,
  CheckIcon,
  ClipboardListIcon,
  FileTextIcon,
  GraduationCapIcon,
  ListChecksIcon,
  Loader2Icon,
  MapPinIcon,
  PlusIcon,
  SaveIcon,
  SparklesIcon,
  StarIcon,
  Trash2Icon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useDispatchDraft, useDraft, usePhase, useWizard } from './wizard-state'
import { cn } from '@/lib/utils'

const FIELD_DEFS = {
  title: { label: 'Job title', icon: BriefcaseIcon },
  summary: { label: 'Summary', icon: FileTextIcon, multiline: true },
  responsibilities: { label: 'Responsibilities', icon: ListChecksIcon, list: true },
  requiredSkills: { label: 'Required skills', icon: StarIcon, list: true, chip: true },
  preferredSkills: { label: 'Preferred skills', icon: SparklesIcon, list: true, chip: true },
  qualifications: { label: 'Qualifications', icon: GraduationCapIcon, list: true },
  benefits: { label: 'Benefits', icon: CheckIcon, list: true, chip: true },
  screeningQuestions: { label: 'Screening questions', icon: ClipboardListIcon, list: true },
  interviewQuestions: { label: 'Interview questions', icon: ClipboardListIcon, list: 'object' as const },
} as const

export function ReviewScreen() {
  const draft = useDraft()
  const phase = usePhase()
  const { dispatch } = useWizard()
  const { patch, patchMeta, patchList, addListItem, removeListItem, patchCriterion, removeCriterion, addCriterion } =
    useDispatchDraft()

  if (!draft) return null

  const isSaving = phase === 'saving'

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 border-b border-slate-200 pb-5 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <SparklesIcon className="h-3 w-3" />
            AI generated · review and edit
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          {draft.title}
        </h1>
        <p className="max-w-3xl text-sm text-slate-500 dark:text-slate-400">
          Edit any field before creating the hiring request. Changes are saved when you click
          <span className="mx-1 rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            Create Hiring Request
          </span>
          at the bottom.
        </p>
      </header>

      <Section icon={BuildingIcon} title="Role context">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <MetaField
            label="Role"
            value={draft.meta.role}
            onChange={v => patchMeta({ role: v })}
          />
          <MetaField
            label="Department"
            value={draft.meta.department}
            onChange={v => patchMeta({ department: v })}
          />
          <MetaSelect
            label="Employment type"
            value={draft.meta.employmentType}
            options={[
              { label: 'Full-time', value: 'FULL_TIME' },
              { label: 'Part-time', value: 'PART_TIME' },
              { label: 'Contract', value: 'CONTRACT' },
              { label: 'Internship', value: 'INTERNSHIP' },
              { label: 'Temporary', value: 'TEMPORARY' },
            ]}
            onChange={v => patchMeta({ employmentType: v as never })}
          />
          <MetaField
            label="Experience"
            value={draft.meta.experience}
            onChange={v => patchMeta({ experience: v })}
          />
          <MetaField
            label="Location"
            value={draft.meta.location}
            icon={MapPinIcon}
            onChange={v => patchMeta({ location: v })}
            className="md:col-span-2"
          />
        </div>
      </Section>

      <Section icon={FIELD_DEFS.title.icon} title="Job title">
        <TextField
          value={draft.title}
          onChange={v => patch({ title: v })}
          placeholder="Senior Frontend Developer"
        />
      </Section>

      <Section icon={FIELD_DEFS.summary.icon} title="Summary">
        <TextArea
          value={draft.summary}
          onChange={v => patch({ summary: v })}
          rows={4}
          placeholder="A 2-4 sentence summary of the role."
        />
      </Section>

      <Section icon={FIELD_DEFS.responsibilities.icon} title="Responsibilities">
        <ListEditor
          items={draft.responsibilities}
          onPatch={(i, v) => patchList('responsibilities', i, v)}
          onAdd={v => addListItem('responsibilities', v)}
          onRemove={i => removeListItem('responsibilities', i)}
          multiline
          addLabel="Add responsibility"
        />
      </Section>

      <Section icon={FIELD_DEFS.requiredSkills.icon} title="Required skills">
        <ChipList
          items={draft.requiredSkills}
          onPatch={(i, v) => patchList('requiredSkills', i, v)}
          onAdd={v => addListItem('requiredSkills', v)}
          onRemove={i => removeListItem('requiredSkills', i)}
          addLabel="Add skill"
        />
      </Section>

      <Section icon={FIELD_DEFS.preferredSkills.icon} title="Preferred skills">
        <ChipList
          items={draft.preferredSkills}
          onPatch={(i, v) => patchList('preferredSkills', i, v)}
          onAdd={v => addListItem('preferredSkills', v)}
          onRemove={i => removeListItem('preferredSkills', i)}
          addLabel="Add skill"
        />
      </Section>

      <Section icon={FIELD_DEFS.qualifications.icon} title="Qualifications">
        <ListEditor
          items={draft.qualifications}
          onPatch={(i, v) => patchList('qualifications', i, v)}
          onAdd={v => addListItem('qualifications', v)}
          onRemove={i => removeListItem('qualifications', i)}
          addLabel="Add qualification"
        />
      </Section>

      <Section icon={FIELD_DEFS.benefits.icon} title="Benefits">
        <ChipList
          items={draft.benefits}
          onPatch={(i, v) => patchList('benefits', i, v)}
          onAdd={v => addListItem('benefits', v)}
          onRemove={i => removeListItem('benefits', i)}
          addLabel="Add benefit"
        />
      </Section>

      <Section icon={FIELD_DEFS.screeningQuestions.icon} title="Screening questions">
        <ListEditor
          items={draft.screeningQuestions}
          onPatch={(i, v) => patchList('screeningQuestions', i, v)}
          onAdd={v => addListItem('screeningQuestions', v)}
          onRemove={i => removeListItem('screeningQuestions', i)}
          addLabel="Add screening question"
        />
      </Section>

      <Section icon={FIELD_DEFS.interviewQuestions.icon} title="Interview questions">
        <div className="space-y-3">
          {draft.interviewQuestions.map((q, i) => (
            <div
              key={i}
              className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                {i + 1}
              </div>
              <div className="flex-1 space-y-2">
                <input
                  value={q.category}
                  onChange={e => {
                    const next = draft.interviewQuestions.slice()
                    next[i] = { ...q, category: e.target.value }
                    patch({ interviewQuestions: next })
                  }}
                  className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium uppercase tracking-wider text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                />
                <textarea
                  value={q.question}
                  onChange={e => {
                    const next = draft.interviewQuestions.slice()
                    next[i] = { ...q, question: e.target.value }
                    patch({ interviewQuestions: next })
                  }}
                  rows={2}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = draft.interviewQuestions.slice()
                  next.splice(i, 1)
                  patch({ interviewQuestions: next })
                }}
                className="rounded-md p-1.5 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-slate-700"
                aria-label="Remove question"
              >
                <Trash2Icon className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              patch({
                interviewQuestions: [
                  ...draft.interviewQuestions,
                  { category: 'New category', question: '' },
                ],
              })
            }
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add interview question
          </button>
        </div>
      </Section>

      <Section icon={ListChecksIcon} title="Evaluation criteria">
        <p className="-mt-2 mb-3 text-xs text-slate-500 dark:text-slate-400">
          Auto-derived from the required skills. Tweak weights to match your hiring priorities.
        </p>
        <div className="space-y-3">
          {draft.evaluationCriteria.map(crit => (
            <div
              key={crit.id}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="flex items-center gap-3">
                <input
                  value={crit.category}
                  onChange={e => patchCriterion(crit.id, { category: e.target.value })}
                  className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
                />
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={crit.weight}
                    onChange={e => patchCriterion(crit.id, { weight: Math.max(0, Math.min(100, Number(e.target.value))) })}
                    className="h-8 w-16 rounded-md border border-slate-200 bg-white px-2 text-right text-sm font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
                  />
                  <span className="text-xs font-medium text-slate-500">%</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeCriterion(crit.id)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-slate-700"
                  aria-label="Remove criterion"
                >
                  <Trash2Icon className="h-4 w-4" />
                </button>
              </div>
              {crit.indicators.length > 0 && (
                <ul className="mt-3 space-y-1 pl-1">
                  {crit.indicators.map((ind, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <CheckIcon className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                      <span>{ind}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addCriterion}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add criterion
          </button>
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-8 mt-8 border-t border-slate-200 bg-white/80 px-8 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {draft.evaluationCriteria.length} evaluation criteria · {draft.interviewQuestions.length} interview questions ·{' '}
            {draft.requiredSkills.length} required skills
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => dispatch({ type: 'generate-start' })}
              disabled={isSaving}
            >
              <SparklesIcon className="h-4 w-4" />
              Regenerate
            </Button>
            <Button
              variant="outline"
              onClick={() => dispatch({ type: 'save-start' })}
              disabled={isSaving}
            >
              <SaveIcon className="h-4 w-4" />
              Save draft
            </Button>
            <Button
              onClick={() => dispatch({ type: 'save-start' })}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <CheckIcon className="h-4 w-4" />
                  Create hiring request
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {phase === 'error' && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Couldn&apos;t save</p>
            <p className="mt-0.5 text-xs opacity-80">Try again, or regenerate the package.</p>
          </div>
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Building blocks
// -----------------------------------------------------------------------------

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
        <Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        {title}
      </h3>
      {children}
    </section>
  )
}

function TextField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
    />
  )
}

function TextArea({
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
    />
  )
}

function MetaField({
  label,
  value,
  onChange,
  icon: Icon,
  className,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  icon?: React.ComponentType<{ className?: string }>
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <Icon className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
        )}
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          className={cn(
            'h-10 w-full rounded-lg border border-slate-200 bg-white py-2 pr-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50',
            Icon && 'pl-9'
          )}
        />
      </div>
    </div>
  )
}

function MetaSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { label: string; value: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function ChipList({
  items,
  onPatch,
  onAdd,
  onRemove,
  addLabel,
}: {
  items: string[]
  onPatch: (index: number, value: string) => void
  onAdd: (value: string) => void
  onRemove: (index: number) => void
  addLabel: string
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {items.map((item, i) => (
          <div
            key={i}
            className="group flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white pl-3 pr-1.5 dark:border-slate-700 dark:bg-slate-800"
          >
            <input
              value={item}
              onChange={e => onPatch(i, e.target.value)}
              className="h-8 w-32 bg-transparent text-sm text-slate-700 focus:outline-none dark:text-slate-200"
            />
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="rounded-md p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-slate-700"
              aria-label="Remove"
            >
              <Trash2Icon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <AddItemInput onAdd={onAdd} placeholder={addLabel} />
    </div>
  )
}

function ListEditor({
  items,
  onPatch,
  onAdd,
  onRemove,
  multiline,
  addLabel,
}: {
  items: string[]
  onPatch: (index: number, value: string) => void
  onAdd: (value: string) => void
  onRemove: (index: number) => void
  multiline?: boolean
  addLabel: string
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div
          key={i}
          className="group flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
        >
          <span className="mt-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
            {i + 1}
          </span>
          {multiline ? (
            <textarea
              value={item}
              onChange={e => onPatch(i, e.target.value)}
              rows={2}
              className="flex-1 resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
            />
          ) : (
            <input
              value={item}
              onChange={e => onPatch(i, e.target.value)}
              className="h-9 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
            />
          )}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="mt-1 rounded-md p-1.5 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-slate-700"
            aria-label="Remove"
          >
            <Trash2Icon className="h-4 w-4" />
          </button>
        </div>
      ))}
      <AddItemInput onAdd={onAdd} placeholder={addLabel} />
    </div>
  )
}

function AddItemInput({ onAdd, placeholder }: { onAdd: (value: string) => void; placeholder: string }) {
  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        const value = (formData.get('value') as string)?.trim()
        if (value) {
          onAdd(value)
          e.currentTarget.reset()
        }
      }}
      className="flex items-center gap-2"
    >
      <input
        name="value"
        placeholder={placeholder}
        className="h-9 flex-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-50"
      />
      <button
        type="submit"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Add
      </button>
    </form>
  )
}

