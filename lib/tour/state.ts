/** Navigation state of the running tour (which step, out of how many). */
export interface TourNavState {
  active: boolean
  index: number
  total: number
}

export type TourNavAction =
  | { type: 'start'; total: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'stop' }

export const initialTourNavState: TourNavState = { active: false, index: 0, total: 0 }

export function tourNavReducer(state: TourNavState, action: TourNavAction): TourNavState {
  switch (action.type) {
    case 'start':
      return action.total > 0
        ? { active: true, index: 0, total: action.total }
        : initialTourNavState
    case 'next':
      if (!state.active) return state
      return { ...state, index: Math.min(state.index + 1, state.total - 1) }
    case 'prev':
      if (!state.active) return state
      return { ...state, index: Math.max(state.index - 1, 0) }
    case 'stop':
      return initialTourNavState
  }
}

export function isLastStep(state: TourNavState): boolean {
  return state.active && state.index >= state.total - 1
}
