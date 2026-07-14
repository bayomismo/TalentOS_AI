'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { SparklesIcon } from 'lucide-react'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

interface GreetingProps {
  role?: string | null
  isWorking?: boolean
}

export function Greeting({ role, isWorking }: GreetingProps) {
  // Compute the time-of-day string client-side only, so the server
  // doesn't lock the timezone and trigger a hydration mismatch.
  const [greeting, setGreeting] = useState('Hello')
  useEffect(() => {
    setGreeting(getGreeting())
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-2"
    >
      <div className="flex items-center gap-2">
        <motion.div
          animate={
            isWorking
              ? { rotate: [0, 8, -8, 0], scale: [1, 1.05, 1] }
              : { rotate: 0, scale: 1 }
          }
          transition={
            isWorking
              ? { duration: 2, repeat: Infinity, ease: 'easeInOut' }
              : {}
          }
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10"
        >
          <SparklesIcon className="h-4 w-4 text-emerald-500" />
        </motion.div>
        <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
          TalentOS AI
        </span>
      </div>

      <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 md:text-4xl">
        {isWorking && role ? (
          <>
            Building your{' '}
            <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
              {role}
            </span>{' '}
            hiring package
          </>
        ) : (
          <>
            {greeting},{' '}
            <span className="text-slate-500 dark:text-slate-400">
              what role are you hiring for?
            </span>
          </>
        )}
      </h1>

      {!isWorking && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="max-w-xl text-base text-slate-500 dark:text-slate-400"
        >
          Describe a role and I&apos;ll generate a complete hiring package — job
          description, skills matrix, interview questions, and evaluation
          scorecard.
        </motion.p>
      )}
    </motion.div>
  )
}
