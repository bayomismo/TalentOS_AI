'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { SessionProvider } from 'next-auth/react'
import { AppHeader } from '@/components/layout/app-header'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { CommandPalette } from '@/components/layout/command-palette'
import { getPageTitle } from '@/config/navigation'
import { EventBusProvider } from '@/lib/events'

export default function AppLayout({
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
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <EventBusProvider>
      <div className="flex h-screen bg-slate-50 dark:bg-slate-900">
        <AppSidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(prev => !prev)}
        />

        <main className="flex-1 flex flex-col overflow-hidden">
          <AppHeader
            title={getPageTitle(pathname)}
            onOpenCommandPalette={() => setShowCommandPalette(true)}
          />

          <CommandPalette
            open={showCommandPalette}
            onClose={() => setShowCommandPalette(false)}
          />

          <div className="overflow-auto flex-1">{children}</div>
        </main>
      </div>
    </EventBusProvider>
  )
}
