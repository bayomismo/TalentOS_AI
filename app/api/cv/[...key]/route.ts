/**
 * GET /api/cv/[...key] — serve the ORIGINAL bytes of a stored CV.
 *
 * Audit P0-04: `CVFile.storageUrl` used to be a synthetic `memory://` URL
 * that pointed nowhere, so a recruiter could never open the file they had
 * uploaded. The durable storage driver now persists the URL it returns
 * (`/api/cv/<storage key>`), and this route resolves it.
 *
 * Access control:
 *   - the caller must hold the `cv.view` permission,
 *   - the key is looked up against `CVFile.storagePath` **through the
 *     candidate's organization** (foreign-key filter), so a key belonging
 *     to another tenant is not found — the route answers 404, not 403, so
 *     it does not disclose that the file exists elsewhere.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { db } from '@/lib/db'
import { getFileStorage } from '@/lib/storage'

export const dynamic = 'force-dynamic'

/** Strips path separators and quotes from a filename for the header. */
function safeFileName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'cv-file'
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ key: string[] }> }
) {
  const auth = await requirePermission('cv.view')
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: 'You do not have access to CV files.' } },
      { status: auth.code === 'UNAUTHENTICATED' ? 401 : 403 },
    )
  }

  const { key } = await ctx.params
  const storagePath = (key ?? []).join('/')
  if (!storagePath || storagePath.split('/').some(part => part === '..' || part === '')) {
    return NextResponse.json(
      { error: { code: 'INVALID_KEY', message: 'Invalid file reference.' } },
      { status: 400 },
    )
  }

  const cvFile = await db.cVFile.findFirst({
    where: {
      storagePath,
      candidate: { organizationId: auth.data.organizationId },
    },
    select: { id: true, fileName: true, mimeType: true, storagePath: true },
  })
  if (!cvFile || !cvFile.storagePath) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'File not found.' } },
      { status: 404 },
    )
  }

  const object = await getFileStorage().get(cvFile.storagePath)
  if (!object) {
    return NextResponse.json(
      {
        error: {
          code: 'BYTES_NOT_RETAINED',
          message:
            'The original file was not retained by the storage backend. The parsed CV text is still available on the candidate profile.',
        },
      },
      { status: 404 },
    )
  }

  return new NextResponse(new Uint8Array(object.body), {
    status: 200,
    headers: {
      'Content-Type': object.contentType ?? cvFile.mimeType ?? 'application/octet-stream',
      'Content-Length': String(object.size),
      'Content-Disposition': `inline; filename="${safeFileName(cvFile.fileName)}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
