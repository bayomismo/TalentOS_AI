/**
 * Sprint 17.6 — Public job application server action.
 *
 * NO AUTH required. Anyone (even a candidate with no TalentOS account)
 * can apply to a public job by submitting this form. The flow:
 *
 *   1. Honeypot + rate limit + validation (cheap, fail fast)
 *   2. Find the job by publicSlug (and confirm publicEnabled)
 *   3. Find-or-create Candidate by (organizationId, email) within the
 *      same org. Existing candidates get their stage reset to APPLIED
 *      and the source updated to "Public: [Job Title]".
 *   4. If a CV was uploaded, parse it (PDF or pasted text) and create
 *      a CVFile row with parsedText + filename + size. Original bytes
 *      are NOT stored — only the extracted text. (Memory storage is
 *      dev-only; for prod we don't add Vercel Blob in v1.)
 *   5. Log an Activity (best-effort, non-blocking).
 *   6. Send a notification email to each org ADMIN (best-effort,
 *      non-blocking — failure to email does not fail the application).
 *   7. Return success.
 *
 * Tenant isolation: derived from the public slug lookup, NEVER from
 * any client input. The browser never tells us which org or which
 * hiring request.
 *
 * Idempotency: not strictly idempotent (each submit creates activity
 * and emails), but rate-limited so bots can't spam.
 *
 * AI auto-analysis: NOT triggered here. The team can click "Analyze"
 * on the candidate page when they're ready.
 */
import 'server-only'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/auth/rate-limit'
import { parseCV, MAX_CV_BYTES, CVParseError, CVValidationError } from '@/lib/cv'
import { sendEmail } from '@/lib/email'
import { newPublicApplicationEmail } from '@/lib/email/templates'
import { applicationSchema, MAX_CV_BASE64_CHARS, type SubmitPublicApplicationInput } from './apply-schema'

export type { SubmitPublicApplicationInput }

export type SubmitPublicApplicationResult =
  | { ok: true; candidateId: string }
  | {
      ok: false
      code:
        | 'RATE_LIMITED'
        | 'JOB_NOT_FOUND'
        | 'JOB_CLOSED'
        | 'INVALID_INPUT'
        | 'INVALID_EMAIL'
        | 'MISSING_CONSENT'
        | 'CV_TOO_LARGE'
        | 'CV_PARSE_ERROR'
        | 'INTERNAL'
      message: string
    }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FREE_EMAIL_DOMAINS = new Set([
  // Used as a soft check — NOT to block, just to flag in source.
  // (Free-email candidates are usually fine; we don't reject them.)
])
const MAX_COVER_LETTER = 4000
const MAX_LOCATION = 200
const MAX_NAME = 80
const MAX_URL = 500
const IP_RATE_LIMIT = 5
const IP_RATE_WINDOW_SEC = 60 * 60 // 1 hour

export async function submitPublicApplicationAction(
  rawInput: unknown,
  meta: { ip: string | null; userAgent: string | null },
): Promise<SubmitPublicApplicationResult> {
  // 0. Structural validation — reject malformed bodies before any work.
  const parsed = applicationSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Some of the details submitted were not in the expected format. Please check the form and try again.',
    }
  }
  const input = parsed.data

  // 1. Honeypot — bots fill all fields, including hidden ones.
  if (input.website && input.website.length > 0) {
    // Silently return success to avoid teaching the bot anything.
    return { ok: true, candidateId: '00000000-0000-0000-0000-000000000000' }
  }

  // 2. Rate limit by IP
  const ip = meta.ip ?? 'unknown'
  const rl = await rateLimit(`public-apply:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_SEC)
  if (!rl.ok) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: `You've submitted several applications recently. Please try again in ${Math.ceil(rl.resetInSeconds / 60)} minutes.`,
    }
  }

  // 3. Find the job + its related hiring request
  const job = await db.jobDescription.findFirst({
    where: { publicSlug: input.jobSlug, publicEnabled: true },
    select: {
      id: true,
      title: true,
      organizationId: true,
      organization: { select: { name: true } },
      hiringRequests: {
        where: { status: { in: ['DRAFT', 'OPEN', 'ON_HOLD'] } },
        select: { id: true, status: true },
        take: 1,
      },
    },
  })
  if (!job) {
    return {
      ok: false,
      code: 'JOB_NOT_FOUND',
      message: 'This job is no longer accepting applications.',
    }
  }
  const hiringRequest = job.hiringRequests[0]
  if (!hiringRequest) {
    return {
      ok: false,
      code: 'JOB_CLOSED',
      message: 'This position has been closed. Thanks for your interest!',
    }
  }

  // 4. Validate input
  const firstName = (input.firstName ?? '').trim()
  const lastName = (input.lastName ?? '').trim()
  const email = (input.email ?? '').trim().toLowerCase()
  const phone = (input.phone ?? '').trim() || null
  const location = (input.location ?? '').trim().slice(0, MAX_LOCATION) || null
  const linkedinUrl = (input.linkedinUrl ?? '').trim().slice(0, MAX_URL) || null
  const portfolioUrl = (input.portfolioUrl ?? '').trim().slice(0, MAX_URL) || null
  const githubUrl = (input.githubUrl ?? '').trim().slice(0, MAX_URL) || null
  const coverLetter = (input.coverLetter ?? '').trim().slice(0, MAX_COVER_LETTER) || null

  if (firstName.length === 0 || firstName.length > MAX_NAME) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Please enter your first name.' }
  }
  if (lastName.length === 0 || lastName.length > MAX_NAME) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Please enter your last name.' }
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, code: 'INVALID_EMAIL', message: 'Please enter a valid email address.' }
  }
  if (input.consent !== 'on') {
    return {
      ok: false,
      code: 'MISSING_CONSENT',
      message: 'Please confirm you agree to share your information with the employer.',
    }
  }

  // 5. Optional URL sanity checks (light — just length + leading char)
  const looksLikeUrl = (s: string) => /^https?:\/\//i.test(s) || s.startsWith('www.')
  if (linkedinUrl && !looksLikeUrl(linkedinUrl) && !linkedinUrl.includes('linkedin.com')) {
    // be lenient: just store whatever they typed
  }

  // 6. Optional CV — parse to text
  let parsedCV: { text: string; fileName: string; fileSize: number; mimeType: string; fileKind: 'PDF' | 'DOCX' } | null = null
  if (input.cv && input.cv.dataBase64) {
    // Reject oversized payloads BEFORE decoding — `Buffer.from` on a huge
    // base64 string would allocate the decoded bytes in memory first.
    if (input.cv.dataBase64.length > MAX_CV_BASE64_CHARS) {
      return {
        ok: false,
        code: 'CV_TOO_LARGE',
        message: `CV is too large. Maximum size is ${Math.round(MAX_CV_BYTES / 1024 / 1024)}MB.`,
      }
    }
    try {
      const buffer = Buffer.from(input.cv.dataBase64, 'base64')
      if (buffer.length > MAX_CV_BYTES) {
        return {
          ok: false,
          code: 'CV_TOO_LARGE',
          message: `CV is too large. Maximum size is ${Math.round(MAX_CV_BYTES / 1024 / 1024)}MB.`,
        }
      }
      const parsed = await parseCV({
        buffer,
        fileName: input.cv.fileName,
        mimeType: input.cv.mimeType,
      })
      parsedCV = {
        text: parsed.text,
        fileName: parsed.fileName,
        fileSize: parsed.size,
        mimeType: parsed.mimeType ?? input.cv.mimeType,
        fileKind: parsed.fileKind,
      }
    } catch (err) {
      const message =
        err instanceof CVParseError || err instanceof CVValidationError
          ? err.message
          : 'Could not read your CV. Please paste the text instead, or upload a different file.'
      const code = err instanceof CVValidationError ? 'CV_PARSE_ERROR' : 'CV_PARSE_ERROR'
      return { ok: false, code, message }
    }
  }

  // 7. Find or create the candidate
  // One Candidate per (organizationId, email, hiringRequestId). A repeat
  // application to the same job (double submit, or two concurrent
  // requests) updates the existing row instead of creating a duplicate
  // or 500ing.
  //
  // Prisma normally compiles this upsert to `INSERT ... ON CONFLICT DO
  // UPDATE` on the `@@unique([organizationId, email, hiringRequestId])`
  // constraint. If it falls back to emulated find-then-write, a
  // concurrent first-time insert can still raise P2002 — the catch
  // below turns that race into the intended update.
  const source = `Public: ${job.title}`
  const sourceDetails = `Applied via /jobs/${input.jobSlug}${meta.ip ? ` from ${meta.ip}` : ''}`

  const uniqueWhere = {
    organizationId_email_hiringRequestId: {
      organizationId: job.organizationId,
      email,
      hiringRequestId: hiringRequest.id,
    },
  }
  const commonData = {
    firstName,
    lastName,
    phone,
    location,
    linkedinUrl,
    portfolioUrl,
    githubUrl,
    source,
    sourceDetails,
    stage: 'APPLIED' as const,
    status: 'ACTIVE' as const,
  }
  // On update, don't clear an existing summary when this submit has no
  // cover letter; on create, store it as-is (may be null).
  const updateData = { ...commonData, summary: coverLetter ?? undefined }
  const createData = {
    ...commonData,
    organizationId: job.organizationId,
    hiringRequestId: hiringRequest.id,
    email,
    summary: coverLetter,
  }
  const candidateSelect = { id: true, firstName: true, lastName: true, email: true }

  let candidate
  try {
    candidate = await db.candidate.upsert({
      where: uniqueWhere,
      update: updateData,
      create: createData,
      select: candidateSelect,
    })
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') {
      candidate = await db.candidate.update({ where: uniqueWhere, data: updateData, select: candidateSelect })
    } else {
      throw err
    }
  }

  // 8. Persist the CV if provided (parsed text only, not the file)
  if (parsedCV) {
    try {
      await db.cVFile.create({
        data: {
          // organizationId is derived from the candidate (which is already
          // tenant-scoped to job.organizationId). CVFile doesn't carry
          // organizationId directly — it inherits via candidate.
          candidateId: candidate.id,
          fileName: parsedCV.fileName,
          fileSize: parsedCV.fileSize,
          fileType: parsedCV.fileKind,
          mimeType: parsedCV.mimeType,
          storageUrl: `memory://public-apply/${candidate.id}/${parsedCV.fileName}`,
          storagePath: `public-apply/${candidate.id}/${parsedCV.fileName}`,
          parsedText: parsedCV.text,
          // parsedData is left null — the candidate workspace will run AI
          // analysis on demand. (Cheaper and faster than doing it here.)
        },
      })
    } catch {
      // CV persistence is best-effort. The application is still recorded.
    }
  }

  // 9. Log the activity (best-effort)
  try {
    await db.activity.create({
      data: {
        organizationId: job.organizationId,
        candidateId: candidate.id,
        hiringRequestId: hiringRequest.id,
        // No actorId — this is a public application, no user did it.
        type: 'PUBLIC_APPLICATION',
        title: `Applied: ${firstName} ${lastName} → ${job.title}`,
        description: `Applied via public job link /jobs/${input.jobSlug}`,
        metadata: {
          jobSlug: input.jobSlug,
          jobTitle: job.title,
          ip: meta.ip,
          userAgent: meta.userAgent,
          hasCV: !!parsedCV,
        },
      },
    })
  } catch {
    // Activity log is best-effort
  }

  // 10. Notify org admins (best-effort, non-blocking)
  try {
    const admins = await db.user.findMany({
      where: {
        organizationId: job.organizationId,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
      select: { email: true, firstName: true },
    })
    const workspaceUrl = `${process.env.APP_URL ?? 'https://talentos-ai-lime.vercel.app'}/candidates/${candidate.id}`
    const coverExcerpt = coverLetter ? coverLetter.slice(0, 240) : null
    for (const admin of admins) {
      const tpl = newPublicApplicationEmail({
        to: admin.email,
        recipientName: admin.firstName,
        organizationName: job.organization.name,
        jobTitle: job.title,
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        candidateEmail: candidate.email,
        candidateWorkspaceUrl: workspaceUrl,
        coverLetterExcerpt: coverExcerpt,
      })
      await sendEmail({
        to: admin.email,
        from: tpl.from,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
        kind: 'new_public_application',
      })
    }
  } catch {
    // Notifications are best-effort
  }

  return { ok: true, candidateId: candidate.id }
}
