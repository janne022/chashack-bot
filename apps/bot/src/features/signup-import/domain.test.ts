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

test('CSV parser accepts seven synthetic signup records with optional Discord identity and escaped quotes', () => {
  const source = [
    'Timestamp,Name/class,Email,Discord username,Allergies,Group name,Preferred areas',
    't1,Ada — class A,ada@example.test,,Nuts,Robots,"AI, games"',
    't2,Bea — class B,bea@example.test,bea#123,Milk,Robots,"Hardware, design"',
    't3,Cy — class A,cy@example.test,,None,,"AI, hardware"',
    't4,Dee — class C,dee@example.test,dee,None,Orbit,"Games, design"',
    't5,Eli — class B,eli@example.test,,"No ""peanuts""",,"AI, games"',
    't6,Fox — class A,fox@example.test,fox,None,Orbit,"Design, hardware"',
    't7,Gio — class C,gio@example.test,,None,,"AI, games"',
  ].join('\r\n');
  const parsed = parseSignupCsv(source);
  assert.equal(parsed.rows.length, 7);
  assert.equal(parsed.rows[4]![4], 'No "peanuts"');
  assert.equal(parsed.rows[0]![6], 'AI, games');
  assert.equal(parsed.rows[0]![3], '');
  assert.equal(parsed.rows[1]![3], 'bea#123');
});
