'use client'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        className="fixed top-1/4 left-1/2 w-96 -translate-x-1/2 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4">
          <input
            type="text"
            placeholder="Search positions, candidates..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm placeholder-slate-500 focus:border-emerald-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:placeholder-slate-400"
            autoFocus
          />
        </div>
        <div className="border-t border-slate-200 p-3 dark:border-slate-700">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Quick navigation features coming soon
          </p>
        </div>
      </div>
    </div>
  )
}
