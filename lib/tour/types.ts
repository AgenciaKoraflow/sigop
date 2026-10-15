/**
 * Guided tour (onboarding) — shared types.
 *
 * A tour is a list of steps; each step points at a UI element through a stable
 * `data-tour="..."` attribute and explains it. Identifiers stay in English,
 * user-facing copy stays in Portuguese.
 */

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right'

export interface TourStep {
  /** Unique within the tour. */
  id: string
  /**
   * CSS selector(s) of the element to highlight. With several selectors the
   * first one that is currently visible wins (e.g. desktop sidebar → mobile
   * menu button). Omit for a centered card with no spotlight.
   */
  target?: string | string[]
  title: string
  description: string
  /** Preferred side for the card; flipped automatically when it does not fit. */
  placement?: TourPlacement
  /** Overrides the "Próximo" label for this step. */
  nextLabel?: string
  /** Overrides the "Anterior" label for this step. */
  prevLabel?: string
  /** Runs right before the step is shown (e.g. to open a collapsed section). */
  onEnter?: () => void
}

export interface TourDefinition {
  /** Stable id, used in the persistence key. */
  id: string
  /** Bump to show an updated tour again to users who already finished it. */
  version: number
  steps: TourStep[]
}

export type TourStatus = 'completed' | 'skipped'

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}
