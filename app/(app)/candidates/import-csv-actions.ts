'use server'

/**
 * Sprint 17 — CSV import server actions.
 *
 * Two-phase flow:
 *  1. parseCsvAction(text) — client sends the raw text, server returns
 *     a preview of valid rows + per-row errors. Stateless.
 *  2. importCandidatesAction({ hiringRequestId, rows }) — server inserts
 *     the rows in a transaction, deduplicates by email, returns count.
 *
 * Parser is dependency-free (no PapaParse). Handles quoted fields
 * with embedded commas and newlines. Good enough for a clean export
 * from a spreadsheet or ATS; not a full RFC 4180 implementation.
 *
 * Tenant-scoped: every insert is scoped to caller's org.
 */

import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { recordAuditLog } from '@/lib/auth/audit'
import { z } from 'zod'

// ---------- Parser ----------

const REQUIRED_COLUMNS = ['firstName', 'lastName', 'email'] as const
const OPTIONAL_COLUMNS = [
  'phone', 'location', 'currentTitle', 'currentCompany',
  'linkedinUrl', 'githubUrl', 'source', 'notes',
] as const

export interface ParsedCsvRow {
  firstName: string
  lastName: string
  email: string
  phone?: string
  location?: string
  currentTitle?: string
  currentCompany?: string
  linkedinUrl?: string
  githubUrl?: string
  source?: string
  notes?: string
  _rowIndex: number
}

export interface CsvRowError {
  row: number
  error: string
}

export type CsvParseResult =
  | { ok: true; rows: ParsedCsvRow[]; validRows: ParsedCsvRow[]; errors: CsvRowError[]; headers: string[] }
  | { ok: false; error: string }

const MAX_ROWS = 1000

/**
 * Parse CSV text. Header row is required. Required columns must be
 * present (case-insensitive). Each data row is validated for:
 *   - non-empty firstName, lastName
 *   - valid email format
 *   - max field length 500 chars
 */
function parseCsvText(text: string): CsvParseResult {
  const rows = parseCsvLines(text)
  if (rows.length === 0) {
    return { ok: false, error: 'CSV is empty.' }
  }
  const headers = rows[0].map(h => h.trim().toLowerCase())
  const missing = REQUIRED_COLUMNS.filter(c => !headers.includes(c))
  if (missing.length > 0) {
    return { ok: false, error: `Missing required columns: ${missing.join(', ')}. Headers should be: ${REQUIRED_COLUMNS.join(', ')}.` }
  }
  if (rows.length - 1 > MAX_ROWS) {
    return { ok: false, error: `Too many rows: ${rows.length - 1} (max ${MAX_ROWS}).` }
  }

  const validRows: ParsedCsvRow[] = []
  const errors: CsvRowError[] = []

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i]
    const rowNum = i + 1
    if (cells.length === 1 && cells[0].trim() === '') continue // blank line

    const get = (col: string) => {
      const idx = headers.indexOf(col)
      return idx >= 0 ? (cells[idx] ?? '').trim() : ''
    }

    const firstName = get('firstName')
    const lastName = get('lastName')
    const email = get('email').toLowerCase()

    if (!firstName) { errors.push({ row: rowNum, error: 'Missing firstName' }); continue }
    if (!lastName) { errors.push({ row: rowNum, error: 'Missing lastName' }); continue }
    if (!email) { errors.push({ row: rowNum, error: 'Missing email' }); continue }
    if (!isEmail(email)) { errors.push({ row: rowNum, error: `Invalid email: ${email}` }); continue }
    if (firstName.length > 200) { errors.push({ row: rowNum, error: 'firstName too long (>200)' }); continue }
    if (lastName.length > 200) { errors.push({ row: rowNum, error: 'lastName too long (>200)' }); continue }

    const row: ParsedCsvRow = {
      firstName: firstName.slice(0, 200),
      lastName: lastName.slice(0, 200),
      email: email.slice(0, 320),
      _rowIndex: i,
    }
    for (const col of OPTIONAL_COLUMNS) {
      const v = get(col)
      if (v) (row as Record<string, unknown>)[col] = v.slice(0, 500)
    }
    validRows.push(row)
  }

  return { ok: true, rows: validRows, validRows, errors, headers }
}

/**
 * Minimal RFC 4180-ish parser. Handles:
 *   - Quoted fields: "foo, bar"
 *   - Escaped quotes: "He said ""hi"""
 *   - Embedded newlines inside quoted fields
 *   - Trailing CR (Windows line endings)
 * Does NOT handle: comments, fixed-width, multi-character delimiters.
 */
function parseCsvLines(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) i = 1

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      cell += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue }
    if (ch === '\n' || ch === '\r') {
      row.push(cell); out.push(row); row = []; cell = ''
      if (ch === '\r' && text[i + 1] === '\n') i += 2; else i++
      continue
    }
    cell += ch; i++
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); out.push(row) }
  return out
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

export async function parseCsvAction(text: string): Promise<CsvParseResult> {
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, error: 'Unauthenticated' }
  if (typeof text !== 'string') return { ok: false, error: 'Invalid input.' }
  if (text.length > 10 * 1024 * 1024) return { ok: false, error: 'File too large (>10MB).' }
  return parseCsvText(text)
}

// ---------- Import ----------

const importSchema = z.object({
  hiringRequestId: z.string().uuid(),
  rows: z.array(z.object({
    firstName: z.string().min(1).max(200),
    lastName: z.string().min(1).max(200),
    email: z.string().email().max(320),
    phone: z.string().max(500).optional(),
    location: z.string().max(500).optional(),
    currentTitle: z.string().max(500).optional(),
    currentCompany: z.string().max(500).optional(),
    linkedinUrl: z.string().max(500).optional(),
    githubUrl: z.string().max(500).optional(),
    source: z.string().max(500).optional(),
    notes: z.string().max(500).optional(),
  })).min(1).max(MAX_ROWS),
})

export type ImportCandidatesResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; error: string }

export async function importCandidatesAction(
  input: unknown,
): Promise<ImportCandidatesResult> {
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, error: 'Unauthenticated' }
  const orgId = auth.data.organizationId

  const parsed = importSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { hiringRequestId, rows } = parsed.data

  // Verify the hiring request belongs to the caller's org
  const hr = await db.hiringRequest.findFirst({
    where: { id: hiringRequestId, organizationId: orgId },
    select: { id: true },
  })
  if (!hr) return { ok: false, error: 'Hiring request not found.' }

  // Dedupe within batch by email (case-insensitive)
  const seenInBatch = new Set<string>()
  const uniqueRows = rows.filter(r => {
    const e = r.email.toLowerCase()
    if (seenInBatch.has(e)) return false
    seenInBatch.add(e)
    return true
  })

  // Dedupe against existing candidates in this HR
  const existingEmails = await db.candidate.findMany({
    where: {
      organizationId: orgId,
      hiringRequestId,
      email: { in: uniqueRows.map(r => r.email.toLowerCase()) },
    },
    select: { email: true },
  })
  const existingSet = new Set(existingEmails.map(e => e.email.toLowerCase()))
  const newRows = uniqueRows.filter(r => !existingSet.has(r.email.toLowerCase()))

  if (newRows.length === 0) {
    return { ok: true, created: 0, skipped: rows.length }
  }

  // Bulk insert in a transaction
  const result = await db.$transaction(
    newRows.map(r =>
      db.candidate.create({
        data: {
          organizationId: orgId,
          hiringRequestId,
          firstName: r.firstName,
          lastName: r.lastName,
          email: r.email.toLowerCase(),
          phone: r.phone ?? null,
          location: r.location ?? null,
          currentTitle: r.currentTitle ?? null,
          currentCompany: r.currentCompany ?? null,
          linkedinUrl: r.linkedinUrl ?? null,
          githubUrl: r.githubUrl ?? null,
          source: r.source ?? 'CSV Import',
          sourceDetails: r.notes ?? null,
        },
      }),
    ),
  )

  await recordAuditLog({
    organizationId: orgId,
    actorId: auth.data.userId,
    action: 'CANDIDATES_BULK_IMPORTED' as never,
    targetType: 'hiringRequest',
    targetId: hiringRequestId,
    outcome: 'success',
    metadata: {
      created: result.length,
      skipped: rows.length - result.length,
    } as any,
  }).catch(() => null)

  return { ok: true, created: result.length, skipped: rows.length - result.length }
}
