import assert from 'node:assert/strict'
import test from 'node:test'
import { hexToHsl, hslToHex, normalizeHex, PRESET_ACCENTS, readableInk } from '../src/lib/color.ts'

test('normalizeHex accepts six and three digit hex and rejects drafts', () => {
  assert.equal(normalizeHex('#55bbda'), '#55bbda')
  assert.equal(normalizeHex('55BBDa'), '#55bbda')
  assert.equal(normalizeHex('#abc'), '#aabbcc')
  assert.equal(normalizeHex(' #F0b429 '), '#f0b429')
  for (const draft of ['', '#', '#12', '#12345', '#1234567', 'rgb(0,0,0)', '#gggggg']) assert.equal(normalizeHex(draft), null, draft)
})

test('hexToHsl and hslToHex round-trip every brand colour', () => {
  const colours = [...Object.values(PRESET_ACCENTS), '#0a0c10', '#eef2f7', '#f7f5f0', '#fffdf9', '#f0b429', '#c77fc7', '#000000', '#ffffff']
  for (const hex of colours) {
    assert.equal(hslToHex(hexToHsl(hex)), hex, hex)
    assert.equal(hslToHex(hexToHsl(hex.toUpperCase())), hex, hex)
  }
})

test('hexToHsl reports the brand hues it should', () => {
  const round = (hex: string) => { const hsl = hexToHsl(hex); return [hsl.h, hsl.s, hsl.l].map(Math.round) }
  assert.deepEqual(round('#ff0000'), [0, 100, 50])
  assert.deepEqual(round('#00ff00'), [120, 100, 50])
  assert.deepEqual(round('#0000ff'), [240, 100, 50])
  assert.deepEqual(round('#808080'), [0, 0, 50])
})

test('readableInk keeps the participant foreground contract', () => {
  assert.equal(readableInk('#55bbda'), '#111827')
  assert.equal(readableInk('#f7f5f0'), '#111827')
  assert.equal(readableInk('#0a0c10'), '#ffffff')
  assert.equal(readableInk('#ef793e'), '#111827')
})
