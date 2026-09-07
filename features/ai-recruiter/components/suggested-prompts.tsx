'use client'

import { motion } from 'framer-motion'
import {
  BriefcaseIcon,
  CodeIcon,
  LineChartIcon,
  PaletteIcon,
} from 'lucide-react'

const PROMPTS = [
  {
    icon: CodeIcon,
    label: 'Hire Senior Frontend Developer',
    prompt: 'Hire Senior Frontend Developer',
  },
  {
    icon: BriefcaseIcon,
    label: 'Build package for DevOps Engineer',
    prompt: 'Build a hiring package for DevOps Engineer',
  },
  {
    icon: LineChartIcon,
    label: 'Interview questions for Product Manager',
    prompt: 'Create interview questions for Product Manager',
  },
  {
    icon: PaletteIcon,
    label: 'Scorecard for UX Designer',
    prompt: 'Generate a scorecard for UX Designer',
  },
]

interface SuggestedPromptsProps {
  onSelect: (prompt: string) => void
  disabled?: boolean
}

export function SuggestedPrompts({ onSelect, disabled }: SuggestedPromptsProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="space-y-3"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
        Suggested prompts
      </p>
      <div className="flex flex-wrap gap-2">
        {PROMPTS.map((item, i) => {
          const Icon = item.icon
          return (
            <motion.button
              key={item.prompt}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25 + i * 0.05 }}
              whileHover={{ scale: disabled ? 1 : 1.02, y: disabled ? 0 : -1 }}
              whileTap={{ scale: disabled ? 1 : 0.98 }}
              onClick={() => !disabled && onSelect(item.prompt)}
              disabled={disabled}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/30"
            >
              <Icon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {item.label}
            </motion.button>
          )
        })}
      </div>
    </motion.div>
  )
}
