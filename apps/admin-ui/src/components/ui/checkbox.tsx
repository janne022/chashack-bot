import * as React from "react"
import { cn } from "cn"
import { Check } from "lucide-react"

function Checkbox({
  className,
  checked,
  onCheckedChange,
  ...props
}: React.ComponentProps<"input"> & {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 cursor-pointer select-none",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        className="peer sr-only"
        {...props}
      />
      <span
        className={cn(
          "flex size-4 items-center justify-center rounded border border-input bg-surface-2 text-accent shadow-xs transition-colors",
          "peer-data-[state=checked]:bg-accent peer-data-[state=checked]:border-accent",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50",
          "peer-disabled:opacity-50 peer-disabled:cursor-not-allowed",
        )}
      >
        {checked && <Check className="size-3 text-accent-foreground" />}
      </span>
    </label>
  )
}

export { Checkbox }