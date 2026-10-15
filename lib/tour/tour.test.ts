import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computePlacement, scrollDelta } from './placement.ts'
import { findVisibleTarget, resolveAvailableSteps, stepSelectors } from './steps.ts'
import { initialTourNavState, isLastStep, tourNavReducer } from './state.ts'
import { readTourStatus, tourStorageKey, writeTourStatus } from './progress.ts'

const viewport = { width: 1000, height: 700 }
const card = { width: 300, height: 150 }

describe('computePlacement', () => {
  it('uses the preferred side when it fits', () => {
    const r = computePlacement({
      target: { top: 100, left: 400, width: 100, height: 40 },
      tooltip: card,
      viewport,
      preferred: 'bottom',
    })
    assert.equal(r.placement, 'bottom')
    assert.equal(r.top, 152)
    assert.equal(r.left, 300)
    assert.equal(r.arrow?.side, 'top')
  })

  it('flips to the opposite side when the preferred one overflows', () => {
    const r = computePlacement({
      target: { top: 600, left: 400, width: 100, height: 40 },
      tooltip: card,
      viewport,
      preferred: 'bottom',
    })
    assert.equal(r.placement, 'top')
    assert.ok(r.top >= 12)
    assert.ok(r.top + card.height <= 600)
  })

  it('never leaves the viewport horizontally', () => {
    const r = computePlacement({
      target: { top: 100, left: 0, width: 40, height: 40 },
      tooltip: card,
      viewport,
      preferred: 'bottom',
    })
    assert.ok(r.left >= 12)
    const far = computePlacement({
      target: { top: 100, left: 960, width: 40, height: 40 },
      tooltip: card,
      viewport,
      preferred: 'bottom',
    })
    assert.ok(far.left + card.width <= viewport.width - 12)
  })

  it('tries the sides when top/bottom cannot fit (tall target)', () => {
    const r = computePlacement({
      target: { top: 0, left: 0, width: 200, height: 700 },
      tooltip: card,
      viewport,
      preferred: 'bottom',
    })
    assert.equal(r.placement, 'right')
  })

  it('docks the card when nothing fits (small phone, big target)', () => {
    const r = computePlacement({
      target: { top: 0, left: 0, width: 360, height: 640 },
      tooltip: { width: 336, height: 200 },
      viewport: { width: 360, height: 640 },
    })
    assert.equal(r.placement, 'docked')
    assert.equal(r.arrow, null)
    assert.ok(r.top + 200 <= 640)
    assert.ok(r.left >= 12)
  })
})

describe('scrollDelta', () => {
  const base = { viewportHeight: 700, topInset: 56 }

  it('is 0 when the target is already comfortably visible', () => {
    assert.equal(scrollDelta({ ...base, top: 200, bottom: 260 }), 0)
  })
  it('scrolls down for a target below the fold', () => {
    assert.equal(scrollDelta({ ...base, top: 800, bottom: 860 }), 860 - (700 - 16))
  })
  it('scrolls up for a target hidden under the topbar', () => {
    assert.equal(scrollDelta({ ...base, top: 10, bottom: 50 }), 10 - (56 + 16))
  })
  it('aligns to the top when the target is taller than the visible area', () => {
    assert.equal(scrollDelta({ ...base, top: 100, bottom: 1500 }), 100 - 72)
  })
  it('keeps room for a docked card', () => {
    assert.ok(scrollDelta({ ...base, top: 500, bottom: 560, bottomInset: 220 }) > 0)
  })
})

describe('step resolution', () => {
  const steps = [
    { id: 'a' },
    { id: 'b', target: '#present' },
    { id: 'c', target: '#missing' },
    { id: 'd', target: ['#missing', '#present'] },
  ]

  it('normalises selectors', () => {
    assert.deepEqual(stepSelectors({}), [])
    assert.deepEqual(stepSelectors({ target: '#x' }), ['#x'])
    assert.deepEqual(stepSelectors({ target: ['#x', '#y'] }), ['#x', '#y'])
  })

  it('drops steps whose targets are not visible, keeps target-less ones', () => {
    const out = resolveAvailableSteps(steps, (s) => s === '#present')
    assert.deepEqual(
      out.map((s) => s.id),
      ['a', 'b', 'd'],
    )
  })

  it('findVisibleTarget skips zero-size elements and invalid selectors', () => {
    const hidden = { getBoundingClientRect: () => ({ width: 0, height: 0 }) }
    const shown = { getBoundingClientRect: () => ({ width: 10, height: 10 }) }
    const root = {
      querySelectorAll(selector: string) {
        if (selector === '!!bad') throw new SyntaxError('invalid selector')
        if (selector === '.hidden') return [hidden]
        if (selector === '.shown') return [hidden, shown]
        return []
      },
    }
    assert.equal(findVisibleTarget(['!!bad', '.hidden', '.none'], root), null)
    assert.equal(findVisibleTarget(['.hidden', '.shown'], root), shown)
  })
})

describe('tourNavReducer', () => {
  it('walks forward and back within bounds', () => {
    let s = tourNavReducer(initialTourNavState, { type: 'start', total: 3 })
    assert.deepEqual(s, { active: true, index: 0, total: 3 })
    s = tourNavReducer(s, { type: 'prev' })
    assert.equal(s.index, 0)
    s = tourNavReducer(s, { type: 'next' })
    s = tourNavReducer(s, { type: 'next' })
    assert.equal(isLastStep(s), true)
    s = tourNavReducer(s, { type: 'next' })
    assert.equal(s.index, 2)
  })

  it('does not start with zero steps and ignores navigation when inactive', () => {
    assert.deepEqual(tourNavReducer(initialTourNavState, { type: 'start', total: 0 }), initialTourNavState)
    assert.deepEqual(tourNavReducer(initialTourNavState, { type: 'next' }), initialTourNavState)
  })

  it('stop resets the state', () => {
    const s = tourNavReducer({ active: true, index: 1, total: 3 }, { type: 'stop' })
    assert.deepEqual(s, initialTourNavState)
  })
})

describe('tour progress persistence', () => {
  function memoryStorage() {
    const data = new Map<string, string>()
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      data,
    }
  }

  it('is per user and per tour version', () => {
    const storage = memoryStorage()
    assert.equal(readTourStatus(storage, 'u1', 'home', 1), null)
    assert.equal(writeTourStatus(storage, 'u1', 'home', 1, 'completed'), true)
    assert.equal(readTourStatus(storage, 'u1', 'home', 1), 'completed')
    assert.equal(readTourStatus(storage, 'u2', 'home', 1), null)
    assert.equal(readTourStatus(storage, 'u1', 'home', 2), null)
    assert.equal(writeTourStatus(storage, 'u1', 'home', 2, 'skipped'), true)
    assert.equal(readTourStatus(storage, 'u1', 'home', 2), 'skipped')
  })

  it('stores only the status and a timestamp', () => {
    const storage = memoryStorage()
    writeTourStatus(storage, 'u1', 'home', 1, 'skipped')
    const raw = JSON.parse(storage.data.get(tourStorageKey('u1', 'home', 1)) as string)
    assert.deepEqual(Object.keys(raw).sort(), ['at', 'status'])
  })

  it('survives missing, throwing or corrupted storage', () => {
    assert.equal(readTourStatus(null, 'u1', 'home', 1), null)
    assert.equal(writeTourStatus(null, 'u1', 'home', 1, 'completed'), false)

    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    assert.equal(readTourStatus(throwing, 'u1', 'home', 1), null)
    assert.equal(writeTourStatus(throwing, 'u1', 'home', 1, 'completed'), false)

    const corrupted = memoryStorage()
    corrupted.data.set(tourStorageKey('u1', 'home', 1), '{not json')
    assert.equal(readTourStatus(corrupted, 'u1', 'home', 1), null)
    corrupted.data.set(tourStorageKey('u1', 'home', 1), JSON.stringify({ status: 'weird' }))
    assert.equal(readTourStatus(corrupted, 'u1', 'home', 1), null)
  })
})
