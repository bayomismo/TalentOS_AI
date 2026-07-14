'use client'

import { CommandIcon } from 'lucide-react'

interface AppHeaderProps {
  title: string
  onOpenCommandPalette: () => void
}

export function AppHeader({ title, onOpenCommandPalette }: AppHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-4 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
        {title}
      </h2>
      <button
        onClick={onOpenCommandPalette}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
      >
        <CommandIcon className="h-4 w-4" />
        <span>Cmd+K</span>
      </button>
    </header>
  )
}
