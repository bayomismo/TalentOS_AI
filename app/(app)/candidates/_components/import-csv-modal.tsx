'use client'

/**
 * Sprint 17 — CSV import modal.
 *
 * Lets the user upload a CSV of candidates into a specific hiring
 * request. The flow:
 *  1. User picks the hiring request (required — candidates are scoped to one)
 *  2. User picks the CSV file
 *  3. We POST the file + hiringRequestId to a server action that:
 *     - parses the CSV (basic, no dependencies)
 *     - validates each row
 *     - returns a preview (rows + errors)
 *  4. User clicks "Import N candidates"
 *  5. Server creates the rows in a transaction
 *
 * CSV format: header row + data rows. Required columns:
 *   firstName, lastName, email
 * Optional columns: phone, location, currentTitle, currentCompany,
 *   linkedinUrl, githubUrl, source, notes
 *
 * Full a11y: role=dialog, body scroll lock, Escape to close.
 */

import { useEffect, useState, useTransition } from 'react'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileTextIcon,
  Loader2Icon,
  UploadIcon,
  XIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import {
  parseCsvAction,
  importCandidatesAction,
  type ParsedCsvRow,
  type CsvParseResult,
} from '../import-csv-actions'

interface HiringRequestOption {
  id: string
  title: string
}

interface ImportCsvModalProps {
  open: boolean
  onClose: () => void
  hiringRequests: HiringRequestOption[]
  defaultHiringRequestId?: string
  onImported?: () => void
}

export function ImportCsvModal({
  open,
  onClose,
  hiringRequests,
  defaultHiringRequestId,
  onImported,
}: ImportCsvModalProps) {
  const router = useRouter()
  const [hiringRequestId, setHiringRequestId] = useState(
    defaultHiringRequestId ?? hiringRequests[0]?.id ?? '',
  )
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<CsvParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState<{ created: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = original }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending && !importing) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pending, importing, onClose])

  useEffect(() => {
    if (open) {
      setFile(null)
      setParsed(null)
      setError(null)
      setImported(null)
    }
  }, [open])

  if (!open) return null

  function pickFile(f: File | null) {
    setError(null)
    setParsed(null)
    setImported(null)
    if (!f) {
      setFile(null)
      return
    }
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setError('Please pick a .csv file.')
      return
    }
    if (f.size > 5 * 1024 * 1024) {
      setError('File too large. Max 5 MB.')
      return
    }
    setFile(f)
  }

  function parseFile() {
    if (!file) return
    setError(null)
    startTransition(async () => {
      const text = await file.text()
      const r = await parseCsvAction(text)
      if (!r.ok) {
        setError(r.error)
        return
      }
      setParsed(r)
    })
  }

  function doImport() {
    if (!parsed || !hiringRequestId) return
    setImporting(true)
    setError(null)
    startTransition(async () => {
      const r = await importCandidatesAction({
        hiringRequestId,
        rows: parsed.rows,
      })
      setImporting(false)
      if (!r.ok) {
        setError(r.error)
        return
      }
      setImported({ created: r.created })
      onImported?.()
      router.refresh()
    })
  }

  if (imported) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        onClick={e => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 mb-4">
              <CheckCircle2Icon className="h-6 w-6 text-emerald-500" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
              Imported {imported.created} candidate{imported.created === 1 ? '' : 's'}
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              They now appear in the candidate workspace. AI analysis will run on demand.
            </p>
            <Button onClick={onClose} className="mt-6">
              Done
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-import-title"
      onClick={e => {
        if (e.target === e.currentTarget && !pending && !importing) onClose()
      }}
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
        <button
          type="button"
          onClick={onClose}
          disabled={pending || importing}
          aria-label="Close"
          className="absolute top-4 right-4 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <XIcon className="h-5 w-5" />
        </button>

        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <UploadIcon className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <h2 id="csv-import-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                Import candidates from CSV
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Bulk-add candidates to a hiring request. Up to 1,000 rows per upload.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {/* Step 1: Pick hiring request */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                Hiring request
              </label>
              <select
                value={hiringRequestId}
                onChange={e => setHiringRequestId(e.target.value)}
                disabled={pending || importing || hiringRequests.length === 0}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
              >
                {hiringRequests.length === 0 ? (
                  <option value="">No hiring requests — create one first</option>
                ) : (
                  hiringRequests.map(hr => (
                    <option key={hr.id} value={hr.id}>{hr.title}</option>
                  ))
                )}
              </select>
            </div>

            {/* Step 2: Pick file */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                CSV file
              </label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={e => pickFile(e.target.files?.[0] ?? null)}
                disabled={pending || importing}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-emerald-700 hover:file:bg-emerald-100 dark:text-slate-300 dark:file:bg-emerald-950/40 dark:file:text-emerald-300"
              />
              {file && !parsed && (
                <Button onClick={parseFile} disabled={pending} className="mt-2" size="sm">
                  {pending && <Loader2Icon className="h-4 w-4 animate-spin" />}
                  {pending ? 'Parsing…' : 'Parse file'}
                </Button>
              )}
            </div>

            {/* CSV format help */}
            <details className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-400">
              <summary className="cursor-pointer font-medium">CSV format help</summary>
              <div className="mt-2 space-y-1">
                <p><strong>Required columns:</strong> <code>firstName</code>, <code>lastName</code>, <code>email</code></p>
                <p><strong>Optional columns:</strong> <code>phone</code>, <code>location</code>, <code>currentTitle</code>, <code>currentCompany</code>, <code>linkedinUrl</code>, <code>githubUrl</code>, <code>source</code>, <code>notes</code></p>
                <p><strong>Example:</strong></p>
                <pre className="mt-1 overflow-x-auto rounded bg-slate-100 p-2 text-[11px] dark:bg-slate-800">
{`firstName,lastName,email,phone,location,currentTitle,source
Ada,Lovelace,ada@example.com,+44 20 7946 0958,London,Mathematician,Referral`}
                </pre>
              </div>
            </details>

            {/* Step 3: Preview */}
            {parsed && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Preview
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {parsed.validRows.length} valid · {parsed.errors.length} errors
                  </span>
                </div>
                {parsed.errors.length > 0 && (
                  <div className="border-b border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
                    <p className="font-medium">Rows that will be skipped:</p>
                    <ul className="mt-1 space-y-0.5">
                      {parsed.errors.slice(0, 5).map((e, i) => (
                        <li key={i}>Row {e.row}: {e.error}</li>
                      ))}
                      {parsed.errors.length > 5 && (
                        <li>… and {parsed.errors.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                )}
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Email</th>
                        <th className="px-3 py-2 font-medium">Title</th>
                        <th className="px-3 py-2 font-medium">Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.validRows.slice(0, 20).map((r, i) => (
                        <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                          <td className="px-3 py-2">{r.firstName} {r.lastName}</td>
                          <td className="px-3 py-2 text-slate-500">{r.email}</td>
                          <td className="px-3 py-2 text-slate-500">{r.currentTitle ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-500">{r.location ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.validRows.length > 20 && (
                    <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                      … and {parsed.validRows.length - 20} more
                    </p>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertCircleIcon className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending || importing}>
                Cancel
              </Button>
              {parsed && (
                <Button
                  onClick={doImport}
                  disabled={importing || parsed.validRows.length === 0 || !hiringRequestId}
                >
                  {importing && <Loader2Icon className="h-4 w-4 animate-spin" />}
                  {importing
                    ? 'Importing…'
                    : `Import ${parsed.validRows.length} candidate${parsed.validRows.length === 1 ? '' : 's'}`}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
