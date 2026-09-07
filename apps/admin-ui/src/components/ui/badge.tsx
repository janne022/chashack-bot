import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-accent-soft text-accent',
        secondary: 'bg-surface-2 text-muted-foreground border border-border',
        outline: 'border border-border text-foreground',
        success: 'bg-ok/15 text-ok',
        warning: 'bg-warn/15 text-warn',
        destructive: 'bg-danger/15 text-danger',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
