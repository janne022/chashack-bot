import assert from 'node:assert/strict'
import test from 'node:test'
import { getTagPosition } from '../src/lib/tag-position.ts'
import { filterTags } from '../src/lib/tag-search.ts'

test('insertion replaces a whole existing token even when the cursor is inside it', () => {
  const value = 'Starts {schedule_title} soon'
  const position = getTagPosition(value, 'Starts {schedule'.length)!
  assert.equal(position.prefix, 'schedule')
  assert.equal(value.slice(0, position.start) + '{schedule_desc}' + value.slice(position.end), 'Starts {schedule_desc} soon')
})

test('unfinished tokens preserve surrounding text and invalid contexts do not open', () => {
  assert.deepEqual(getTagPosition('Hello {event next', 12), { start: 6, end: 12, prefix: 'event' })
  assert.equal(getTagPosition('Hello {event} next', 13), null)
  assert.equal(getTagPosition('Hello {not a tag', 16), null)
})

test('localized variable searches accept Swedish letters', () => {
  assert.deepEqual(getTagPosition('Hej {öpp', 8), { start: 4, end: 8, prefix: 'öpp' })
  const options = [{ tag: '{event}', label: 'Evenemang' }, { tag: '{timer}', label: 'Tid till öppning' }]
  assert.deepEqual(filterTags(options, 'ÖPP'), [options[1]])
  assert.deepEqual(filterTags(options, 'event'), [options[0]])
})
