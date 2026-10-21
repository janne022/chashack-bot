const MAX_BYTES = 1_000_000;
const MAX_ROWS = 2_000;
const MAX_COLUMNS = 100;
const MAX_CELL = 10_000;

export interface ParsedCsv { headers: string[]; rows: string[][] }

export function parseSignupCsv(source: string): ParsedCsv {
  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) throw new Error('CSV exceeds the 1 MB limit');
  const text = source.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else cell += char;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell);
      cell = '';
      closedQuote = false;
      if (char !== ',') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        if (row.some((value) => value !== '') || rows.length > 0) rows.push(row);
        row = [];
        if (rows.length > MAX_ROWS + 1) throw new Error(`CSV exceeds ${MAX_ROWS} data rows`);
      }
    } else if (char === '"' && cell === '' && !closedQuote) quoted = true;
    else if (closedQuote || char === '"') throw new Error('Malformed CSV quoting');
    else cell += char;
    if (cell.length > MAX_CELL) throw new Error(`CSV cell exceeds ${MAX_CELL} characters`);
  }
  if (quoted) throw new Error('Malformed CSV quoting: unterminated quoted field');
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  if (rows.length < 1) throw new Error('CSV must include a header row');
  const headers = rows.shift()!.map((header) => header.trim());
  if (headers.length > MAX_COLUMNS) throw new Error(`CSV exceeds ${MAX_COLUMNS} columns`);
  if (headers.some((header) => header === '') || new Set(headers).size !== headers.length) throw new Error('CSV has a blank or duplicate header');
  if (rows.some((item) => item.length !== headers.length)) throw new Error('Malformed CSV: inconsistent column count');
  return { headers, rows };
}
