import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSignupCsv } from './domain.js';

test('CSV signup parser preserves quoted values, embedded newlines, BOM and optional Discord column', () => {
  const parsed = parseSignupCsv('\uFEFFTimestamp,Name,Areas,Members\r\n"today, local",Alex,"AI, games","Sam\nTaylor"\r\n');
  assert.deepEqual(parsed.headers, ['Timestamp', 'Name', 'Areas', 'Members']);
  assert.deepEqual(parsed.rows, [['today, local', 'Alex', 'AI, games', 'Sam\nTaylor']]);
});

test('CSV signup parser rejects malformed quoting and ambiguous headers', () => {
  assert.throws(() => parseSignupCsv('Name,Name\nA,B\n'), /duplicate header/i);
  assert.throws(() => parseSignupCsv('Name\n"unfinished\n'), /malformed CSV/i);
});
