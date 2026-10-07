/**
 * Safe building blocks for user-supplied search terms.
 *
 * Two different grammars are involved and each needs its own escaping:
 *  1. LIKE/ILIKE patterns (`%`, `_` are wildcards, `\` is the escape char).
 *  2. PostgREST filter strings used by `.or()` (`,` `(` `)` `.` `:` are
 *     structural; values containing them must be double-quoted, with `\` and
 *     `"` backslash-escaped inside the quotes).
 */

export const MAX_SEARCH_LENGTH = 100

/** Control characters (incl. CR/LF/NUL) never belong in a search term. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

/** Trim, drop control chars, collapse whitespace and cap the length. */
export function normalizeSearchTerm(term: string | null | undefined): string {
  return (term ?? '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SEARCH_LENGTH)
}

/**
 * Escapes `\`, `%` and `_` so the term matches literally inside a LIKE
 * pattern. `*` is removed because PostgREST rewrites it to `%` in like values.
 */
export function escapeLikeTerm(term: string): string {
  return normalizeSearchTerm(term)
    .replace(/\*/g, '')
    .replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** Wraps a value in a PostgREST double-quoted literal. */
export function quotePostgrestValue(value: string): string {
  return `"${value.replace(/[\\"]/g, (char) => `\\${char}`)}"`
}

/**
 * Builds the argument of `.or()` that matches `term` (contains, case
 * insensitive) against any of `columns`. Columns must be developer-defined
 * constants, never user input. Returns null for an empty term.
 */
export function buildOrIlike(columns: readonly string[], term: string): string | null {
  const escaped = escapeLikeTerm(term)
  if (!escaped) return null
  const value = quotePostgrestValue(`%${escaped}%`)
  return columns.map((column) => `${column}.ilike.${value}`).join(',')
}
