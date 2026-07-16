'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { SessionProvider } from 'next-auth/react'
import { AppHeader } from '@/components/layout/app-header'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { CommandPalette } from '@/components/layout/command-palette'
import { getPageTitle } from '@/config/navigation'
import { EventBusProvider } from '@/lib/events'

export function AppLayoutClient({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SessionProvider>
      <AppLayoutInner>{children}</AppLayoutInner>
    </SessionProvider>
  )
}

function AppLayoutInner({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showCommandPalette, setShowCommandPalette] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(prev => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        setShowCommandPalette(prev => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const pageTitle = getPageTitle(pathname)

  return (
    <EventBusProvider>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <AppSidebar open={sidebarOpen} onToggle={() => setSidebarOpen(o => !o)} />
        <div className={`transition-all ${sidebarOpen ? 'lg:pl-64' : 'lg:pl-16'}`}>
          <AppHeader title={pageTitle} onMenuClick={() => setSidebarOpen(o => !o)} />
          <main className="min-h-[calc(100vh-4rem)]">
            {children}
          </main>
        </div>
        {showCommandPalette && (
          <CommandPalette onClose={() => setShowCommandPalette(false)} />
        )}
      </div>
    </EventBusProvider>
  )
}
