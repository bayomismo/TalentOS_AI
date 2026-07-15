'use client'

/**
 * Sprint 9 — App header with profile menu.
 *
 * PART 4: shows the authenticated user's name + role + organization and
 * provides a sign-out action.
 */
import { signOut, useSession } from 'next-auth/react'
import { useState } from 'react'
import { CommandIcon, LogOutIcon, UserIcon, ChevronDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AppHeaderProps {
  title: string
  onOpenCommandPalette: () => void
}

export function AppHeader({ title, onOpenCommandPalette }: AppHeaderProps) {
  const { data: session } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-4 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
        {title}
      </h2>
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenCommandPalette}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
        >
          <CommandIcon className="h-4 w-4" />
          <span>Cmd+K</span>
        </button>

        {session?.user ? (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                <span className="text-xs font-semibold">
                  {session.user.firstName?.[0] ?? session.user.email?.[0]?.toUpperCase() ?? 'U'}
                </span>
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-50">
                  {session.user.firstName} {session.user.lastName}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  {session.user.role}
                </div>
              </div>
              <ChevronDownIcon className="h-3 w-3 text-slate-400" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-1.5 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-500">Signed in as</p>
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">{session.user.email}</p>
                  </div>
                  <a
                    href="/settings"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <UserIcon className="h-4 w-4" />
                    Profile & Settings
                  </a>
                  <button
                    onClick={() => signOut({ callbackUrl: '/login' })}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                  >
                    <LogOutIcon className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </header>
  )
}
