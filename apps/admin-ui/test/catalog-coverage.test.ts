import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('literal UI translation keys exist in both catalogs', async () => {
  const source = new URL('../src/', import.meta.url)
  const en = JSON.parse(await readFile(new URL('lib/i18n/en.json', source), 'utf8')) as Record<string, string>
  const sv = JSON.parse(await readFile(new URL('lib/i18n/sv.json', source), 'utf8')) as Record<string, string>
  assert.deepEqual(Object.keys(en).sort(), Object.keys(sv).sort(), 'catalog keys must stay in sync')

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (/\.tsx?$/.test(entry.name)) {
        const text = await readFile(path, 'utf8')
        for (const match of text.matchAll(/\bt\(\s*['"]([^'"]+)['"]\s*[,)]/g)) {
          const key = match[1]!
          assert.ok(Object.hasOwn(en, key), `${path}: missing translation ${key}`)
        }
      }
    }
  }
  await visit(fileURLToPath(source))
})
