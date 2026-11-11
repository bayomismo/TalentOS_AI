/**
 * Sprint 17.6 / Sprint 19 — Public job application server action.
 *
 * NO AUTH required. A public applicant never needs a TalentOS account.
 *
 * Sprint 19 (business-flow audit) changed four things here:
 *
 *   P1-11 / P2-31 — the requisition is no longer resolved with an
 *     unordered `take: 1` over DRAFT|OPEN|ON_HOLD. It is resolved through
 *     `JobDescription.publicHiringRequestId` (ONE deterministic binding per
 *     posting) with a deterministic fallback for postings created before
 *     the binding existed.
 *   P2-09 / P2-12 — a CLOSED, FILLED, DRAFT, ON_HOLD or unbound posting is
 *     refused instead of quietly accepting applications.
 *   P0-06 — a public application NEVER mutates an existing candidate. The
 *     recruiter-curated identity fields (name, phone, location, links,
 *     cover letter, source) and the pipeline stage are left exactly as
 *     they are. The application is recorded as its own `Application` row
 *     (the person × requisition record introduced by P1-16), which carries
 *     the per-application stage and the consent.
 *   P0-07 — because the public path can no longer overwrite a candidate's
 *     record, knowing a candidate's email address is no longer enough to
 *     tamper with it. The remaining, honest limitation — the applicant's
 *     EMAIL ADDRESS is not verified — is documented in the deliverable and
 *     mitigated by a per-email rate-limit bucket.
 *   P0-03 — the notification to the hiring team records what actually
 *     happened (`delivery`), and every user-facing promise about email is
 *     conditional on `isEmailDeliveryConfigured()`.
 *
 * Tenant isolation: the organization and the requisition are derived from
 * the public slug lookup, NEVER from any client input. The browser never
 * tells us which org or which hiring request.
 */
import 'server-only'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/auth/rate-limit'
import { parseCV, MAX_CV_BYTES, CVParseError, CVValidationError, type CVFileKind } from '@/lib/cv'
import { sendEmail, isEmailDeliveryConfigured } from '@/lib/email'
import { newPublicApplicationEmail } from '@/lib/email/templates'
import { getFileStorage } from '@/lib/storage'
import { resolvePublicRequisition, isAcceptingPublicState } from '@/app/(public)/_lib/public-requisition'
import { publicConsentText } from '@/app/(public)/_lib/consent'
import { absoluteUrl } from '@/app/(public)/_lib/origin'
import { applicationSchema, MAX_CV_BASE64_CHARS } from './apply-schema'

export interface SubmitPublicApplicationInput {
  jobSlug: string
  firstName: string
  lastName: string
  email: string
  phone?: string | null
  location?: string | null
  linkedinUrl?: string | null
  portfolioUrl?: string | null
  githubUrl?: string | null
  coverLetter?: string | null
  /** Optional CV — base64-encoded bytes + filename + mime type. */
  cv?: { dataBase64: string; fileName: string; mimeType: string } | null
  /** Honeypot — if filled, it's a bot. Must always be empty. */
  website?: string
  /** For consent checkbox. Must be exactly "on". */
  consent?: string
}

export type SubmitPublicApplicationResult =
  | {
      ok: true
      candidateId: string
      /** The Application row for this person × requisition, when one was created. */
      applicationId: string | null
      /** True when the submission landed on an application that already existed. */
      reapplication: boolean
      /** True when a real provider accepted the hiring-team notification. */
      emailDelivered: boolean
    }
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
const MAX_COVER_LETTER = 4000
const MAX_LOCATION = 200
const MAX_NAME = 80
const MAX_URL = 500

/**
 * Rate limits.
 *
 *   ATTEMPT bucket — every request, charged BEFORE the database work, so
 *   a bot cannot hammer the product. Generous (30/hour).
 *   APPLY bucket — only well-formed applications, charged once the input
 *   has been validated. This is the limit the applicant actually feels
 *   (5/hour), and an invalid submission no longer burns it.
 *   EMAIL bucket — per applicant address. Without it, a bot could rotate
 *   its IP and hammer ONE candidate's mailbox record (audit P2-08).
 */
const IP_ATTEMPT_LIMIT = 30
const IP_RATE_LIMIT = 5
const EMAIL_RATE_LIMIT = 10
const RATE_WINDOW_SEC = 60 * 60 // 1 hour

/** The refusal message for a posting whose requisition is not accepting. */
function closedMessage(state: string): string {
  switch (state) {
    case 'DRAFT':
      return 'This position is not open for applications yet.'
    case 'ON_HOLD':
      return 'This position is on hold and is not accepting applications right now.'
    case 'MISSING':
      return 'This position is not accepting applications.'
    default:
      return 'This position has been closed and is no longer accepting applications.'
  }
}

/**
 * The applicant's submitted details, stored on the Application row when
 * the person already exists in the organization.
 *
 * Why: the public path may not overwrite the recruiter-curated identity
 * fields of an existing candidate (audit P0-07). But the applicant still
 * has to be able to send us their details, and the recruiter still has to
 * be able to see what was submitted. The submitted values therefore live
 * on the APPLICATION record, which is the applicant's own artifact, while
 * the Candidate row stays the organization's canonical record.
 */
interface SubmittedContact {
  firstName: string
  lastName: string
  phone: string | null
  location: string | null
  linkedinUrl: string | null
  portfolioUrl: string | null
  githubUrl: string | null
  coverLetter: string | null
}

export async function submitPublicApplicationAction(
  input: SubmitPublicApplicationInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<SubmitPublicApplicationResult> {
  // 0. Structural gate — reject a malformed body before ANY work.
  //
  //    This is a shape + gross-size check only (an abuse ceiling, not a
  //    UX limit): it stops a hostile body from reaching the rate limiter,
  //    the database or the CV parser. The user-friendly per-field checks
  //    below still run and return their own error codes.
  const shape = applicationSchema.safeParse(input)
  if (!shape.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message:
        'Some of the details submitted were not in the expected format. Please check the form and try again.',
    }
  }

  // 1. Honeypot — bots fill all fields, including hidden ones.
  if (input.website && input.website.length > 0) {
    // Silently return success to avoid teaching the bot anything.
    return {
      ok: true,
      candidateId: '00000000-0000-0000-0000-000000000000',
      applicationId: null,
      reapplication: false,
      emailDelivered: false,
    }
  }

  // 2. Attempt bucket — charged for EVERY request, before any database
  //    work, so the endpoint cannot be used to hammer the product.
  const ip = meta.ip ?? 'unknown'
  const attempt = await rateLimit(`public-apply-attempt:${ip}`, IP_ATTEMPT_LIMIT, RATE_WINDOW_SEC)
  if (!attempt.ok) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: `You've submitted several applications recently. Please try again in ${Math.ceil(
        attempt.resetInSeconds / 60,
      )} minutes.`,
    }
  }

  // 3. Find the posting. The organization comes from the slug lookup —
  //    never from the client.
  const job = await db.jobDescription.findFirst({
    where: { publicSlug: input.jobSlug, publicEnabled: true },
    select: {
      id: true,
      title: true,
      organizationId: true,
      publicHiringRequestId: true,
      organization: { select: { name: true } },
    },
  })
  if (!job) {
    return {
      ok: false,
      code: 'JOB_NOT_FOUND',
      message: 'This job is no longer accepting applications.',
    }
  }

  // 4. Resolve the ONE requisition this posting belongs to (P1-11).
  //    A closed / out-of-capacity / draft / paused requisition refuses
  //    the application instead of accepting it (P2-09, P2-12, P2-31).
  //    See `app/(public)/_lib/public-requisition.ts` for exactly which
  //    states still hire — and why a FILLED requisition is not refused
  //    by the capacity rule.
  const resolution = await resolvePublicRequisition({
    id: job.id,
    organizationId: job.organizationId,
    publicHiringRequestId: job.publicHiringRequestId,
  })
  if (!isAcceptingPublicState(resolution.state) || !resolution.hiringRequest) {
    return {
      ok: false,
      code: 'JOB_CLOSED',
      message: closedMessage(resolution.state),
    }
  }
  const hiringRequest = resolution.hiringRequest

  // 5. Validate input.
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
  // The consent checkbox is enforced, not merely read (P2-07 / P0-08).
  if (input.consent !== 'on') {
    return {
      ok: false,
      code: 'MISSING_CONSENT',
      message: 'Please confirm you agree to share your information with the employer.',
    }
  }

  // 6. The applicant's own limits. Charged only now — after the input is
  //    known to be well-formed — so a typo no longer burns the quota.
  const ipBucket = await rateLimit(`public-apply:${ip}`, IP_RATE_LIMIT, RATE_WINDOW_SEC)
  if (!ipBucket.ok) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: `You've submitted several applications recently. Please try again in ${Math.ceil(
        ipBucket.resetInSeconds / 60,
      )} minutes.`,
    }
  }
  const emailBucket = await rateLimit(`public-apply:email:${email}`, EMAIL_RATE_LIMIT, RATE_WINDOW_SEC)
  if (!emailBucket.ok) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Too many applications from this email address. Please try again later.',
    }
  }

  // 7. Optional CV — parse to text. The original bytes are kept ONLY
  //    when a real file was uploaded.
  let parsedCV: {
    text: string
    fileName: string
    fileSize: number
    mimeType: string
    fileKind: CVFileKind
    buffer: Buffer
  } | null = null
  if (input.cv && input.cv.dataBase64) {
    // Reject an oversized base64 payload BEFORE decoding it. The
    // functional `MAX_CV_BYTES` check below only sees the decoded bytes,
    // and `Buffer.from` would already have materialised them — so a
    // 20 MB body of base64 would be decoded into memory first. This is
    // the exact base64 expansion of MAX_CV_BYTES, so anything longer
    // cannot possibly decode to an acceptable file.
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
        buffer,
      }
    } catch (err) {
      const message =
        err instanceof CVParseError || err instanceof CVValidationError
          ? err.message
          : 'Could not read your CV. Please upload a PDF or DOCX file.'
      return { ok: false, code: 'CV_PARSE_ERROR', message }
    }
  }

  // 8. Find or create the candidate.
  //
  //    P0-06 / P0-07: the public path NEVER updates an existing candidate.
  //    The row it finds is reused as-is (identity fields and pipeline
  //    stage untouched); only a genuinely new applicant gets a new row.
  //    Everything the applicant submitted is recorded on the Application.
  const existing = await db.candidate.findFirst({
    where: {
      organizationId: job.organizationId,
      email,
      hiringRequestId: hiringRequest.id,
    },
    select: { id: true, stage: true, firstName: true, lastName: true },
  })

  const source = `Public: ${job.title}`
  const sourceDetails = `Applied via /jobs/${input.jobSlug}${
    meta.ip ? ` from ${meta.ip}` : ''
  }`

  let candidateId: string
  let candidateFirstName: string
  let candidateLastName: string

  if (existing) {
    candidateId = existing.id
    // The recruiter-curated name — the applicant's own spelling is kept
    // on the Application record, never written over this row.
    candidateFirstName = existing.firstName
    candidateLastName = existing.lastName
  } else {
    const created = await db.candidate.create({
      data: {
        organizationId: job.organizationId,
        hiringRequestId: hiringRequest.id,
        firstName,
        lastName,
        email,
        phone,
        location,
        linkedinUrl,
        portfolioUrl,
        githubUrl,
        summary: coverLetter,
        source,
        sourceDetails,
        stage: 'APPLIED',
        status: 'ACTIVE',
      },
      select: { id: true, firstName: true, lastName: true },
    })
    candidateId = created.id
    candidateFirstName = created.firstName
    candidateLastName = created.lastName
  }

  // 9. The Application row — the person's application to THIS requisition
  //    (P1-16). It carries the consent (P2-07) and the applicant's own
  //    submitted details, so nothing the applicant sent is lost even
  //    though the recruiter-curated candidate row is not overwritten.
  const submitted: SubmittedContact = {
    firstName,
    lastName,
    phone,
    location,
    linkedinUrl,
    portfolioUrl,
    githubUrl,
    coverLetter,
  }
  const consentText = publicConsentText(job.organization.name)
  const applicationDetails = JSON.stringify({
    submittedContact: submitted,
    ...(existing ? { candidateStageAtApplication: existing.stage } : {}),
  })

  let applicationId: string | null = null
  let reapplication = existing !== null
  try {
    const application = await db.application.upsert({
      where: {
        candidateId_hiringRequestId: {
          candidateId,
          hiringRequestId: hiringRequest.id,
        },
      },
      // First application for this person × requisition: record it with
      // the consent the applicant just gave. The stage mirrors where the
      // person already stands, so the application list and the pipeline
      // board never disagree.
      create: {
        organizationId: job.organizationId,
        candidateId,
        hiringRequestId: hiringRequest.id,
        stage: existing ? existing.stage : 'APPLIED',
        source,
        sourceDetails: applicationDetails,
        consentAt: new Date(),
        consentText,
      },
      // A re-application must NOT reset the application: the consent
      // timestamp of the first submission and the application stage
      // stay exactly as they are (P0-06). The re-application itself is
      // recorded in the activity timeline below.
      update: {},
      select: { id: true },
    })
    applicationId = application.id
  } catch (err) {
    // The application record is the whole point of this endpoint — a
    // failure to write it must be visible, not swallowed.
    console.error('[public-apply] failed to record the Application row:', err)
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'We could not record your application. Please try again.',
    }
  }

  // 10. Persist the CV.
  //
  //     `storage.put()` is called ONLY when a real file was uploaded, and
  //     it lives in the SAME try/catch as the CVFile write: if the bytes
  //     cannot be stored, the metadata row is not written either, and the
  //     failure is reported instead of silently discarded (audit P0-04).
  let cvStored = false
  let cvBytesRetained = false
  if (parsedCV) {
    try {
      const storage = getFileStorage()
      const storageKey = `public-apply/${candidateId}/${parsedCV.fileName}`
      const stored = await storage.put(storageKey, parsedCV.buffer, parsedCV.mimeType)
      // `memory://` means the bytes live in the server process only and
      // are lost when it is recycled. The durable artifact of a CV is its
      // extracted text (stored below), so the URL says so explicitly
      // instead of pretending the file is downloadable.
      const isDurable = !stored.url.startsWith('memory://')
      const storageUrl = isDurable ? stored.url : `text-only://${stored.key}`
      cvBytesRetained = isDurable
      await db.cVFile.create({
        data: {
          // organizationId is derived from the candidate (which is already
          // tenant-scoped to job.organizationId). CVFile doesn't carry
          // organizationId directly — it inherits via candidate.
          candidateId,
          fileName: parsedCV.fileName,
          fileSize: parsedCV.fileSize,
          fileType: parsedCV.fileKind,
          mimeType: parsedCV.mimeType,
          storageUrl,
          storagePath: stored.key,
          parsedText: parsedCV.text,
          // parsedData is left null — the candidate workspace will run AI
          // analysis on demand. (Cheaper and faster than doing it here.)
        },
      })
      cvStored = true
    } catch (err) {
      // NOT swallowed: the application is still recorded, but the fact
      // that the file could not be stored is logged and recorded on the
      // activity row so a recruiter can see it.
      console.error('[public-apply] failed to store the CV file:', err)
    }
  }

  // 11. Log the activity. This is the recruiter-visible record of the
  //     application — including a re-application that did not move the
  //     candidate's stage.
  try {
    await db.activity.create({
      data: {
        organizationId: job.organizationId,
        candidateId,
        hiringRequestId: hiringRequest.id,
        // No actorId — this is a public application, no user did it.
        type: 'PUBLIC_APPLICATION',
        title: reapplication
          ? `Re-applied: ${firstName} ${lastName} → ${job.title}`
          : `Applied: ${firstName} ${lastName} → ${job.title}`,
        description: `Applied via public job link /jobs/${input.jobSlug}`,
        metadata: {
          jobSlug: input.jobSlug,
          jobTitle: job.title,
          ip: meta.ip,
          userAgent: meta.userAgent,
          hasCV: !!parsedCV,
          cvStored,
          cvBytesRetained,
          reapplication,
        },
      },
    })
  } catch (err) {
    console.error('[public-apply] failed to write the activity row:', err)
  }

  // 12. Notify the hiring team (P2-32: the hiring manager and the
  //     requisition's creator, not only the org ADMINs).
  //
  //     P0-03: the send is attempted through the configured provider and
  //     the outcome is recorded. When no delivery provider is configured
  //     the message is queued in the local outbox and NOT sent — the
  //     action reports that honestly instead of pretending it worked.
  let emailDelivered = false
  try {
    const recipients = await resolveNotificationRecipients({
      organizationId: job.organizationId,
      hiringRequestId: hiringRequest.id,
      hiringManagerId: hiringRequest.hiringManagerId,
      createdById: hiringRequest.createdById,
    })
    const workspaceUrl = await absoluteUrl(`/candidates/${candidateId}`)
    const coverExcerpt = coverLetter ? coverLetter.slice(0, 240) : null
    for (const recipient of recipients) {
      const tpl = newPublicApplicationEmail({
        to: recipient.email,
        recipientName: recipient.firstName,
        organizationName: job.organization.name,
        jobTitle: job.title,
        candidateName: `${candidateFirstName} ${candidateLastName}`,
        candidateEmail: email,
        candidateWorkspaceUrl: workspaceUrl,
        coverLetterExcerpt: coverExcerpt,
      })
      const result = await sendEmail({
        to: recipient.email,
        from: tpl.from,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
        kind: 'new_public_application',
        metadata: { candidateId, hiringRequestId: hiringRequest.id },
      })
      if (result.delivery === 'delivered') emailDelivered = true
    }
  } catch (err) {
    // A failed notification must never fail the application, but it must
    // never be invisible either (audit P0-03).
    console.error('[public-apply] failed to notify the hiring team:', err)
  }

  return { ok: true, candidateId, applicationId, reapplication, emailDelivered }
}

/**
 * The people who need to hear about a public application: the hiring
 * manager, the requisition's creator and the organization's admins —
 * de-duplicated. Audit P2-32: the old code notified `role: 'ADMIN'` only,
 * so the person actually running the requisition was often left in the
 * dark.
 */
async function resolveNotificationRecipients(input: {
  organizationId: string
  hiringRequestId: string
  hiringManagerId: string | null
  createdById: string
}): Promise<Array<{ email: string; firstName: string }>> {
  const recipients = new Map<string, { email: string; firstName: string }>()

  const who: Array<{ id: string }> = [{ id: input.createdById }]
  if (input.hiringManagerId) who.push({ id: input.hiringManagerId })

  const staff = await db.user.findMany({
    where: {
      organizationId: input.organizationId,
      status: 'ACTIVE',
      OR: [...who, { role: 'ADMIN' }],
    },
    select: { id: true, email: true, firstName: true },
  })
  for (const person of staff) {
    recipients.set(person.id, { email: person.email, firstName: person.firstName })
  }

  return Array.from(recipients.values())
}
