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

        // --- SIGOP · status operacional da ocorrência ----------------
        aberta:
          "border-transparent bg-status-aberta-bg text-status-aberta-text",
        em_andamento:
          "border-transparent bg-status-andamento-bg text-status-andamento-text",
        encerrada:
          "border-transparent bg-status-encerrada-bg text-status-encerrada-text",
        arquivada:
          "border-transparent bg-status-arquivada-bg text-status-arquivada-text",
        flagrante:
          "border-transparent bg-status-flagrante-bg text-status-flagrante-text",

        // --- SIGOP · status de sincronização (offline-first) ---------
        rascunho:
          "border-transparent bg-sync-rascunho-bg text-sync-rascunho-text",
        pendente:
          "border-transparent bg-sync-pendente-bg text-sync-pendente-text",
        sincronizando:
          "border-transparent bg-sync-sincronizando-bg text-sync-sincronizando-text",
        sincronizado:
          "border-transparent bg-sync-sincronizado-bg text-sync-sincronizado-text",
        erro:
          "border-transparent bg-sync-erro-bg text-sync-erro-text",
        conflito:
          "border-transparent bg-sync-conflito-bg text-sync-conflito-text",
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
