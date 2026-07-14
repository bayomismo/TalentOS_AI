'use client'

import type { Activity } from '@/types'
import {
  FileTextIcon,
  CheckCircle2Icon,
  UserPlusIcon,
  GiftIcon,
  ArrowRightIcon,
} from 'lucide-react'

interface ActivityTimelineProps {
  activities: Activity[]
}

function getActivityIcon(type: Activity['type']) {
  switch (type) {
    case 'application':
      return <FileTextIcon className="h-4 w-4" />
    case 'moved':
      return <ArrowRightIcon className="h-4 w-4" />
    case 'interview':
      return <UserPlusIcon className="h-4 w-4" />
    case 'offer':
      return <GiftIcon className="h-4 w-4" />
    case 'hired':
      return <CheckCircle2Icon className="h-4 w-4" />
    default:
      return null
  }
}

function getActivityColor(type: Activity['type']) {
  switch (type) {
    case 'application':
      return 'bg-blue-500'
    case 'moved':
      return 'bg-purple-500'
    case 'interview':
      return 'bg-cyan-500'
    case 'offer':
      return 'bg-yellow-500'
    case 'hired':
      return 'bg-emerald-500'
    default:
      return 'bg-slate-500'
  }
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  return (
    <div className="space-y-4">
      {activities.map((activity, idx) => (
        <div key={activity.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full ${getActivityColor(activity.type)} text-white`}
            >
              {getActivityIcon(activity.type)}
            </div>
            {idx < activities.length - 1 && (
              <div className="mt-2 h-8 w-0.5 bg-slate-200 dark:bg-slate-700" />
            )}
          </div>
          <div className="flex-1 pb-2">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                {activity.candidateName} {activity.type === 'moved' ? '→' : '·'}{' '}
                {activity.positionTitle}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {activity.details}
              </p>
              <time className="text-xs text-slate-400 dark:text-slate-500">
                {activity.timestamp.toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
