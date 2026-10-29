# Private questions and event form replacement

- [x] Show private questions and answers to their authenticated participant and authorized organizers; keep public metadata filtered and matching free of private values.
- [x] Verify targeted database-backed API and privacy tests for private questions.
- [x] Snapshot form definitions on structural change; preserve previous answers and imported values before their next overwrite, with tenant isolation.
- [x] Make old answers accessible to authorized organizers while participants complete the new form, including imported signups and account linking.
- [x] Apply deletion and private-answer retention to historical data and restore replay.
- [x] Make form replacement available on the current event, with clear English and Swedish descriptions.
- [x] Resolve unclassified historical data retention, and run complete checks on the final change.
- [x] Test retention and replay for known historical definitions, including preservation of newer answers.
- [x] Test old-answer survival, reused question IDs, imported claims, schema reruns and tenant isolation on disposable PostgreSQL.

## Retention decisions

- Expired payloads whose historical form definition or imported-column
  classification is unavailable are erased as a whole answer payload; the row
  and import identity fields (`name`, `email`, `discordUsername`) survive.
  Approved by janne because the private answers in those payloads cannot be
  classified and must not outlive retention.
- An ambiguous payload never throws out of scheduled maintenance, and restore
  replay applies the same payload erasure without resurrecting withdrawn data.
- Withdrawals are recorded with a `withdraw:` identity so replay deletes the
  same answer versions while leaving later re-registrations intact.
- Import projection and organizer edits lock the event before the imported row,
  matching reconciliation, so the two paths cannot deadlock.
- Existing installs gain the composite `(event_id, id)` import key before the
  answer-history foreign key is created.

## Participant experience

- [x] Apply the event theme to signup regardless of saved participant mode.
- [x] Supply event previews for direct signup links without exposing confidential data.
- [x] Retain the TanStack Query cache across participant navigation and measure the remaining load path.
- [x] Verify participant theme, navigation, and public link metadata.
