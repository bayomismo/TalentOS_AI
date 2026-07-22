'use server'

/**
 * Job Library data actions.
 *
 * Returns the organization's saved JobDescription entries (both
 * templates and one-offs). Tenant-scoped via requireAuth().
 */

import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export interface JobLibraryItem {
  id: string
  title: string
  category: string
  level: string
  description: string
  skills: string[]
  isTemplate: boolean
  updatedAt: string
}

export interface JobLibraryData {
  items: JobLibraryItem[]
  totalCount: number
  templateCount: number
}

const EMPTY: JobLibraryData = { items: [], totalCount: 0, templateCount: 0 }

export async function getJobLibraryAction(): Promise<JobLibraryData> {
  const auth = await requireAuth()
  if (!auth.ok) return EMPTY
  const orgId = auth.data.organizationId

  const rows = await db.jobDescription.findMany({
    where: { organizationId: orgId },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      title: true,
      level: true,
      summary: true,
      description: true,
      requiredSkills: true,
      isTemplate: true,
      updatedAt: true,
      hiringRequests: {
        take: 1,
        select: { department: { select: { name: true } } },
      },
    },
  })

  const items: JobLibraryItem[] = rows.map(r => {
    const dept = r.hiringRequests[0]?.department?.name ?? 'General'
    return {
    id: r.id,
    title: r.title,
    category: dept,
    level: r.level,
    description: r.summary ?? r.description.slice(0, 220),
    skills: r.requiredSkills,
    isTemplate: r.isTemplate,
    updatedAt: r.updatedAt.toISOString(),
    }
  })

  return {
    items,
    totalCount: items.length,
    templateCount: items.filter(i => i.isTemplate).length,
  }
}
