'use client'

/**
 * Sprint 13 — Settings hub.
 *
 * The page is a client component for the section navigation. Each
 * section is a separate component that:
 *   - reads real data from the server (via server actions)
 *   - persists real data via server actions
 *   - shows "Coming soon" for features that are not implemented
 *
 * NO hardcoded mock data anywhere in this page.
 */

import { useEffect, useState } from 'react'
import {
  BellIcon, BuildingIcon, DatabaseIcon, KeyIcon, ShieldIcon, SparklesIcon, UserIcon, UsersIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shared/card'
import { ChangePasswordCard } from '@/features/auth/components/change-password-card'
import { TeamPage } from '@/features/user-management/components/team-page'
import { DataManagementPage } from '@/features/data-management/components/data-management-page'
import { ProfileSection } from './_components/profile-section'
import { OrganizationSection } from './_components/organization-section'
import { AiUsageSection } from './_components/ai-usage-section'
import { ComingSoonSection } from './_components/coming-soon-section'
import { cn } from '@/lib/utils'

const settingsSections = [
  { id: 'profile', label: 'Profile', icon: UserIcon },
  { id: 'organization', label: 'Organization', icon: BuildingIcon },
  { id: 'team', label: 'Team & Users', icon: UsersIcon, adminOnly: true },
  { id: 'data', label: 'Data Management', icon: DatabaseIcon, adminOnly: true },
  { id: 'ai-usage', label: 'AI Usage', icon: SparklesIcon },
  { id: 'notifications', label: 'Notifications', icon: BellIcon, notImplemented: true, notImplementedLabel: 'Notification preferences will be configurable in a future release. We currently send all transactional alerts (interview reminders, offer activity) regardless of this setting.' },
  { id: 'security', label: 'Security', icon: ShieldIcon },
  { id: 'integrations', label: 'Integrations', icon: KeyIcon, notImplemented: true, notImplementedLabel: 'Native integrations (Google Calendar, Slack, Greenhouse) are planned for a future release. Today TalentOS works as a standalone workspace.' },
] as const

type SettingsSectionId = (typeof settingsSections)[number]['id']

export default function SettingsPage() {
  const [active, setActive] = useState<SettingsSectionId>('profile')
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [currentUserRole, setCurrentUserRole] = useState<string>('VIEWER')

  useEffect(() => {
    fetch('/api/auth/session')
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        if (s?.user?.id) setCurrentUserId(s.user.id)
        if (s?.user?.role) setCurrentUserRole(s.user.role)
      })
      .catch(() => null)
  }, [])

  const isAdmin = currentUserRole === 'ADMIN'
  const activeSection = settingsSections.find(s => s.id === active)!

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Settings"
        description="Manage your account, organization, and platform preferences. All changes are saved to your workspace."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <aside>
          <Card>
            <CardContent className="p-3">
              <nav className="space-y-1">
                {settingsSections.map(section => {
                  const Icon = section.icon
                  const isActive = active === section.id
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActive(section.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/50'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {section.label}
                    </button>
                  )
                })}
              </nav>
            </CardContent>
          </Card>
        </aside>

        <div className="space-y-6">
          {active === 'profile' && <ProfileSection />}
          {active === 'organization' && isAdmin && <OrganizationSection />}
          {active === 'organization' && !isAdmin && (
            <Card>
              <CardContent className="p-6 text-sm text-slate-600 dark:text-slate-300">
                Only administrators can edit organization settings.
              </CardContent>
            </Card>
          )}
          {active === 'team' && isAdmin && <TeamPage currentUserId={currentUserId} currentUserRole={currentUserRole} />}
          {active === 'team' && !isAdmin && (
            <Card>
              <CardContent className="p-6 text-sm text-slate-600 dark:text-slate-300">
                Only administrators can manage team members.
              </CardContent>
            </Card>
          )}
          {active === 'data' && isAdmin && <DataManagementPage />}
          {active === 'data' && !isAdmin && (
            <Card>
              <CardContent className="p-6 text-sm text-slate-600 dark:text-slate-300">
                Only administrators can manage data.
              </CardContent>
            </Card>
          )}
          {active === 'ai-usage' && <AiUsageSection />}
          {active === 'security' && <SecuritySection />}
          {('notImplemented' in activeSection && activeSection.notImplemented) && (
            <ComingSoonSection
              title={activeSection.label}
              description={(activeSection as any).notImplementedLabel}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function SecuritySection() {
  return (
    <div className="space-y-6">
      <ChangePasswordCard />
    </div>
  )
}
