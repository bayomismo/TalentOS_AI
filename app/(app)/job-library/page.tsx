'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BookmarkIcon,
  CopyIcon,
  FileTextIcon,
  LinkIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'
import { cn } from '@/lib/utils'
import { getJobLibraryAction, type JobLibraryData, type JobLibraryItem } from './actions'
import { NewTemplateModal } from './_components/new-template-modal'
import { ImportUrlModal } from './_components/import-url-modal'
import { ShareModal } from './_components/share-modal'

const CATEGORIES: { id: 'all' | string; label: string }[] = [
  { id: 'all', label: 'All categories' },
  { id: 'Engineering', label: 'Engineering' },
  { id: 'Product', label: 'Product' },
  { id: 'Design', label: 'Design' },
  { id: 'Data', label: 'Data' },
  { id: 'Operations', label: 'Operations' },
]

export default function JobLibraryPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<'all' | string>('all')
  const [data, setData] = useState<JobLibraryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newTemplateOpen, setNewTemplateOpen] = useState(false)
  const [importUrlOpen, setImportUrlOpen] = useState(false)
  const [shareJob, setShareJob] = useState<JobLibraryItem | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    getJobLibraryAction()
      .then(result => setData(result))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load job library'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getJobLibraryAction()
      .then(result => {
        if (cancelled) return
        setData(result)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load job library')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Wrapper used by modals after a successful create/import.
  const reload = useCallback(() => {
    refresh()
  }, [refresh])

  const items = data?.items ?? []

  const filtered = useMemo(() => {
    return items.filter((t: JobLibraryItem) => {
      if (category !== 'all' && t.category !== category) return false
      if (
        search &&
        !`${t.title} ${t.category} ${t.level}`.toLowerCase().includes(search.toLowerCase())
      ) {
        return false
      }
      return true
    })
  }, [items, search, category])

  // Categories dynamically derived from real data.
  const availableCategories = useMemo(() => {
    const set = new Set<string>(items.map((i: JobLibraryItem) => i.category))
    return CATEGORIES.filter(c => c.id === 'all' || set.has(c.id))
  }, [items])

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Job Library"
        description="Job descriptions your team has generated and saved — write a great one once, then reuse it for every new opening. Edit, fork, and version with confidence."
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <SparklesIcon className="h-3 w-3" />
            AI-generated
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setImportUrlOpen(true)}>
              <FileTextIcon className="h-4 w-4" />
              Import from URL
            </Button>
            <Button onClick={() => setNewTemplateOpen(true)}>
              <PlusIcon className="h-4 w-4" />
              New template
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="space-y-5 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1 lg:max-w-md">
              <SearchIcon className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by title, level, or skill…"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableCategories.map(c => {
                const active = c.id === category
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategory(c.id)}
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'bg-emerald-500 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700',
                    )}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400">
            {error
              ? error
              : loading
                ? 'Loading…'
                : `${filtered.length} of ${items.length} job description${items.length === 1 ? '' : 's'} · ${data?.templateCount ?? 0} marked as template${(data?.templateCount ?? 0) === 1 ? '' : 's'}`}
          </div>

          {!loading && !error && items.length === 0 ? (
            <EmptyState
              icon={FileTextIcon}
              title="No job descriptions yet"
              description="Generate your first job description with the AI Recruiter — saved descriptions will appear here automatically."
            />
          ) : filtered.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map(t => (
                <JobTemplateCard key={t.id} template={t} onShare={setShareJob} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={FileTextIcon}
              title="No job descriptions match"
              description="Try a different search or category, or generate a new one from the AI Recruiter."
            />
          )}
        </CardContent>
      </Card>

      <NewTemplateModal
        open={newTemplateOpen}
        onClose={() => setNewTemplateOpen(false)}
        onCreated={reload}
      />
      <ImportUrlModal
        open={importUrlOpen}
        onClose={() => setImportUrlOpen(false)}
        onImported={reload}
      />
      {shareJob && (
        <ShareModal
          open={!!shareJob}
          onClose={() => setShareJob(null)}
          jobId={shareJob.id}
          jobTitle={shareJob.title}
          initiallyEnabled={shareJob.publicEnabled}
          initialSlug={shareJob.publicSlug}
        />
      )}
    </div>
  )
}

function JobTemplateCard({ template, onShare }: { template: JobLibraryItem; onShare: (t: JobLibraryItem) => void }) {
  const router = useRouter()
  const updated = new Date(template.updatedAt)
  const updatedLabel = isNaN(updated.getTime())
    ? ''
    : `Updated ${updated.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`

  function useTemplate() {
    // Send the user to AI Recruiter with the template id pre-selected.
    // The AI Recruiter page reads ?template=<id> and pre-fills the form.
    router.push(`/ai-recruiter?template=${encodeURIComponent(template.id)}`)
  }

  return (
    <article
      className="group relative flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
      aria-label={`${template.title}${template.isTemplate ? ' (template)' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            {template.category}
          </span>
          <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-50">
            {template.title}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {template.level}
          </p>
        </div>
        <button
          type="button"
          aria-label="Star (coming soon)"
          disabled
          className="rounded-md p-1.5 text-slate-300 dark:text-slate-600"
        >
          <BookmarkIcon className="h-4 w-4" fill="none" />
        </button>
      </div>

      <p className="mt-3 line-clamp-3 text-sm text-slate-600 dark:text-slate-400">
        {template.description}
      </p>

      {template.skills.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {template.skills.slice(0, 6).map(s => (
            <span
              key={s}
              className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              {s}
            </span>
          ))}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-700/50">
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {updatedLabel}
          {template.isTemplate ? ' · Template' : ''}
          {template.publicEnabled ? ' · Public' : ''}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onShare?.(template)}
            aria-label={`Share ${template.title} publicly`}
          >
            <LinkIcon className="h-3.5 w-3.5" />
            {template.publicEnabled ? 'Link' : 'Share'}
          </Button>
          <Button variant="ghost" size="sm" onClick={useTemplate} aria-label={`Use ${template.title} as a starting point`}>
            <CopyIcon className="h-3.5 w-3.5" />
            Use
          </Button>
        </div>
      </div>
    </article>
  )
}
