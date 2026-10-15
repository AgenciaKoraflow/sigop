import type { TourStep } from './types'

/** The selectors of a step as a list (empty for a centered, target-less step). */
export function stepSelectors(step: Pick<TourStep, 'target'>): string[] {
  if (!step.target) return []
  return Array.isArray(step.target) ? step.target : [step.target]
}

/**
 * Steps worth showing right now: those without a target (centered cards) and
 * those with at least one currently visible target. Keeps "1 de N" honest when
 * part of the screen is not rendered for this user or viewport.
 */
export function resolveAvailableSteps<T extends Pick<TourStep, 'target'>>(
  steps: T[],
  isVisible: (selector: string) => boolean,
): T[] {
  return steps.filter((step) => {
    const selectors = stepSelectors(step)
    return selectors.length === 0 || selectors.some(isVisible)
  })
}

interface Measurable {
  getBoundingClientRect(): { width: number; height: number }
}

interface Queryable<E extends Measurable> {
  querySelectorAll(selector: string): ArrayLike<E>
}

/**
 * First element matching any selector (in order) that actually takes space on
 * screen. Invalid selectors and zero-size elements (display:none, collapsed)
 * are ignored rather than thrown.
 */
export function findVisibleTarget<E extends Measurable>(
  selectors: string[],
  root: Queryable<E>,
): E | null {
  for (const selector of selectors) {
    let matches: ArrayLike<E>
    try {
      matches = root.querySelectorAll(selector)
    } catch {
      continue
    }
    for (let i = 0; i < matches.length; i += 1) {
      const rect = matches[i].getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) return matches[i]
    }
  }
  return null
}
