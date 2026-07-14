'use client'

import { useEffect, useRef } from 'react'
import { SearchIcon, XIcon } from 'lucide-react'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Escape closes the palette. Without this, keyboard users are stuck.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[20vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search positions, candidates..."
            aria-label="Search positions, candidates"
            className="flex-1 bg-transparent text-sm text-slate-900 placeholder-slate-500 focus:outline-none dark:text-slate-50 dark:placeholder-slate-400"
            autoFocus
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="p-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Quick navigation features coming soon
          </p>
        </div>
      </div>
    </div>
  )
}
