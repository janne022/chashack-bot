# Participant recovery checklist

- [x] Confirm legacy/default form projection, save/eligibility and Discord/matching semantics; add regression coverage.
- [ ] Reproduce custom-question and choice creation on non-secure HTTP; fix secure ID generation; verify template/event authoring persists.
- [ ] Improve participant signup, event, My hackathons and team navigation/state using existing participant design system; verify English/Swedish and mobile/keyboard.
- [ ] Add a branded favicon and verify actual static MIME/route references.
- [ ] Run focused and repository checks, browser journey and negative control; capture desktop/mobile evidence.
- [ ] Publish exact-head PR with verified gate evidence; request same-card independent review.

## Root-cause evidence to retain

- `GET /api/public/events/:eventId` projects configured custom questions, but the shipped `DEFAULT_FORM` has no `customQuestions`; current signup rendering relies on questions and does not expose the default profile fields.
- The organizer editor calls `crypto.randomUUID()` directly for questions and choices. On the reported LAN HTTP origin, Web Crypto exposes `getRandomValues` but not `randomUUID`.
- Existing CI manifest runs typecheck and build/tests/API smoke only. Existing browser journeys were seeded and did not exercise default-form signup or authoring via controls on a non-secure origin; verify these exact omissions against their receipts before concluding.
