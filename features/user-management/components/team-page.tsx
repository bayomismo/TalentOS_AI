'use client'

/**
 * Sprint 12 — Team & Users page.
 *
 * ADMIN-only. Lists users in the current organization, supports
 * search/filter, invite, change role, disable/reactivate, and
 * invitation management. All actions are server-side and audited.
 */

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  UserPlusIcon,
  SearchIcon,
  UserIcon,
  MailIcon,
  ShieldIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  CheckIcon,
  XIcon,
  LoaderIcon,
  CopyIcon,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import {
  listUsersAction,
  changeUserRoleAction,
  setUserStatusAction,
  createUserInvitationAction,
  listInvitationsAction,
  revokeUserInvitationAction,
} from '../actions'
import { cn } from '@/lib/utils'

const ROLES = [
  { value: 'ADMIN', label: 'Administrator', description: 'Full organization access including user management and data cleanup.' },
  { value: 'TA_LEAD', label: 'Talent Acquisition Lead', description: 'Leads hiring workflow. Can manage candidates, AI, interviews, decisions.' },
  { value: 'RECRUITER', label: 'Recruiter', description: 'Manages hiring requests, candidates, schedules interviews, prepares offers.' },
  { value: 'HIRING_MANAGER', label: 'Hiring Manager', description: 'Views relevant HRs, participates in decisions, can record human decisions.' },
  { value: 'INTERVIEWER', label: 'Interviewer', description: 'Views only assigned interviews, submits own evaluations.' },
  { value: 'VIEWER', label: 'Viewer', description: 'Read-only access. No mutations, no AI, no evaluations.' },
] as const

interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  status: string
  departmentName: string | null
  lastLoginAt: string | null
  createdAt: string
  disabledAt: string | null
}

interface Invitation {
  id: string
  email: string
  role: string
  status: string
  expiresAt: string
  createdAt: string
  invitedByName: string | null
}

export function TeamPage({ currentUserId, currentUserRole }: { currentUserId: string; currentUserRole: string }) {
  const isAdmin = currentUserRole === 'ADMIN'
  const [users, setUsers] = useState<User[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [showInviteLink, setShowInviteLink] = useState<{ url: string; email: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function refresh() {
    setLoading(true)
    Promise.all([listUsersAction({ q, role: roleFilter || undefined, status: statusFilter || undefined }), listInvitationsAction()])
      .then(([u, i]) => {
        if (u.ok) setUsers(u.data.users)
        if (i.ok) setInvitations(i.data.invitations)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh() }, [q, roleFilter, statusFilter])

  function changeRole(userId: string, newRole: string) {
    setError(null)
    startTransition(async () => {
      const res = await changeUserRoleAction({ userId, newRole: newRole as any })
      if (!res.ok) setError(res.error?.message ?? 'Failed to change role')
      else refresh()
    })
  }
  function toggleStatus(userId: string, status: 'ACTIVE' | 'DISABLED') {
    setError(null)
    startTransition(async () => {
      const res = await setUserStatusAction({ userId, status })
      if (!res.ok) setError(res.error?.message ?? 'Failed')
      else refresh()
    })
  }
  function revoke(invId: string) {
    setError(null)
    startTransition(async () => {
      const res = await revokeUserInvitationAction(invId)
      if (!res.ok) setError(res.error?.message ?? 'Failed')
      else refresh()
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Team & Users</CardTitle>
            <CardDescription>Manage who can access this organization.</CardDescription>
          </div>
          {isAdmin && (
            <Button onClick={() => setShowInvite(true)}>
              <UserPlusIcon className="h-4 w-4" /> Invite user
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search by name or email…"
                className="h-10 w-full rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="">All roles</option>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="DISABLED">Disabled</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>

          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <LoaderIcon className="h-4 w-4 animate-spin" /> Loading users…
            </div>
          ) : users.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 p-8 text-center dark:border-slate-700">
              <UserIcon className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">No users match your filters</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Try clearing the filters or invite a new user.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500 dark:border-slate-700">
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Last login</th>
                    {isAdmin && <th className="px-3 py-2 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <UserRow
                      key={u.id}
                      user={u}
                      isAdmin={isAdmin}
                      isSelf={u.id === currentUserId}
                      pending={pending}
                      onChangeRole={changeRole}
                      onToggleStatus={toggleStatus}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending Invitations</CardTitle>
          <CardDescription>Users who have not yet accepted their invitation.</CardDescription>
        </CardHeader>
        <CardContent>
          {invitations.filter(i => i.status === 'PENDING').length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
              No pending invitations.
            </div>
          ) : (
            <div className="space-y-2">
              {invitations.filter(i => i.status === 'PENDING').map(inv => (
                <div key={inv.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-50">{inv.email}</div>
                    <div className="text-xs text-slate-500">
                      Role: <span className="font-semibold">{inv.role}</span>
                      {' · '}
                      Invited by {inv.invitedByName ?? 'unknown'}
                      {' · '}
                      Expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  {isAdmin && (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => revoke(inv.id)}>
                      <XIcon className="h-3.5 w-3.5" /> Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showInvite && isAdmin && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onCreated={data => {
            setShowInvite(false)
            setShowInviteLink({ url: data.url, email: data.invitation.email })
            refresh()
          }}
        />
      )}

      {showInviteLink && (
        <InviteLinkModal
          email={showInviteLink.email}
          url={showInviteLink.url}
          onClose={() => setShowInviteLink(null)}
        />
      )}
    </div>
  )
}

function UserRow({
  user, isAdmin, isSelf, pending, onChangeRole, onToggleStatus,
}: {
  user: User
  isAdmin: boolean
  isSelf: boolean
  pending: boolean
  onChangeRole: (id: string, role: string) => void
  onToggleStatus: (id: string, status: 'ACTIVE' | 'DISABLED') => void
}) {
  const isActive = user.status === 'ACTIVE' && !user.disabledAt
  const [editingRole, setEditingRole] = useState(false)
  return (
    <tr className="border-b border-slate-100 last:border-0 dark:border-slate-800">
      <td className="px-3 py-3">
        <div className="font-medium text-slate-900 dark:text-slate-50">{user.firstName} {user.lastName}</div>
        <div className="text-xs text-slate-500">{user.departmentName ?? '—'}</div>
      </td>
      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{user.email}</td>
      <td className="px-3 py-3">
        {!isAdmin || isSelf ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            {user.role}
          </span>
        ) : editingRole ? (
          <select
            defaultValue={user.role}
            onChange={e => { setEditingRole(false); onChangeRole(user.id, e.target.value) }}
            onBlur={() => setEditingRole(false)}
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-800"
            autoFocus
          >
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        ) : (
          <button
            onClick={() => setEditingRole(true)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {ROLES.find(r => r.value === user.role)?.label ?? user.role}
          </button>
        )}
      </td>
      <td className="px-3 py-3">
        {isActive ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
            <CheckIcon className="h-3 w-3" /> Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <ShieldOffIcon className="h-3 w-3" /> Disabled
          </span>
        )}
      </td>
      <td className="px-3 py-3 text-xs text-slate-500">
        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}
      </td>
      {isAdmin && (
        <td className="px-3 py-3 text-right">
          {!isSelf ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => onToggleStatus(user.id, isActive ? 'DISABLED' : 'ACTIVE')}
            >
              {isActive ? 'Disable' : 'Reactivate'}
            </Button>
          ) : <span className="text-xs text-slate-400">you</span>}
        </td>
      )}
    </tr>
  )
}

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (data: any) => void }) {
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState<typeof ROLES[number]['value']>('RECRUITER')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    startTransition(async () => {
      const res = await createUserInvitationAction({ email, firstName, lastName, role, departmentId: null })
      if (!res.ok) setError(res.error?.message ?? 'Failed to create invitation')
      else onCreated(res.data)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-slate-800">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <UserPlusIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Invite a user</h2>
            <p className="text-xs text-slate-500">An invitation link will be generated. The user sets their own password.</p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">First name</label>
              <input
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="Sarah"
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Last name</label>
              <input
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="Chen"
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as any)}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label} — {r.description}</option>)}
            </select>
          </div>
        </div>
        {error && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !email || !firstName || !lastName}>
            {pending ? <><LoaderIcon className="h-4 w-4 animate-spin" /> Creating…</> : <>Create invitation</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

function InviteLinkModal({ email, url, onClose }: { email: string; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-slate-800">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Invitation created</h2>
            <p className="text-xs text-slate-500">Send this link to {email} within 7 days.</p>
          </div>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          Copy the link below and send it to the new user. The link is single-use and expires in 7 days. The token is not stored in plaintext.
        </p>
        <div className="mt-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">
          <code className="flex-1 break-all text-xs text-slate-700 dark:text-slate-200">{url}</code>
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><CopyIcon className="h-3.5 w-3.5" /> Copy</>}
          </Button>
        </div>
        <p className="mt-3 text-[10px] text-slate-500">For security, the raw token will not be shown again after you close this dialog.</p>
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  )
}
