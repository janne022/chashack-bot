import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { announcementFailureKey } from '../src/lib/announcement-result.ts'

test('announcement failures map known server diagnostics to actionable translations', () => {
  for (const [reason, key] of [
    ['no_channel_configured', 'events.announce_no_channel'],
    ['missing_access: bot lacks SendMessages', 'events.announce_no_access'],
    ['channel_invalid: bad channel', 'events.announce_bad_channel'],
    ['channel_not_found: missing', 'events.announce_channel_missing'],
    ['not_text_based: voice', 'events.announce_not_text'],
    ['guild_invalid: invalid', 'events.announce_bad_server'],
    ['discord_error code=50013: unknown', 'events.announce_unknown'],
    ['unexpected diagnostic', 'events.announce_unknown'],
  ]) assert.equal(announcementFailureKey(reason!), key)
})

test('announcement failure messages exist in both languages', () => {
  for (const locale of ['en', 'sv']) {
    const catalog = JSON.parse(readFileSync(new URL(`../src/lib/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>
    for (const key of ['no_channel', 'bad_server', 'bad_channel', 'channel_missing', 'not_text', 'no_access', 'unknown', 'request_unknown', 'dms_sent_retry', 'dms_failed']) {
      assert.ok(catalog[`events.announce_${key}`], `${locale}: ${key}`)
    }
  }
})
