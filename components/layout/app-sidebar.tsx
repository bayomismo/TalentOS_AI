'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MenuIcon, XIcon } from 'lucide-react'
import { navItems } from '@/config/navigation'
import { cn } from '@/lib/utils'

interface AppSidebarProps {
  open: boolean
  onToggle: () => void
}

export function AppSidebar({ open, onToggle }: AppSidebarProps) {
  const pathname = usePathname()

  function isActive(href: string) {
    if (href === '/ai-recruiter') {
      return pathname === href
    }

    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <aside
      className={cn(
        'border-r border-slate-200 bg-white transition-all duration-300 dark:border-slate-700 dark:bg-slate-800',
        open ? 'w-64' : 'w-20'
      )}
    >
      <div className="flex h-16 items-center justify-between px-4">
        {open && (
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50">
            TalentOS
          </h1>
        )}
        <button
          onClick={onToggle}
          className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          {open ? (
            <XIcon className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          ) : (
            <MenuIcon className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          )}
        </button>
      </div>

      <nav className="space-y-2 px-3 py-6">
        {navItems.map(item => {
          const Icon = item.icon
          const active = isActive(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                active
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'
              )}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              {open && <span>{item.label}</span>}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
