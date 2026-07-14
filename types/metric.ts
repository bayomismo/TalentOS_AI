export type Metric = {
  label: string
  value: string | number
  change?: number
  trend?: 'up' | 'down'
}
