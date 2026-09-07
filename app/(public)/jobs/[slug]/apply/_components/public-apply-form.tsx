'use client'

/**
 * Sprint 17.6 — Public job application form (client).
 *
 * Posts to /api/public/apply (the only public application route).
 * Shows inline errors per field, a paste-CV-or-upload option, and
 * a required consent checkbox.
 *
 * File upload: PDF or DOCX, max 5MB. We send the bytes base64-
 * encoded in JSON to keep the API simple. For larger files we'd
 * switch to a multipart upload route — but 5MB JSON is fine for
 * a CV and avoids multipart parsing in a serverless function.
 */

import { useState } from 'react'
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  FileTextIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react'

const MAX_CV_BYTES = 5 * 1024 * 1024 // 5MB
const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]
const ACCEPTED_EXT = '.pdf,.docx,.txt'

interface Props {
  jobSlug: string
  jobTitle: string
  organizationName: string
}

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string }
  | { kind: 'success' }

export function PublicApplyForm({ jobSlug, jobTitle, organizationName }: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [cvFile, setCvFile] = useState<File | null>(null)
  const [cvError, setCvError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function handleFile(file: File | null) {
    setCvError(null)
    if (!file) {
      setCvFile(null)
      return
    }
    if (file.size > MAX_CV_BYTES) {
      setCvError(`File is too large. Maximum size is ${MAX_CV_BYTES / 1024 / 1024}MB.`)
      setCvFile(null)
      return
    }
    if (!ACCEPTED_TYPES.includes(file.type) && !/\.(pdf|docx|txt)$/i.test(file.name)) {
      setCvError('Please upload a PDF, DOCX, or TXT file.')
      setCvFile(null)
      return
    }
    setCvFile(file)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFieldErrors({})
    setStatus({ kind: 'submitting' })

    const form = e.currentTarget
    const data = new FormData(form)

    // Build the JSON body. File goes in as base64.
    const body: Record<string, unknown> = {
      jobSlug,
      firstName: data.get('firstName') ?? '',
      lastName: data.get('lastName') ?? '',
      email: data.get('email') ?? '',
      phone: data.get('phone') ?? '',
      location: data.get('location') ?? '',
      linkedinUrl: data.get('linkedinUrl') ?? '',
      portfolioUrl: data.get('portfolioUrl') ?? '',
      githubUrl: data.get('githubUrl') ?? '',
      coverLetter: data.get('coverLetter') ?? '',
      consent: data.get('consent') ?? '',
      website: data.get('website') ?? '', // honeypot
    }

    if (cvFile) {
      const buffer = await cvFile.arrayBuffer()
      body.cv = {
        dataBase64: arrayBufferToBase64(buffer),
        fileName: cvFile.name,
        mimeType: cvFile.type || 'application/octet-stream',
      }
    }

    try {
      const res = await fetch('/api/public/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        candidateId?: string
        error?: { code?: string; message?: string }
        fieldErrors?: Record<string, string>
      }

      if (res.ok && json.ok) {
        setStatus({ kind: 'success' })
        // Redirect to the thanks page
        window.location.href = `/jobs/${jobSlug}/applied`
        return
      }

      // Map server error → inline field errors where possible
      if (json.fieldErrors) {
        setFieldErrors(json.fieldErrors)
      }
      setStatus({
        kind: 'error',
        message: json.error?.message ?? 'Something went wrong. Please try again.',
      })
    } catch {
      setStatus({
        kind: 'error',
        message: 'Network error. Please check your connection and try again.',
      })
    }
  }

  if (status.kind === 'success') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center dark:border-emerald-800 dark:bg-emerald-950/40">
        <CheckCircle2Icon className="mx-auto h-10 w-10 text-emerald-600 dark:text-emerald-400" />
        <h2 className="mt-4 text-lg font-semibold text-emerald-900 dark:text-emerald-200">
          Application received!
        </h2>
        <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-300">
          {organizationName} has your application. Redirecting…
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Honeypot — hidden from real users, bait for bots */}
      <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        <label>
          Website (leave blank)
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </label>
      </div>

      {/* Name + Email */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="firstName"
          label="First name"
          required
          error={fieldErrors.firstName}
          autoComplete="given-name"
        />
        <Field
          id="lastName"
          label="Last name"
          required
          error={fieldErrors.lastName}
          autoComplete="family-name"
        />
      </div>

      <Field
        id="email"
        label="Email"
        type="email"
        required
        error={fieldErrors.email}
        autoComplete="email"
        help="We'll only use this to contact you about this role."
      />

      <Field
        id="phone"
        label="Phone (optional)"
        type="tel"
        error={fieldErrors.phone}
        autoComplete="tel"
      />

      <Field
        id="location"
        label="Location (optional)"
        error={fieldErrors.location}
        autoComplete="address-level2"
        placeholder="City, country"
      />

      {/* Optional profile links */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="linkedinUrl" label="LinkedIn" error={fieldErrors.linkedinUrl} placeholder="linkedin.com/in/…" />
        <Field id="githubUrl" label="GitHub" error={fieldErrors.githubUrl} placeholder="github.com/…" />
        <Field id="portfolioUrl" label="Portfolio" error={fieldErrors.portfolioUrl} placeholder="yoursite.com" />
      </div>

      {/* Cover letter */}
      <div>
        <label
          htmlFor="coverLetter"
          className="mb-1.5 block text-sm font-medium text-slate-900 dark:text-slate-100"
        >
          Why are you interested? (optional)
        </label>
        <textarea
          id="coverLetter"
          name="coverLetter"
          rows={4}
          maxLength={4000}
          placeholder="A short note helps the team understand your motivation. 1-2 sentences is plenty."
          className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        {fieldErrors.coverLetter && (
          <p className="mt-1 text-xs text-red-600">{fieldErrors.coverLetter}</p>
        )}
      </div>

      {/* CV upload OR paste-as-text */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-900 dark:text-slate-100">
          CV / Resume <span className="text-slate-400">(optional but recommended)</span>
        </label>

        <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
          {cvFile ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <FileTextIcon className="h-5 w-5 text-emerald-600" />
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">{cvFile.name}</div>
                  <div className="text-xs text-slate-500">
                    {Math.round(cvFile.size / 1024)}KB
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleFile(null)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
                aria-label="Remove file"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <label className="block cursor-pointer text-center">
              <input
                type="file"
                name="cvFile"
                accept={ACCEPTED_EXT}
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
              <FileTextIcon className="mx-auto h-6 w-6 text-slate-400" />
              <span className="mt-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                Click to upload your CV
              </span>
              <span className="mt-1 block text-xs text-slate-500">
                PDF, DOCX, or TXT — max 5MB
              </span>
            </label>
          )}
        </div>

        {cvError && <p className="mt-1 text-xs text-red-600">{cvError}</p>}

        <p className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500">
          <SparklesIcon className="h-3 w-3 text-emerald-600" />
          We'll extract the text from your CV so the team can review it.
        </p>
      </div>

      {/* Consent */}
      <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800/50">
        <label className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            name="consent"
            required
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span>
            I agree to share my information with <strong>{organizationName}</strong> for the
            purpose of this application. I understand that my data will be stored in TalentOS
            and that the employer may contact me about this or future opportunities.
            {fieldErrors.consent && (
              <span className="mt-1 block text-xs text-red-600">{fieldErrors.consent}</span>
            )}
          </span>
        </label>
      </div>

      {/* Submit */}
      <div>
        <button
          type="submit"
          disabled={status.kind === 'submitting'}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {status.kind === 'submitting' ? (
            <>Submitting…</>
          ) : (
            <>
              Submit application
              <ArrowLeftIcon className="h-4 w-4 rotate-180" />
            </>
          )}
        </button>

        {status.kind === 'error' && (
          <p className="mt-3 text-sm text-red-600">{status.message}</p>
        )}
      </div>
    </form>
  )
}

function Field({
  id,
  label,
  type = 'text',
  required = false,
  error,
  autoComplete,
  placeholder,
  help,
}: {
  id: string
  label: string
  type?: string
  required?: boolean
  error?: string
  autoComplete?: string
  placeholder?: string
  help?: string
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-slate-900 dark:text-slate-100"
      >
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />
      {help && !error && (
        <p className="mt-1 text-xs text-slate-500">{help}</p>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    )
  }
  // btoa is available in the browser; this only runs client-side.
  return btoa(binary)
}
