'use client'

import { useState } from 'react'
import { BellIcon, BuildingIcon, KeyIcon, ShieldIcon, UserIcon, UsersIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const settingsSections = [
  { id: 'profile', label: 'Profile', icon: UserIcon },
  { id: 'organization', label: 'Organization', icon: BuildingIcon },
  { id: 'team', label: 'Team & Roles', icon: UsersIcon },
  { id: 'notifications', label: 'Notifications', icon: BellIcon },
  { id: 'security', label: 'Security', icon: ShieldIcon },
  { id: 'integrations', label: 'Integrations', icon: KeyIcon },
] as const

type SettingsSectionId = (typeof settingsSections)[number]['id']

export default function SettingsPage() {
  const [active, setActive] = useState<SettingsSectionId>('profile')

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Settings"
        description="Manage your account, organization, and platform preferences. All changes are saved to your workspace."
        actions={
          <>
            <Button variant="outline">Discard changes</Button>
            <Button>Save changes</Button>
          </>
        }
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
          {active === 'organization' && <OrganizationSection />}
          {active === 'team' && <TeamSection />}
          {active === 'notifications' && <NotificationsSection />}
          {active === 'security' && <SecuritySection />}
          {active === 'integrations' && <IntegrationsSection />}
        </div>
      </div>
    </div>
  )
}

function ProfileSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile information</CardTitle>
        <CardDescription>
          Update your personal details and how others see you across TalentOS.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-2xl">
            👤
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
              Profile photo
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              PNG, JPG, or GIF up to 2MB.
            </p>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm">Upload new</Button>
              <Button variant="ghost" size="sm">Remove</Button>
            </div>
          </div>
        </div>

        <FieldGrid>
          <Field label="Full name" defaultValue="Jordan Rivera" />
          <Field label="Email address" defaultValue="jordan.rivera@company.com" type="email" />
          <Field label="Job title" defaultValue="Head of Talent" />
          <Field label="Time zone" defaultValue="Europe/Madrid (UTC+1)" />
        </FieldGrid>

        <Field
          label="Bio"
          defaultValue="Building the future of talent acquisition with AI-first workflows."
          multiline
        />
      </CardContent>
    </Card>
  )
}

function OrganizationSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization</CardTitle>
        <CardDescription>
          Your workspace details and branding preferences.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <FieldGrid>
          <Field label="Organization name" defaultValue="Acme Talent Co." />
          <Field label="Workspace URL" defaultValue="acme.talentos.app" />
          <Field label="Industry" defaultValue="SaaS · B2B" />
          <Field label="Company size" defaultValue="50–200 employees" />
        </FieldGrid>
        <Field
          label="Default hiring workflow"
          defaultValue="Standard pipeline with screening, two interview rounds, and an evaluation scorecard."
          multiline
        />
      </CardContent>
    </Card>
  )
}

function TeamSection() {
  const members = [
    { name: 'Jordan Rivera', email: 'jordan@company.com', role: 'Owner', status: 'Active' },
    { name: 'Priya Patel', email: 'priya@company.com', role: 'Recruiter', status: 'Active' },
    { name: 'Marcus Chen', email: 'marcus@company.com', role: 'Hiring Manager', status: 'Active' },
    { name: 'Elena Rodriguez', email: 'elena@company.com', role: 'Interviewer', status: 'Pending' },
  ]
  return (
    <Card>
      <CardHeader
        title="Team & roles"
        description="Invite teammates and assign roles to control access across the platform."
        action={
          <>
            <Button variant="outline" size="sm">Export</Button>
            <Button size="sm">Invite member</Button>
          </>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y border-slate-200 bg-slate-50/50 text-left dark:border-slate-700 dark:bg-slate-800/50">
            <tr className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="px-6 py-3 font-semibold">Member</th>
              <th className="px-6 py-3 font-semibold">Role</th>
              <th className="px-6 py-3 font-semibold">Status</th>
              <th className="px-6 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {members.map(member => (
              <tr key={member.email}>
                <td className="px-6 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                      {member.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-50">
                        {member.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {member.email}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-3 text-slate-600 dark:text-slate-300">
                  {member.role}
                </td>
                <td className="px-6 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      member.status === 'Active'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    )}
                  >
                    {member.status}
                  </span>
                </td>
                <td className="px-6 py-3 text-right">
                  <Button variant="ghost" size="sm">Manage</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function NotificationsSection() {
  const channels = [
    { id: 'email-digest', label: 'Daily email digest', desc: 'A summary of pipeline activity every morning.' },
    { id: 'new-applicants', label: 'New applicants', desc: 'Get notified the moment someone applies.' },
    { id: 'interview-reminders', label: 'Interview reminders', desc: '24h and 1h before every scheduled interview.' },
    { id: 'hiring-updates', label: 'Hiring updates', desc: 'Status changes across all your open roles.' },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Choose what you want to be notified about and how.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-slate-100 dark:divide-slate-700">
        {channels.map(item => (
          <div key={item.id} className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                {item.label}
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {item.desc}
              </p>
            </div>
            <Toggle defaultChecked />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function SecuritySection() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>
            Keep your account safe with two-factor authentication and session management.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                Two-factor authentication
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Add an extra layer of security at sign-in.
              </p>
            </div>
            <Toggle defaultChecked />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                Single sign-on (SSO)
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Use your identity provider (Okta, Azure AD, Google Workspace).
              </p>
            </div>
            <Button variant="outline" size="sm">Configure</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader
          title="Active sessions"
          description="Devices currently signed in to your TalentOS account."
        />
        <CardContent className="space-y-3">
          {[
            { device: 'MacBook Pro · Chrome', location: 'Madrid, Spain', current: true },
            { device: 'iPhone 15 · Safari', location: 'Madrid, Spain', current: false },
            { device: 'Windows · Edge', location: 'London, UK', current: false },
          ].map(s => (
            <div
              key={s.device}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700"
            >
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                  {s.device}
                  {s.current && (
                    <span className="ml-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      This device
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{s.location}</p>
              </div>
              {!s.current && (
                <Button variant="ghost" size="sm">Revoke</Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function IntegrationsSection() {
  const integrations = [
    { name: 'Greenhouse', desc: 'Sync candidates and jobs.', status: 'Connected' },
    { name: 'Slack', desc: 'Pipeline alerts and approvals.', status: 'Connected' },
    { name: 'Google Calendar', desc: 'Two-way interview sync.', status: 'Connected' },
    { name: 'Lever', desc: 'Migrate historical data.', status: 'Available' },
    { name: 'Ashby', desc: 'Bi-directional sync.', status: 'Available' },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>
          Connect your existing tools. Most integrations take under a minute.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {integrations.map(i => (
          <div
            key={i.name}
            className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {i.name.charAt(0)}
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                  {i.name}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{i.desc}</p>
              </div>
            </div>
            <Button
              variant={i.status === 'Connected' ? 'outline' : 'default'}
              size="sm"
            >
              {i.status === 'Connected' ? 'Manage' : 'Connect'}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

interface FieldProps {
  label: string
  defaultValue?: string
  type?: string
  multiline?: boolean
  hint?: string
}

function Field({ label, defaultValue, type = 'text', multiline, hint }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {multiline ? (
        <textarea
          defaultValue={defaultValue}
          rows={3}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
        />
      ) : (
        <input
          type={type}
          defaultValue={defaultValue}
          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
        />
      )}
      {hint && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      )}
    </div>
  )
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-5 md:grid-cols-2">{children}</div>
}

function Toggle({ defaultChecked }: { defaultChecked?: boolean }) {
  return (
    <label className="relative inline-flex h-5 w-9 cursor-pointer items-center">
      <input
        type="checkbox"
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <span className="h-5 w-9 rounded-full bg-slate-200 transition-colors peer-checked:bg-emerald-500 peer-focus:ring-2 peer-focus:ring-emerald-500/20 dark:bg-slate-700" />
      <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
    </label>
  )
}
