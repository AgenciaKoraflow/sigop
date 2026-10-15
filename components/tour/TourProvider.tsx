'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { usePathname } from 'next/navigation'
import { useCurrentUser } from '@/hooks/use-current-user'
import { findVisibleTarget, resolveAvailableSteps, stepSelectors } from '@/lib/tour/steps'
import { getBrowserStorage, readTourStatus, writeTourStatus } from '@/lib/tour/progress'
import { initialTourNavState, isLastStep, tourNavReducer } from '@/lib/tour/state'
import type { TourDefinition, TourStatus, TourStep } from '@/lib/tour/types'
import { TourOverlay } from './TourOverlay'

interface TourContextValue {
  /** Starts a tour; returns false when no step is available on this screen. */
  startTour: (tour: TourDefinition) => boolean
  /** Whether the signed-in user already finished/skipped this tour version. */
  hasSeen: (tour: TourDefinition) => boolean
  /** True once per tour per app session — guards auto-start from repeating. */
  claimAutoStart: (tour: TourDefinition) => boolean
  isActive: boolean
  userId: string | null
}

const TourContext = createContext<TourContextValue | null>(null)

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour must be used inside <TourProvider>')
  return ctx
}

/**
 * Starts `tour` automatically the first time the signed-in user lands on the
 * screen that renders this hook. Does nothing if they already saw it.
 */
export function useAutoStartTour(tour: TourDefinition, delayMs = 700) {
  const { startTour, hasSeen, claimAutoStart, userId } = useTour()

  useEffect(() => {
    if (!userId || hasSeen(tour)) return
    // Let the screen finish its first layout before measuring targets.
    const timer = window.setTimeout(() => {
      if (claimAutoStart(tour)) startTour(tour)
    }, delayMs)
    return () => window.clearTimeout(timer)
  }, [userId, tour, delayMs, startTour, hasSeen, claimAutoStart])
}

interface Session {
  tour: TourDefinition
  steps: TourStep[]
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { user } = useCurrentUser()
  const userId = user?.id ?? null
  const pathname = usePathname()

  const [session, setSession] = useState<Session | null>(null)
  const [nav, dispatch] = useReducer(tourNavReducer, initialTourNavState)

  const returnFocusRef = useRef<HTMLElement | null>(null)
  const autoStartedRef = useRef<Set<string>>(new Set())

  const close = useCallback(
    (status: TourStatus | null) => {
      if (status && userId && session) {
        writeTourStatus(
          getBrowserStorage(),
          userId,
          session.tour.id,
          session.tour.version,
          status,
        )
      }
      dispatch({ type: 'stop' })
      setSession(null)
      const target = returnFocusRef.current
      returnFocusRef.current = null
      if (target && document.contains(target)) target.focus()
    },
    [session, userId],
  )

  const startTour = useCallback((tour: TourDefinition) => {
    if (typeof document === 'undefined') return false
    const steps = resolveAvailableSteps(tour.steps, (selector) =>
      findVisibleTarget([selector], document) !== null,
    )
    if (steps.length === 0) return false

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSession({ tour, steps })
    dispatch({ type: 'start', total: steps.length })
    return true
  }, [])

  const hasSeen = useCallback(
    (tour: TourDefinition) =>
      userId !== null &&
      readTourStatus(getBrowserStorage(), userId, tour.id, tour.version) !== null,
    [userId],
  )

  const claimAutoStart = useCallback((tour: TourDefinition) => {
    const key = `${tour.id}:${tour.version}`
    if (autoStartedRef.current.has(key)) return false
    autoStartedRef.current.add(key)
    return true
  }, [])

  // Leaving the screen aborts the tour without recording it as seen.
  useEffect(() => {
    return () => {
      dispatch({ type: 'stop' })
      setSession(null)
    }
  }, [pathname])

  const step = session && nav.active ? session.steps[nav.index] : null

  useEffect(() => {
    step?.onEnter?.()
  }, [step])

  const value = useMemo<TourContextValue>(
    () => ({ startTour, hasSeen, claimAutoStart, isActive: nav.active, userId }),
    [startTour, hasSeen, claimAutoStart, nav.active, userId],
  )

  return (
    <TourContext.Provider value={value}>
      {children}
      {step && (
        <TourOverlay
          key={session!.tour.id}
          step={step}
          selectors={stepSelectors(step)}
          index={nav.index}
          total={nav.total}
          isLast={isLastStep(nav)}
          onNext={() => (isLastStep(nav) ? close('completed') : dispatch({ type: 'next' }))}
          onPrev={() => dispatch({ type: 'prev' })}
          onSkip={() => close('skipped')}
        />
      )}
    </TourContext.Provider>
  )
}
