# Participant recovery checklist

- [x] Trace legacy/default form projection, answer persistence, eligibility and team/matching gates; add core-profile save/refresh coverage.
- [x] Reproduce custom-question and choice creation on non-secure HTTP; fix secure ID generation; verify template/event authoring persists.
- [x] Improve participant signup, event, My hackathons and team navigation/state using existing participant design system; verify English/Swedish and mobile/keyboard.
- [x] Add a branded favicon and verify actual static MIME/route references.
- [x] Run focused and repository checks, browser journey and negative control; capture desktop/mobile evidence.
- [x] Publish exact-head PR with verified gate evidence; request same-card independent review.

## Root-cause evidence to retain

- `GET /api/public/events/:eventId` projects configured custom questions, but the shipped `DEFAULT_FORM` has no `customQuestions`; current signup rendering relies on questions and does not expose the default profile fields.
- The organizer editor calls `crypto.randomUUID()` directly for questions and choices. On the reported LAN HTTP origin, Web Crypto exposes `getRandomValues` but not `randomUUID`.
- Existing CI manifest runs typecheck and build/tests/API smoke only. Existing browser journeys were seeded and did not exercise default-form signup or authoring via controls on a non-secure origin; verify these exact omissions against their receipts before concluding.
- `normalizeFormUpdate()` also replaced explicitly empty experience/role/skill/team-preference lists with `DEFAULT_FORM` values, preventing intentional custom-only forms from surviving save/load. An assertion first failed with all four lists repopulated, then passed once explicit empty arrays were preserved.

## Candidate verification evidence (not a completion claim)

- `pnpm --filter bot build && DATABASE_URL=postgresql://postgres@127.0.0.1:55432/chashack_test node --test apps/bot/dist/features/form/domain.test.js apps/bot/dist/adminweb/routes.test.js` → pass, 26/26.
- `DATABASE_URL=postgresql://postgres@127.0.0.1:55432/chashack_test node apps/bot/scripts/participant-browser.mjs` → default profile save/refresh, matching participant fields, event navigation and favicon MIME passed; later pre-existing organizer keyboard reassignment assertion failed.
- `DATABASE_URL=postgresql://postgres@127.0.0.1:55432/chashack_test node apps/bot/scripts/organizer-browser.mjs` → actual non-secure `chashack.test` HTTP Add question, choice authoring, save, reload and publication-of-authored-form checks passed. The broader script exceeded the CLI's 420-second ceiling after its published-preview check, before participant answer/reload assertions; do not mark that journey complete.
- `pnpm run typecheck` → exit 0 (admin route generation fell back from absent `router-cli` with a warning).

## Keyboard reassignment correction (supersedes the earlier "arrow dismisses popup" note)

- The claimed product limitation was a harness timing artifact, not app behaviour: the synthetic `Enter` was dispatched while the Radix `SelectContent` was still in its open animation (and headless Chromium dropped the very first synthetic key after a navigation). Dispatching `ArrowDown` in that window dismissed the popup, and the earlier workaround recorded it as a defect.
- Reproduced in isolation against the compiled bundle: with the popup settled (`[role=listbox][data-state=open]`), `Home`, `ArrowDown`, `ArrowUp` and `End` all move `[role=option][data-highlighted]` and leave the popup open; `Enter` commits. The only real behaviour to know: `ArrowDown` on the last option clamps (no wrap-around), which is the Radix default and matches native `<select>`.
- `participant-browser.mjs` now drives the real keyboard path: open with `Enter`, `Home`/`ArrowDown`/`ArrowUp`/`End` assertions, then `ArrowDown` + `Enter` commits, verified against `participants.team_id` for the highlighted team (a non-vacuous check). Red-capable evidence: two live red runs — `open:false` after arrow-during-animation, and highlight unmoved when the walk started on the last option.
- Red-capable evidence: `ArrowDown moves the team highlight and keeps the selector open` failed with `{"open":false,"active":"BODY","state":"closed"}` before the settle fix, and `participant-browser.mjs` reported `56 participant browser assertions passed; uncaught exceptions: 0` after it.
