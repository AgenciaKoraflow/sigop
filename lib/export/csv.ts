/**
 * CSV building helpers with spreadsheet formula-injection (CSV injection)
 * protection. Every CSV exporter in the project must go through `csvCell` /
 * `csvRow` so user-controlled text is never interpreted as a formula by
 * Excel, LibreOffice or Google Sheets.
 */

export const CSV_SEPARATOR = ';'

/** Leading characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/

/**
 * Neutralize formula triggers by prefixing a single quote (OWASP guidance):
 * the spreadsheet shows the original text and does not evaluate it. The
 * original content is preserved — nothing is removed.
 */
export function neutralizeFormula(text: string): string {
  return FORMULA_TRIGGER.test(text) ? `'${text}` : text
}

/**
 * Serialize one value as a CSV cell (`;` separated, RFC 4180 quoting).
 * Numbers and booleans are trusted (they cannot carry a payload), so negative
 * numbers stay numeric; every string is treated as untrusted.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text =
    typeof value === 'string' ? neutralizeFormula(value) : String(value)
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(CSV_SEPARATOR)
}
