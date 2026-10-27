import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('every advertised announcement variable has complete English and Swedish help', () => {
  const source = readFileSync(new URL('../src/components/TagHelp.tsx', import.meta.url), 'utf8')
  const variables = [...source.matchAll(/\{ tag: "\{([^}]+)\}"/g)].map(match => match[1]!)
  assert.ok(variables.length > 0)
  for (const locale of ['en', 'sv']) {
    const catalog = JSON.parse(readFileSync(new URL(`../src/lib/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>
    for (const variable of variables) for (const field of ['label', 'description', 'example']) {
      assert.ok(catalog[`tags.variable.${variable}.${field}`], `${locale}: ${variable} ${field}`)
    }
    for (const context of ['always', 'mention', 'start', 'end', 'schedule']) assert.ok(catalog[`tags.context.${context}`])
  }
})
