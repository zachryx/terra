/**
 * Escapes one CSV field. Besides quoting, neutralises spreadsheet formula
 * injection: a cell starting with = + - @ (or tab/CR) would be executed by
 * Excel/Sheets, so we prefix it with an apostrophe.
 */
export function csvField(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return (
    [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') +
    '\r\n'
  );
}
