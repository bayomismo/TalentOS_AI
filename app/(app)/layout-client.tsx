'use client'

/**
 * Sprint 14 hotfix — App shell client wrapper.
 *
 * Restores the pre-Sprint-13 AppShell structure:
 *   <div class="flex h-screen">
 *     <AppSidebar />
 *     <main class="flex-1 flex flex-col overflow-hidden">
 *       <AppHeader />
 *       <div class="overflow-auto flex-1">{children}</div>
 *     </main>
 *   </div>
 *
 * The Sprint 13 server-side onboarding guard in layout.tsx still
 * runs before this client shell renders. If onboarding is
 * incomplete, the user is redirected and this component never
 * mounts.
 *
 * Visual regression introduced by Sprint 13 was caused by changing
 * the outer wrapper from `flex h-screen` to `min-h-screen` and
 * promoting the AppHeader/AppSidebar from siblings-inside-main to
 * separate siblings. This caused the AppSidebar to render at its
 * intrinsic height (only the logo area) while the AppHeader got
 * pushed below it in document order.
 */

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

  return (
    <EventBusProvider>
      <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-900">
        <AppSidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(prev => !prev)}
        />
        <main className="flex flex-1 flex-col overflow-hidden">
          <AppHeader
            title={getPageTitle(pathname)}
            onOpenCommandPalette={() => setShowCommandPalette(true)}
          />
          <CommandPalette
            open={showCommandPalette}
            onClose={() => setShowCommandPalette(false)}
          />
          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </main>
      </div>
    </EventBusProvider>
  )
}
