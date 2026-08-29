import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils/cn"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",

        // --- SIGOP · incident operational status ---------------------
        open:
          "border-transparent bg-status-open-bg text-status-open-text",
        in_progress:
          "border-transparent bg-status-in-progress-bg text-status-in-progress-text",
        closed:
          "border-transparent bg-status-closed-bg text-status-closed-text",
        archived:
          "border-transparent bg-status-archived-bg text-status-archived-text",
        in_flagrante:
          "border-transparent bg-status-in-flagrante-bg text-status-in-flagrante-text",

        // --- SIGOP · sync status (offline-first) ---------------------
        draft:
          "border-transparent bg-sync-draft-bg text-sync-draft-text",
        pending:
          "border-transparent bg-sync-pending-bg text-sync-pending-text",
        syncing:
          "border-transparent bg-sync-syncing-bg text-sync-syncing-text",
        synced:
          "border-transparent bg-sync-synced-bg text-sync-synced-text",
        error:
          "border-transparent bg-sync-error-bg text-sync-error-text",
        conflict:
          "border-transparent bg-sync-conflict-bg text-sync-conflict-text",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
