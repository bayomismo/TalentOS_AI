'use client'

import { useMemo, useState } from 'react'
import { BookmarkIcon, CopyIcon, FileTextIcon, PlusIcon, SearchIcon, SparklesIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'
import { cn } from '@/lib/utils'

type JobCategory = 'Engineering' | 'Product' | 'Design' | 'Data' | 'Operations'

interface JobTemplate {
  id: string
  title: string
  category: JobCategory
  level: string
  description: string
  skills: string[]
  starred?: boolean
  updated: string
}

const TEMPLATES: JobTemplate[] = [
  {
    id: 'tpl-001',
    title: 'Senior Frontend Developer',
    category: 'Engineering',
    level: 'Senior (IC4)',
    description: 'Lead UI architecture for customer-facing product surfaces, mentor engineers, and ship polished experiences.',
    skills: ['React', 'TypeScript', 'Next.js', 'CSS'],
    starred: true,
    updated: 'Updated 2 days ago',
  },
  {
    id: 'tpl-002',
    title: 'Backend Engineer',
    category: 'Engineering',
    level: 'Mid (IC3)',
    description: 'Build resilient APIs, services, and data pipelines that power TalentOS for thousands of customers.',
    skills: ['Node.js', 'PostgreSQL', 'AWS', 'GraphQL'],
    updated: 'Updated 5 days ago',
  },
  {
    id: 'tpl-003',
    title: 'Product Manager — Growth',
    category: 'Product',
    level: 'Senior',
    description: 'Own activation, conversion, and retention experiments end-to-end.',
    skills: ['Experimentation', 'Analytics', 'SQL', 'Strategy'],
    updated: 'Updated last week',
  },
  {
    id: 'tpl-004',
    title: 'Senior Product Designer',
    category: 'Design',
    level: 'Senior',
    description: 'Shape end-to-end experiences and evolve the TalentOS design system.',
    skills: ['Figma', 'Design Systems', 'Prototyping', 'Research'],
    updated: 'Updated 3 days ago',
  },
  {
    id: 'tpl-005',
    title: 'Data Scientist',
    category: 'Data',
    level: 'Mid (IC3)',
    description: 'Partner with product to build models that surface hiring insights and predict outcomes.',
    skills: ['Python', 'SQL', 'Modeling', 'Experimentation'],
    updated: 'Updated yesterday',
  },
  {
    id: 'tpl-006',
    title: 'DevOps Engineer',
    category: 'Engineering',
    level: 'Senior',
    description: 'Own developer experience, CI/CD, observability, and platform reliability.',
    skills: ['Kubernetes', 'Terraform', 'AWS', 'CI/CD'],
    updated: 'Updated 2 weeks ago',
  },
  {
    id: 'tpl-007',
    title: 'People Operations Lead',
    category: 'Operations',
    level: 'Lead',
    description: 'Build the engine that lets our team do the best work of their careers.',
    skills: ['HR', 'Operations', 'Strategy', 'Coaching'],
    updated: 'Updated 3 weeks ago',
  },
  {
    id: 'tpl-008',
    title: 'Staff Data Engineer',
    category: 'Data',
    level: 'Staff',
    description: 'Architect our data platform, from ingestion to warehouse to product-facing APIs.',
    skills: ['Spark', 'dbt', 'Snowflake', 'Airflow'],
    updated: 'Updated 1 month ago',
  },
]

const CATEGORIES: { id: 'all' | JobCategory; label: string }[] = [
  { id: 'all', label: 'All categories' },
  { id: 'Engineering', label: 'Engineering' },
  { id: 'Product', label: 'Product' },
  { id: 'Design', label: 'Design' },
  { id: 'Data', label: 'Data' },
  { id: 'Operations', label: 'Operations' },
]

export default function JobLibraryPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<'all' | JobCategory>('all')

  const filtered = useMemo(() => {
    return TEMPLATES.filter(t => {
      if (category !== 'all' && t.category !== category) return false
      if (
        search &&
        !`${t.title} ${t.category} ${t.level}`.toLowerCase().includes(search.toLowerCase())
      ) {
        return false
      }
      return true
    })
  }, [search, category])

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Job Library"
        description="A curated set of role templates — write a great job description once, then reuse it for every new opening. Edit, fork, and version with confidence."
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <SparklesIcon className="h-3 w-3" />
            AI-ready templates
          </span>
        }
        actions={
          <>
            <Button variant="outline">
              <FileTextIcon className="h-4 w-4" />
              Import from URL
            </Button>
            <Button>
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
                placeholder="Search templates by title, level, or skill…"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map(c => {
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
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                    )}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400">
            {filtered.length} of {TEMPLATES.length} templates
          </div>

          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map(t => (
                <JobTemplateCard key={t.id} template={t} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={FileTextIcon}
              title="No templates match"
              description="Try a different search or category, or create a new template to get started."
              actions={
                <Button>
                  <PlusIcon className="h-4 w-4" />
                  New template
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function JobTemplateCard({ template }: { template: JobTemplate }) {
  return (
    <article className="group relative flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
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
          aria-label={template.starred ? 'Unstar' : 'Star'}
          className={cn(
            'rounded-md p-1.5 transition-colors',
            template.starred
              ? 'text-amber-500'
              : 'text-slate-300 hover:text-amber-500 dark:text-slate-600'
          )}
        >
          <BookmarkIcon
            className="h-4 w-4"
            fill={template.starred ? 'currentColor' : 'none'}
          />
        </button>
      </div>

      <p className="mt-3 line-clamp-3 text-sm text-slate-600 dark:text-slate-400">
        {template.description}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {template.skills.map(s => (
          <span
            key={s}
            className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            {s}
          </span>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-700/50">
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {template.updated}
        </span>
        <Button variant="ghost" size="sm">
          <CopyIcon className="h-3.5 w-3.5" />
          Use template
        </Button>
      </div>
    </article>
  )
}
