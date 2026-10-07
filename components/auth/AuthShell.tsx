import type { ReactNode } from 'react'

export const authInputClass =
  'flex h-10 w-full rounded-input border border-content-border bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60'

export const authButtonClass =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-input bg-brand text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70'

/** Centered card used by the password recovery / first-login screens. */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-content-bg px-4 py-10">
      <div className="w-full max-w-[400px] rounded-2xl bg-white p-10 shadow-modal">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-xs font-bold text-white">
            SG
          </div>
          <span className="text-base font-bold text-ink">SIGOP</span>
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-ink">{title}</h1>
          <p className="text-sm text-ink-secondary">{subtitle}</p>
        </div>
        <div className="mt-8">{children}</div>
      </div>
    </main>
  )
}
