# ChasHack — Signup form picker in the create-event modal

Plan created: 2026-09-14. Status: done.

## Problem

The create modal's form section is two cards: "New form" (which actually just
uses the default — misleading copy) and "Pick existing" (bare Select, no
indication of which template is the guild default, no preview of what you
picked). You cannot build a fresh form without leaving the modal.

## Decisions

- **Three modes**: `default` (template's form → guild default — honest copy
  matching the server precedence in routes.ts), `template` (pick existing),
  `custom` (build inline).
- **Custom forms become real templates.** On create, the modal first POSTs a
  form template named `{event name} — signup form` (`createTemplateRaw`),
  then sends its id as `formTemplateId`. Server-side normalization applies
  (normalizeFormUpdate), and the form shows up under Templates → Form
  templates — a first-class surface, not a dialog-only snowflake.
- **Dropdown fix**: mark the guild-default template with "(default)" and show
  a one-line summary of the picked form (title · team size · experiences ·
  skills) under the Select.
- Editor is seeded from a deep copy of `DEFAULT_FORM` (never mutate the
  module const across dialog opens).

## Checklist

- [x] EventsPage: three mode cards (default / template / build new)
- [x] EventsPage: inline `FormConfigEditor` in custom mode
- [x] EventsPage: create() makes the form template first in custom mode
- [x] EventsPage: default marker + picked-form summary in the template dropdown
- [x] i18n: new keys en + sv; delete now-unused `events.new_form*` keys (verify
      zero usages first)
- [x] Docker: stop leftover test containers (`chas-fix`, `chashack-fixtest`)
- [x] Verify: admin-ui tsc + build clean
