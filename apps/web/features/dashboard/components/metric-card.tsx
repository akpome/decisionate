interface MetricCardProps {
  title: string
  value: string | number
  description?: string
}

export function MetricCard({
  title,
  value,
  description,
}: MetricCardProps) {
  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-500">
          {title}
        </p>

        <h2 className="text-3xl font-bold tracking-tight">
          {value}
        </h2>

        {description && (
          <p className="text-sm text-gray-500">
            {description}
          </p>
        )}
      </div>
    </div>
  )
}