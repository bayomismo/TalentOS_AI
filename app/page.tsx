'use client'

import { useEffect, useState } from 'react'
import { StatCard } from '@/components/stat-card'
import { HiringRequestsTable } from '@/components/hiring-requests-table'
import { PipelineColumn } from '@/components/pipeline-column'
import { ActivityTimeline } from '@/components/activity-timeline'
import {
  data,
  getCandidatesByStage,
  getMetrics,
  getActivities,
  getPositions,
} from '@/lib/data'
import {
  BriefcaseIcon,
  UsersIcon,
  TrendingUpIcon,
  CommandIcon,
  MenuIcon,
  XIcon,
} from 'lucide-react'

export default function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showCommandPalette, setShowCommandPalette] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(!showCommandPalette)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showCommandPalette])

  const candidatesByStage = getCandidatesByStage()
  const metrics = getMetrics()
  const activities = getActivities()
  const positions = getPositions()

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } border-r border-slate-200 bg-white transition-all duration-300 dark:border-slate-700 dark:bg-slate-800`}
      >
        <div className="flex h-16 items-center justify-between px-4">
          {sidebarOpen && (
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50">
              TalentOS
            </h1>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            {sidebarOpen ? (
              <XIcon className="h-5 w-5 text-slate-600 dark:text-slate-400" />
            ) : (
              <MenuIcon className="h-5 w-5 text-slate-600 dark:text-slate-400" />
            )}
          </button>
        </div>

        <nav className="space-y-2 px-3 py-6">
          <a
            href="#"
            className="flex items-center gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200"
          >
            <BriefcaseIcon className="h-5 w-5 flex-shrink-0" />
            {sidebarOpen && <span>Dashboard</span>}
          </a>
          <a
            href="#"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <UsersIcon className="h-5 w-5 flex-shrink-0" />
            {sidebarOpen && <span>Candidates</span>}
          </a>
          <a
            href="#"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <TrendingUpIcon className="h-5 w-5 flex-shrink-0" />
            {sidebarOpen && <span>Analytics</span>}
          </a>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Nav */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-4 dark:border-slate-700 dark:bg-slate-800">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            Recruitment Dashboard
          </h2>
          <button
            onClick={() => setShowCommandPalette(true)}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <CommandIcon className="h-4 w-4" />
            <span>Cmd+K</span>
          </button>
        </header>

        {/* Command Palette Overlay */}
        {showCommandPalette && (
          <div
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => setShowCommandPalette(false)}
          >
            <div
              className="fixed top-1/4 left-1/2 w-96 -translate-x-1/2 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4">
                <input
                  type="text"
                  placeholder="Search positions, candidates..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm placeholder-slate-500 focus:border-emerald-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:placeholder-slate-400"
                  autoFocus
                />
              </div>
              <div className="border-t border-slate-200 p-3 dark:border-slate-700">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Quick navigation features coming soon
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="overflow-auto flex-1">
          <div className="space-y-6 p-8">
            {/* Key Metrics */}
            <section>
              <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-50">
                Key Metrics
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {metrics.map((metric, idx) => (
                  <StatCard
                    key={idx}
                    label={metric.label}
                    value={metric.value}
                    change={metric.change}
                    trend={metric.trend}
                  />
                ))}
              </div>
            </section>

            {/* Recent Hiring Requests */}
            <section>
              <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-50">
                Open Positions
              </h3>
              <HiringRequestsTable positions={positions} />
            </section>

            {/* Candidate Pipeline */}
            <section>
              <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-50">
                Candidate Pipeline
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
                <PipelineColumn
                  title="Applied"
                  stage="applied"
                  candidates={candidatesByStage.applied}
                  count={candidatesByStage.applied.length}
                />
                <PipelineColumn
                  title="Screening"
                  stage="screening"
                  candidates={candidatesByStage.screening}
                  count={candidatesByStage.screening.length}
                />
                <PipelineColumn
                  title="Interview"
                  stage="interview"
                  candidates={candidatesByStage.interview}
                  count={candidatesByStage.interview.length}
                />
                <PipelineColumn
                  title="Offer"
                  stage="offer"
                  candidates={candidatesByStage.offer}
                  count={candidatesByStage.offer.length}
                />
                <PipelineColumn
                  title="Hired"
                  stage="hired"
                  candidates={candidatesByStage.hired}
                  count={candidatesByStage.hired.length}
                />
              </div>
            </section>

            {/* Recent Activity */}
            <section>
              <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-50">
                Recent Activity
              </h3>
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <ActivityTimeline activities={activities} />
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}
