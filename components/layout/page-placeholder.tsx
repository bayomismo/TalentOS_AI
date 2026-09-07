interface PagePlaceholderProps {
  title: string
}

export function PagePlaceholder({ title }: PagePlaceholderProps) {
  return (
    <div className="space-y-6 p-8">
      <section>
        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-50">
          {title}
        </h3>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Coming soon
          </p>
        </div>
      </section>
    </div>
  )
}
