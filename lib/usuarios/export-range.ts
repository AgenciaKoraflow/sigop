/**
 * Date range of the bulk access export. The operation runs in Brazil, so a
 * calendar day means America/Sao_Paulo (UTC-03:00, no DST since 2019), not UTC.
 */

export const EXPORT_MAX_DAYS = 366
const DAY_MS = 24 * 60 * 60 * 1000
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export interface ExportRange {
  /** Inclusive lower bound, ISO UTC. */
  startIso: string
  /** Exclusive upper bound, ISO UTC (start of the day after `to`). */
  endIso: string
}

function dayStart(day: string): number | null {
  if (!ISO_DAY.test(day)) return null
  const ms = Date.parse(`${day}T00:00:00-03:00`)
  if (Number.isNaN(ms)) return null
  // Reject overflow such as 2026-02-31 (Date.parse would roll it over).
  return new Date(ms - 3 * 60 * 60 * 1000).toISOString().slice(0, 10) === day ? ms : null
}

export function parseExportRange(
  from: string | null,
  to: string | null,
): { ok: true; range: ExportRange } | { ok: false; error: string } {
  const start = from ? dayStart(from) : null
  const end = to ? dayStart(to) : null
  if (start === null || end === null) {
    return { ok: false, error: 'Informe a data inicial e a final (AAAA-MM-DD).' }
  }
  if (end < start) return { ok: false, error: 'A data final não pode ser anterior à inicial.' }
  if ((end - start) / DAY_MS + 1 > EXPORT_MAX_DAYS) {
    return { ok: false, error: `O período máximo é de ${EXPORT_MAX_DAYS} dias.` }
  }
  return {
    ok: true,
    range: {
      startIso: new Date(start).toISOString(),
      endIso: new Date(end + DAY_MS).toISOString(),
    },
  }
}
