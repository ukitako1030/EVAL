import { parse } from 'csv-parse/sync';

/** Parses CSV text with a header row into string records. Accepts CRLF, a BOM, quoted multi-line fields and ragged rows. */
export function parseCsv(text: string): Record<string, string>[] {
  return parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }) as Record<string, string>[];
}
