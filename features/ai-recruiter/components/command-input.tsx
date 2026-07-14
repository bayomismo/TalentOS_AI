'use client'

import { motion } from 'framer-motion'
import { ArrowUpIcon, Loader2Icon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CommandInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  isRunning?: boolean
}

export function CommandInput({
  value,
  onChange,
  onSubmit,
  disabled,
  isRunning,
}: CommandInputProps) {
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && value.trim()) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-xl border bg-white shadow-sm transition-all dark:bg-slate-800',
          isRunning
            ? 'border-emerald-500/50 shadow-emerald-500/10 shadow-lg ring-1 ring-emerald-500/20'
            : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
        )}
      >
        {isRunning && (
          <motion.div
            className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500"
            animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            style={{ backgroundSize: '200% 100%' }}
          />
        )}

        <div className="flex items-end gap-3 p-4">
          <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="Hire Senior Frontend Developer..."
            rows={1}
            className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-slate-900 placeholder-slate-400 outline-none dark:text-slate-50 dark:placeholder-slate-500"
          />
          <motion.button
            whileHover={{ scale: disabled ? 1 : 1.05 }}
            whileTap={{ scale: disabled ? 1 : 0.95 }}
            onClick={onSubmit}
            disabled={disabled || !value.trim()}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors',
              value.trim() && !disabled
                ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500'
            )}
          >
            {isRunning ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUpIcon className="h-4 w-4" />
            )}
          </motion.button>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 dark:border-slate-700/50">
          <span className="text-xs text-slate-400 dark:text-slate-500">
            Press Enter to start · Shift+Enter for new line
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            Powered by TalentOS AI
          </span>
        </div>
      </div>
    </motion.div>
  )
}
