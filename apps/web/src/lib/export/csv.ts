/** Spreadsheet export. CSV, not a library: it is a comma and a quote rule. */

function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Excel only reads UTF-8 correctly when the file starts with a byte-order mark,
 * and Arabic names are the whole point of this product — so the BOM stays.
 */
export function buildCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
