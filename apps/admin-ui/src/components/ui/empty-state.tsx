import * as React from 'react'
import { cn } from '@/lib/utils'

/** Empty state: icon, title, description, optional action. */
function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-14 text-center', className)}>
      <div className="flex size-12 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground">
        {icon}
      </div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      {description !== undefined && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  )
}

export { EmptyState }
