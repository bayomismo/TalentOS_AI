'use server'

/**
 * Candidate CV read actions.
 *
 * Audit P0-04 ("no recruiter can ever read a CV"): the parsed text of an
 * uploaded CV was persisted in `CVFile.parsedText` but rendered by NO
 * screen, and `CVFile.storageUrl` was a synthetic `memory://` URL that
 * pointed nowhere.
 *
 * This module is the server-side seam that fixes both halves:
 *   - it returns the PARSED TEXT so the candidate profile can render it,
 *   - it returns a RESOLVABLE download URL for the original bytes (or
 *     `null`, honestly, when the original was not retained).
 *
 * Tenant scoping: every read is filtered by the candidate's organization
 * through the foreign key (`candidate.organizationId`), not only by the
 * candidate id, so an id from another tenant can never be read.
 */

import { requirePermission } from '@/lib/auth'
import { db } from '@/lib/db'
import { getFileStorage } from '@/lib/storage'

/** Maximum characters of parsed CV text returned to the browser. */
const MAX_PARSED_TEXT_CHARS = 50_000

export interface CandidateCvDocument {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  mimeType: string | null
  uploadedAt: string
  /** The URL persisted on the row (may be a legacy `memory://` value). */
  storageUrl: string | null
  /** A URL the browser can actually open — `null` when the original bytes
   *  were not retained. */
  downloadUrl: string | null
  /** The extracted CV text — this is what the recruiter reads. */
  parsedText: string | null
}

export interface CandidateProfileContext {
  /** The candidate's real pipeline stage (REJECTED / WITHDRAWN included). */
  stage: string | null
  /** When the candidate reached a terminal stage (null when still active). */
  rejectedAt: string | null
  withdrawnAt: string | null
  hiredAt: string | null
  cvFiles: CandidateCvDocument[]
}

/**
 * Returns the CV documents of one candidate: the parsed text and a
 * resolvable download URL for the original file.
 *
 * Returns `null` when the caller may not read this candidate at all.
 */
export async function getCandidateProfileContextAction(
  candidateId: string
): Promise<CandidateProfileContext | null> {
  const auth = await requirePermission('cv.view')
  if (!auth.ok) return null

  const orgId = auth.data.organizationId
  const userId = auth.data.userId
  const role = auth.data.role

  const candidate = await db.candidate.findFirst({
    where: { id: candidateId, organizationId: orgId },
    select: { id: true, stage: true, rejectedAt: true, withdrawnAt: true, hiredAt: true },
  })
  if (!candidate) return null

  // INTERVIEWERs may only read the CV of a candidate they interview.
  if (role === 'INTERVIEWER') {
    const assigned = await db.interview.findFirst({
      where: {
        candidateId,
        organizationId: orgId,
        participants: { some: { userId } },
      },
      select: { id: true },
    })
    if (!assigned) return null
  }

  const rows = await db.cVFile.findMany({
    where: {
      candidateId,
      candidate: { organizationId: orgId },
    },
    orderBy: { uploadedAt: 'desc' },
    select: {
      id: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      mimeType: true,
      uploadedAt: true,
      storageUrl: true,
      storagePath: true,
      parsedText: true,
    },
  })

  const storage = getFileStorage()
  const cvFiles: CandidateCvDocument[] = []
  for (const row of rows) {
    let downloadUrl: string | null = null
    if (row.storagePath) {
      try {
        const candidateUrl = await storage.getDownloadUrl(row.storagePath)
        // `memory://` is not addressable by a browser — the bytes are gone.
        downloadUrl = candidateUrl && !candidateUrl.startsWith('memory://') ? candidateUrl : null
      } catch {
        downloadUrl = null
      }
    }
    cvFiles.push({
      id: row.id,
      fileName: row.fileName,
      fileType: row.fileType,
      fileSize: row.fileSize,
      mimeType: row.mimeType,
      uploadedAt: row.uploadedAt.toISOString(),
      storageUrl: row.storageUrl,
      downloadUrl,
      parsedText: row.parsedText ? row.parsedText.slice(0, MAX_PARSED_TEXT_CHARS) : null,
    })
  }

  return {
    stage: candidate.stage,
    rejectedAt: candidate.rejectedAt ? candidate.rejectedAt.toISOString() : null,
    withdrawnAt: candidate.withdrawnAt ? candidate.withdrawnAt.toISOString() : null,
    hiredAt: candidate.hiredAt ? candidate.hiredAt.toISOString() : null,
    cvFiles,
  }
}
