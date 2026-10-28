import assert from 'node:assert/strict'
import { test } from 'node:test'
import { discordAvatarUrl } from '../src/lib/discord-avatar.ts'

test('Discord avatar URLs accept only valid account IDs and avatar hashes', () => {
  const id = '12345678901234567'
  const hash = 'a'.repeat(32)
  assert.equal(discordAvatarUrl({ id, avatar: hash }), `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64`)
  assert.equal(discordAvatarUrl({ id, avatar: `a_${hash}` }), `https://cdn.discordapp.com/avatars/${id}/a_${hash}.png?size=64`)
  assert.equal(discordAvatarUrl({ id, avatar: null }), null)
  assert.equal(discordAvatarUrl({ id: '../other', avatar: hash }), null)
  assert.equal(discordAvatarUrl({ id, avatar: '../other' }), null)
})
