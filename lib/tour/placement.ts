import type { Rect, Size, TourPlacement } from './types'

/**
 * Pure geometry for the tour card: where to put it next to the highlighted
 * element, and how far to scroll so that element is reachable.
 */

export interface PlacementInput {
  /** Highlighted element, already padded, in viewport coordinates. */
  target: Rect
  tooltip: Size
  viewport: Size
  preferred?: TourPlacement
  /** Space between the target and the card. */
  gap?: number
  /** Minimum distance kept to the viewport edges. */
  margin?: number
}

export interface PlacementResult {
  /** `docked` = nothing fits next to the target; card sits at the bottom. */
  placement: TourPlacement | 'docked'
  top: number
  left: number
  /** Arrow position along the card edge facing the target, or null. */
  arrow: { side: TourPlacement; offset: number } | null
}

const OPPOSITE: Record<TourPlacement, TourPlacement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

const PERPENDICULAR: Record<TourPlacement, [TourPlacement, TourPlacement]> = {
  top: ['right', 'left'],
  bottom: ['right', 'left'],
  left: ['bottom', 'top'],
  right: ['bottom', 'top'],
}

function clamp(value: number, min: number, max: number): number {
  // When the card is larger than the room (max < min) pin it to the start edge.
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

const ARROW_INSET = 16

export function computePlacement({
  target,
  tooltip,
  viewport,
  preferred = 'bottom',
  gap = 12,
  margin = 12,
}: PlacementInput): PlacementResult {
  const candidates: TourPlacement[] = [
    preferred,
    OPPOSITE[preferred],
    ...PERPENDICULAR[preferred],
  ]

  const maxLeft = viewport.width - tooltip.width - margin
  const maxTop = viewport.height - tooltip.height - margin

  for (const placement of candidates) {
    let top: number
    let left: number

    if (placement === 'bottom') {
      top = target.top + target.height + gap
      left = target.left + target.width / 2 - tooltip.width / 2
      if (top > maxTop) continue
    } else if (placement === 'top') {
      top = target.top - gap - tooltip.height
      left = target.left + target.width / 2 - tooltip.width / 2
      if (top < margin) continue
    } else if (placement === 'right') {
      left = target.left + target.width + gap
      top = target.top + target.height / 2 - tooltip.height / 2
      if (left > maxLeft) continue
    } else {
      left = target.left - gap - tooltip.width
      top = target.top + target.height / 2 - tooltip.height / 2
      if (left < margin) continue
    }

    left = clamp(left, margin, maxLeft)
    top = clamp(top, margin, maxTop)

    const vertical = placement === 'top' || placement === 'bottom'
    const targetCenter = vertical
      ? target.left + target.width / 2
      : target.top + target.height / 2
    const cardStart = vertical ? left : top
    const cardSize = vertical ? tooltip.width : tooltip.height
    const offset = clamp(
      targetCenter - cardStart,
      ARROW_INSET,
      cardSize - ARROW_INSET,
    )

    // The arrow sits on the card edge that faces the target.
    return { placement, top, left, arrow: { side: OPPOSITE[placement], offset } }
  }

  return {
    placement: 'docked',
    top: clamp(maxTop, margin, maxTop),
    left: clamp((viewport.width - tooltip.width) / 2, margin, maxLeft),
    arrow: null,
  }
}

export interface ScrollRevealInput {
  /** Target's top/bottom in viewport coordinates. */
  top: number
  bottom: number
  viewportHeight: number
  /** Fixed chrome covering the top of the viewport (e.g. the topbar). */
  topInset?: number
  /** Space to keep free at the bottom (e.g. a docked card). */
  bottomInset?: number
  margin?: number
}

/**
 * Vertical scroll (positive = down) needed to bring the target fully into the
 * visible area; `0` when it is already there. A target taller than the area is
 * aligned to the top so its beginning is what the user sees.
 */
export function scrollDelta({
  top,
  bottom,
  viewportHeight,
  topInset = 0,
  bottomInset = 0,
  margin = 16,
}: ScrollRevealInput): number {
  const minTop = topInset + margin
  const maxBottom = viewportHeight - bottomInset - margin

  if (bottom - top > maxBottom - minTop) return top - minTop
  if (top < minTop) return top - minTop
  if (bottom > maxBottom) return bottom - maxBottom
  return 0
}
