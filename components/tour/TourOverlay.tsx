'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { Button } from '@/components/ui/button'
import { computePlacement, scrollDelta } from '@/lib/tour/placement'
import { findVisibleTarget } from '@/lib/tour/steps'
import type { Rect, Size, TourStep } from '@/lib/tour/types'

interface TourOverlayProps {
  step: TourStep
  selectors: string[]
  /** Zero-based index of the current step. */
  index: number
  total: number
  isLast: boolean
  onNext: () => void
  onPrev: () => void
  onSkip: () => void
}

/** Breathing room around the highlighted element. */
const SPOTLIGHT_PADDING = 6
const TOPBAR_HEIGHT = 56
const MAX_CARD_WIDTH = 360
const VIEWPORT_MARGIN = 12

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

function sameSize(a: Size, b: Size): boolean {
  return a.width === b.width && a.height === b.height
}

/** True when the element (or an ancestor) is `position: fixed` — scrolling the page won't move it. */
function isInsideFixed(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (getComputedStyle(node).position === 'fixed') return true
  }
  return false
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function TourOverlay({
  step,
  selectors,
  index,
  total,
  isLast,
  onNext,
  onPrev,
  onSkip,
}: TourOverlayProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const [cardSize, setCardSize] = useState<Size>({ width: 0, height: 0 })
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 })
  const selectorsKey = selectors.join('|')

  const measureTarget = useCallback(() => {
    const el = findVisibleTarget(selectors, document)
    const next: Rect | null = el
      ? (() => {
          const r = el.getBoundingClientRect()
          return { top: r.top, left: r.left, width: r.width, height: r.height }
        })()
      : null
    setTargetRect((prev) => (sameRect(prev, next) ? prev : next))
    setViewport((prev) => {
      const v = { width: window.innerWidth, height: window.innerHeight }
      return sameSize(prev, v) ? prev : v
    })
    return el
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectorsKey is the stable identity of `selectors`
  }, [selectorsKey])

  // Keep the spotlight glued to the element while the page scrolls/resizes/reflows.
  useEffect(() => {
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        measureTarget()
      })
    }
    measureTarget()

    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    const el = findVisibleTarget(selectors, document)
    if (el) observer?.observe(el)
    observer?.observe(document.body)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      observer?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectorsKey is the stable identity of `selectors`
  }, [selectorsKey, measureTarget])

  // Measure the card so placement can account for its real size. Runs after
  // every render on purpose (content changes per step); the setter bails out
  // when the size is unchanged, so it cannot loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const node = cardRef.current
    if (!node) return
    const next = { width: node.offsetWidth, height: node.offsetHeight }
    setCardSize((prev) => (sameSize(prev, next) ? prev : next))
  })

  const padded: Rect | null = targetRect && {
    top: targetRect.top - SPOTLIGHT_PADDING,
    left: targetRect.left - SPOTLIGHT_PADDING,
    width: targetRect.width + SPOTLIGHT_PADDING * 2,
    height: targetRect.height + SPOTLIGHT_PADDING * 2,
  }

  const cardWidth = Math.min(MAX_CARD_WIDTH, Math.max(viewport.width - VIEWPORT_MARGIN * 2, 0))
  const measured = viewport.width > 0 && cardSize.height > 0

  const layout = (() => {
    if (!measured) return null
    const size = { width: cardWidth, height: cardSize.height }
    if (!padded) {
      return {
        placement: 'center' as const,
        top: Math.max((viewport.height - size.height) / 2, VIEWPORT_MARGIN),
        left: Math.max((viewport.width - size.width) / 2, VIEWPORT_MARGIN),
        arrow: null,
      }
    }
    return computePlacement({
      target: padded,
      tooltip: size,
      viewport,
      preferred: step.placement ?? 'bottom',
      margin: VIEWPORT_MARGIN,
    })
  })()

  const docked = layout?.placement === 'docked'

  // Bring the target into view before (and while) the card is shown.
  useEffect(() => {
    if (!measured) return
    const el = findVisibleTarget(selectors, document)
    if (!el) return
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'

    // Nested scrollers (e.g. the sidebar list) first, then the page itself.
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior })
    if (isInsideFixed(el)) return

    const rect = el.getBoundingClientRect()
    const delta = scrollDelta({
      top: rect.top - SPOTLIGHT_PADDING,
      bottom: rect.bottom + SPOTLIGHT_PADDING,
      viewportHeight: window.innerHeight,
      topInset: TOPBAR_HEIGHT,
      bottomInset: docked ? cardSize.height + VIEWPORT_MARGIN : 0,
    })
    if (delta !== 0) window.scrollBy({ top: delta, behavior })
    // Only re-run when the step changes or the card switches to the docked layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, measured, docked])

  // Focus the card on each step so screen readers announce it and Tab stays inside.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true })
  }, [step.id])

  // Keyboard: Esc skips, arrows navigate, Tab is trapped inside the card.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onSkip()
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        onNext()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (index > 0) onPrev()
        return
      }
      if (event.key === 'Tab') {
        const card = cardRef.current
        if (!card) return
        const focusables = Array.from(
          card.querySelectorAll<HTMLElement>('button:not([disabled])'),
        )
        if (focusables.length === 0) {
          event.preventDefault()
          return
        }
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (event.shiftKey && (active === first || active === card)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        } else if (!card.contains(active)) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [index, onNext, onPrev, onSkip])

  if (typeof document === 'undefined') return null

  const titleId = 'tour-title'
  const descriptionId = 'tour-description'
  const progress = ((index + 1) / total) * 100

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      {/* Swallows clicks so the page underneath is inert while the tour runs. */}
      <div className="absolute inset-0" aria-hidden="true" />

      {padded ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-card ring-2 ring-brand transition-[top,left,width,height] duration-200 ease-out motion-reduce:transition-none"
          style={{
            top: padded.top,
            left: padded.left,
            width: padded.width,
            height: padded.height,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.62)',
          }}
        />
      ) : (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-ink/60" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cn(
          'absolute rounded-card border border-content-border bg-content-surface p-4 shadow-modal outline-none',
          'transition-[top,left,opacity] duration-200 ease-out motion-reduce:transition-none',
          layout ? 'opacity-100' : 'opacity-0',
        )}
        style={{
          width: cardWidth || undefined,
          top: layout?.top ?? 0,
          left: layout?.left ?? 0,
        }}
      >
        {layout?.arrow && <Arrow side={layout.arrow.side} offset={layout.arrow.offset} />}

        <div className="flex items-start justify-between gap-2">
          <h2 id={titleId} className="text-[15px] font-semibold leading-snug text-ink">
            {step.title}
          </h2>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Fechar tutorial"
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-content-bg hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p id={descriptionId} className="mt-1.5 text-sm leading-relaxed text-ink-secondary">
          {step.description}
        </p>

        <div className="mt-4 flex items-center gap-3">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-badge bg-content-bg"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-badge bg-brand transition-[width] duration-200 motion-reduce:transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-ink-secondary">
            {index + 1} de {total}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="mr-auto min-h-11 rounded-md px-1 text-sm font-medium text-ink-secondary underline-offset-4 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:min-h-0"
          >
            Pular tutorial
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPrev}
            disabled={index === 0}
            className="min-h-11 sm:min-h-0"
          >
            {step.prevLabel ?? 'Anterior'}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onNext}
            className="min-h-11 sm:min-h-0"
          >
            {isLast ? 'Concluir' : (step.nextLabel ?? 'Próximo')}
          </Button>
        </div>

        {/* Announces the step to assistive tech when it changes. */}
        <p className="sr-only" aria-live="polite">
          Etapa {index + 1} de {total}: {step.title}
        </p>
      </div>
    </div>,
    document.body,
  )
}

/** Small diamond on the card edge that faces the highlighted element. */
function Arrow({ side, offset }: { side: 'top' | 'bottom' | 'left' | 'right'; offset: number }) {
  const base =
    'pointer-events-none absolute h-3 w-3 rotate-45 border-content-border bg-content-surface'
  switch (side) {
    case 'top':
      return (
        <span
          aria-hidden="true"
          className={cn(base, '-top-1.5 -ml-1.5 border-l border-t')}
          style={{ left: offset }}
        />
      )
    case 'bottom':
      return (
        <span
          aria-hidden="true"
          className={cn(base, '-bottom-1.5 -ml-1.5 border-b border-r')}
          style={{ left: offset }}
        />
      )
    case 'left':
      return (
        <span
          aria-hidden="true"
          className={cn(base, '-left-1.5 -mt-1.5 border-b border-l')}
          style={{ top: offset }}
        />
      )
    case 'right':
      return (
        <span
          aria-hidden="true"
          className={cn(base, '-right-1.5 -mt-1.5 border-r border-t')}
          style={{ top: offset }}
        />
      )
  }
}
