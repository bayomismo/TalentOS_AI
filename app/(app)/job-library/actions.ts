'use server'

/**
 * Job Library data actions.
 *
 * Returns the organization's saved JobDescription entries (both
 * templates and one-offs). Tenant-scoped via requireAuth().
 *
 * Also exposes `createJobTemplateAction` and `importJobFromUrlAction`
 * to back the "New template" and "Import from URL" buttons that were
 * previously dead (Sprint 15 P1 sweep — job-library branch).
 */

import { db } from '@/lib/db'
import { requireAuth, requirePermission } from '@/lib/auth'
import { z } from 'zod'
import { recordAuditLog } from '@/lib/auth/audit'
import { rateLimit } from '@/lib/auth/rate-limit'

export interface JobLibraryItem {
  id: string
  title: string
  category: string
  level: string
  description: string
  skills: string[]
  isTemplate: boolean
  updatedAt: string
  publicEnabled: boolean
  publicSlug: string | null
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
      publicEnabled: true,
      publicSlug: true,
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
    publicEnabled: r.publicEnabled,
    publicSlug: r.publicSlug,
    updatedAt: r.updatedAt.toISOString(),
    }
  })

  return {
    items,
    totalCount: items.length,
    templateCount: items.filter(i => i.isTemplate).length,
  }
}

// ---------------------------------------------------------------------------
// createJobTemplateAction
// ---------------------------------------------------------------------------

const newTemplateSchema = z.object({
  title: z.string().trim().min(2, 'Title is required (min 2 chars).').max(200),
  level: z.enum(['JUNIOR', 'MID', 'SENIOR', 'STAFF', 'PRINCIPAL', 'LEAD']),
  category: z.string().trim().min(1, 'Category is required.').max(80),
  summary: z.string().trim().min(10, 'Summary is required (min 10 chars).').max(500),
  description: z.string().trim().min(10, 'Description is required (min 10 chars).').max(8000),
  requiredSkills: z.string().trim().max(500).optional().transform(v => v ?? ''),
})

export type CreateJobTemplateResult =
  | { ok: true; id: string }
  | { ok: false; error: { code: string; message: string } }

export async function createJobTemplateAction(
  input: unknown,
): Promise<CreateJobTemplateResult> {
  // Sprint 18 audit — was requireAuth(); now requirePermission so
  // VIEWER/INTERVIEWER cannot create job templates.
  const auth = await requirePermission('hiring_request.create')
  if (!auth.ok) {
    return { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } }
  }

  const parsed = newTemplateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: parsed.error.issues[0]?.message ?? 'Invalid input.',
      },
    }
  }
  const { title, level, category, summary, description, requiredSkills } = parsed.data

  const rl = rateLimit(`create_template:${auth.data.organizationId}`, 20, 60 * 60)
  if (!rl.ok) {
    return {
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'Too many templates created. Try again in an hour.' },
    }
  }

  const skills = requiredSkills
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length < 40)
    .slice(0, 20)

  const row = await db.jobDescription.create({
    data: {
      organizationId: auth.data.organizationId,
      title,
      level,
      summary,
      description,
      requiredSkills: skills,
      isTemplate: true,
    },
  })

  await recordAuditLog({
    organizationId: auth.data.organizationId,
    actorId: auth.data.userId,
    action: 'JOB_TEMPLATE_CREATED' as never,
    targetType: 'jobDescription',
    targetId: row.id,
    outcome: 'success',
    metadata: { title, category } as any,
  }).catch(() => null)

  return { ok: true, id: row.id }
}

// ---------------------------------------------------------------------------
// importJobFromUrlAction
// ---------------------------------------------------------------------------

const importUrlSchema = z.object({
  url: z.string().url('Please enter a valid URL (https://…).').max(500),
})

export type ImportJobFromUrlResult =
  | { ok: true; id: string; title: string; extracted: { description: string; skills: string[] } }
  | { ok: false; error: { code: string; message: string } }

const FETCH_TIMEOUT_MS = 8000
const MAX_HTML_BYTES = 1_500_000 // 1.5 MB cap on the HTML we pull

function extractFromHtml(html: string, url: string): {
  title: string
  description: string
  skills: string[]
} {
  // Title — prefer <meta property="og:title">, then <title>
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const title = (ogTitle?.[1] ?? titleTag?.[1] ?? '').trim()
    .replace(/\s+/g, ' ')
    .slice(0, 200)

  // Description — prefer <meta property="og:description">, then description, then meta name=description
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
  const descTag = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
  const description = (ogDesc?.[1] ?? descTag?.[1] ?? '').trim()
    .replace(/\s+/g, ' ')
    .slice(0, 500)

  // Body text — strip script/style/nav/footer/header, then HTML tags, then collapse whitespace
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const body = bodyMatch?.[1] ?? html
  const cleaned = body
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

  // Look for a "Requirements" or "What you'll need" section for skills
  const skills = new Set<string>()
  const reqMatch = cleaned.match(
    /(?:requirements|qualifications|what you['']ll need|what we['']re looking for|must have)[:\s]+(.{100,2000}?)(?:responsibilities|what you['']ll do|nice to have|about the role|perks|$)/i,
  )
  if (reqMatch) {
    const tokens = reqMatch[1]
      .split(/[,\n•·;]/)
      .map(s => s.trim().replace(/^[-–—•·\s]+/, '').replace(/\.$/, ''))
      .filter(s => s.length >= 2 && s.length <= 40 && !/^(and|or|with|the|a|an)$/i.test(s))
    for (const t of tokens.slice(0, 20)) skills.add(t)
  }

  return { title, description, skills: Array.from(skills) }
}

function extractHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').split('.')[0]
  } catch {
    return 'Imported'
  }
}

export async function importJobFromUrlAction(
  input: unknown,
): Promise<ImportJobFromUrlResult> {
  // Sprint 18 audit — was requireAuth(); now requirePermission so
  // VIEWER/INTERVIEWER cannot import jobs from URLs.
  const auth = await requirePermission('hiring_request.create')
  if (!auth.ok) {
    return { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } }
  }

  const parsed = importUrlSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'INVALID_URL',
        message: parsed.error.issues[0]?.message ?? 'Invalid URL.',
      },
    }
  }
  const { url } = parsed.data

  const rl = rateLimit(`import_url:${auth.data.organizationId}`, 30, 60 * 60)
  if (!rl.ok) {
    return {
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'Too many imports. Try again in an hour.' },
    }
  }

  // Fetch with timeout
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let html = ''
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TalentOS-AI/1.0; +https://talentos-ai.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })
    if (!res.ok) {
      return {
        ok: false,
        error: { code: 'FETCH_FAILED', message: `Failed to fetch URL (HTTP ${res.status}).` },
      }
    }
    // Cap the read
    const reader = res.body?.getReader()
    if (!reader) {
      html = await res.text()
    } else {
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        total += value.byteLength
        if (total > MAX_HTML_BYTES) {
          await reader.cancel()
          return {
            ok: false,
            error: {
              code: 'TOO_LARGE',
              message: 'The page is too large to import (over 1.5 MB).',
            },
          }
        }
        chunks.push(value)
      }
      const decoder = new TextDecoder('utf-8')
      html = chunks.map(c => decoder.decode(c, { stream: true })).join('') + decoder.decode()
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'FETCH_ERROR',
        message: err instanceof Error ? `Could not fetch URL: ${err.message}` : 'Could not fetch URL.',
      },
    }
  } finally {
    clearTimeout(timeout)
  }

  const { title, description, skills } = extractFromHtml(html, url)
  if (!title && !description) {
    return {
      ok: false,
      error: {
        code: 'NO_CONTENT',
        message: "We couldn't extract a title or description from that page. Try copying the job text manually instead.",
      },
    }
  }

  const finalTitle = title || `Imported from ${extractHost(url)}`
  const body = description || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000)
  const summary = description.slice(0, 220) || body.slice(0, 220)

  const row = await db.jobDescription.create({
    data: {
      organizationId: auth.data.organizationId,
      title: finalTitle,
      level: 'MID',
      summary: summary || finalTitle,
      description: body,
      requiredSkills: skills,
      isTemplate: true,
    },
  })

  await recordAuditLog({
    organizationId: auth.data.organizationId,
    actorId: auth.data.userId,
    action: 'JOB_TEMPLATE_IMPORTED' as never,
    targetType: 'jobDescription',
    targetId: row.id,
    outcome: 'success',
    metadata: { sourceUrl: url, extractedSkills: skills.length } as any,
  }).catch(() => null)

  return {
    ok: true,
    id: row.id,
    title: finalTitle,
    extracted: { description: body, skills },
  }
}


// ---------------------------------------------------------------------------
// Public posting (Sprint 17)
// ---------------------------------------------------------------------------

/**
 * Enable public posting of a job. Generates a random URL-safe slug.
 * Once enabled, the job is reachable at /jobs/[slug] by anyone.
 *
 * Returns the public URL (relative — caller prepends the app origin).
 */
export async function enablePublicPostingAction(
  jobId: string,
): Promise<{ ok: true; slug: string; url: string } | { ok: false; error: string }> {
  // Sprint 18 audit — was requireAuth(); now requirePermission so
  // VIEWER/INTERVIEWER cannot flip a job to public.
  const auth = await requirePermission('hiring_request.edit')
  if (!auth.ok) return { ok: false, error: 'Unauthenticated' }

  // Verify ownership
  const job = await db.jobDescription.findFirst({
    where: { id: jobId, organizationId: auth.data.organizationId },
    select: { id: true, publicSlug: true, publicEnabled: true },
  })
  if (!job) return { ok: false, error: 'Job not found' }

  // Reuse existing slug if already enabled
  if (job.publicSlug && job.publicEnabled) {
    return { ok: true, slug: job.publicSlug, url: `/jobs/${job.publicSlug}` }
  }

  const { randomBytes } = await import('node:crypto')
  const slug = randomBytes(12).toString('base64url')

  await db.jobDescription.update({
    where: { id: jobId },
    data: { publicSlug: slug, publicEnabled: true, publicPostedAt: new Date() },
  })

  await recordAuditLog({
    organizationId: auth.data.organizationId,
    actorId: auth.data.userId,
    action: 'JOB_PUBLIC_POSTING_ENABLED' as never,
    targetType: 'jobDescription',
    targetId: jobId,
    outcome: 'success',
    metadata: { slug } as any,
  }).catch(() => null)

  return { ok: true, slug, url: `/jobs/${slug}` }
}

export async function disablePublicPostingAction(
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Sprint 18 audit — was requireAuth(); now requirePermission so
  // VIEWER/INTERVIEWER cannot unpublish a job.
  const auth = await requirePermission('hiring_request.edit')
  if (!auth.ok) return { ok: false, error: 'Unauthenticated' }

  const job = await db.jobDescription.findFirst({
    where: { id: jobId, organizationId: auth.data.organizationId },
    select: { id: true },
  })
  if (!job) return { ok: false, error: 'Job not found' }

  await db.jobDescription.update({
    where: { id: jobId },
    data: { publicEnabled: false },
  })

  await recordAuditLog({
    organizationId: auth.data.organizationId,
    actorId: auth.data.userId,
    action: 'JOB_PUBLIC_POSTING_DISABLED' as never,
    targetType: 'jobDescription',
    targetId: jobId,
    outcome: 'success',
  }).catch(() => null)

  return { ok: true }
}
