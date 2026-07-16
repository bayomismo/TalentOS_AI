'use client'

import { ClockIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shared/card'

export function ComingSoonSection({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>This section is not yet implemented.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
          <ClockIcon className="h-5 w-5 flex-shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900 dark:text-amber-200">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}
