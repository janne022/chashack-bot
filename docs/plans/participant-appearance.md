# Participant pages, signup appearance and reusable themes

## Approved scope

Janne rejected the participant signup page's visual quality and unreadable route implementation and reported that public preview is bare HTML. Code inspection on delivered main c1261eacbd2f33e2e4ba7b4b520354ed7408c8d9 confirms the public route returns only h1/p, while signup ignores API theme/banner fields and nests the complete question renderer into enormous JSX expressions.

User chose:
- One scrolling form with clear sections; event details alongside on desktop, stacked on mobile. Remove arbitrary six-question pagination.
- Banner/background supplied by HTTPS image URLs initially. No image uploads or media-storage work.

## Direction contract

**THESIS:** the event and its registration are one coherent participant experience, not a generic console page followed by raw form controls.
**OWN-WORLD:** retain ChasHack's existing brand, fonts and restrained blue interaction language; default to the established light palette with a readable, opaque form surface. Do not redesign organizer chrome or apply custom event styles globally.
**STORY:** understand the event and dates, see signup state, continue with Discord when needed, answer clearly grouped questions, submit once, and reach the next existing participant/team action.
**FIRST VIEWPORT:** event banner when configured; event identity and brief description; a bounded primary form column and quiet event/date/signup context beside it on desktop. Mobile becomes one column with comfortable full-width controls and no horizontal overflow. Public event page shares this framing and leads into signup. No decorative dashboard/sidebar clutter in participant mode.
**FORM:** user-selected single scrolling registration form, not a new visual-world tournament. Appearance editor presents current preview next to controls. Theme library is first-class under Templates.
**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance. Use the existing one independent QA slot for actual visual/UX and behavioral acceptance together, not another overlapping audit chain. No generated/stock artwork required for defaults; remote organizer images are not repository-generated assets.

## Implementation boundaries

One cohesive vertical slice in existing apps/admin-ui and apps/bot; one owner and PR. Reuse installed React/shadcn/form primitives and existing PostgreSQL template store; no package addition or second app/SSR framework/general page builder.

### Shared appearance contract

Introduce a validated appearance object on the existing event form snapshot, with one shared normalization/resolution contract for preset, light/dark mode, accent/background/form-surface/text colors, optional banner URL and optional background-image URL. Keep legacy themePreset/accentColor/bannerUrl readable through a single compatibility resolver; the new participant renderer consumes normalized appearance, not parallel scattered fallback logic. Unknown keys/unsupported schemes and arbitrary CSS/HTML/JS are refused. HTTPS URL fields may be cleared; show broken-image fallback and never let an absent image break registration. Browser image requests use a no-referrer policy where applicable; backend does not fetch arbitrary organizer URLs. Preserve safe escaping in initial HTML and existing tenant/subject authority.

Appearance is cosmetic: edits cannot bump structural form versions, invalidate saved answers, change matching semantics or migrate existing registrations. Live event rendering and organizer preview must resolve the same event-local appearance. Display readable surfaces over background images; prevent low-contrast saved text/control combinations through validation or clearly explained safe foreground resolution. Validation errors keep typed editor values.

### Organizer UI and reusable themes

A discoverable Appearance section/tab in signup/form options (including create/edit/template paths) contains preset previews, color controls, banner/background HTTPS URL fields with clear/remove and image preview, reset to default, and an in-place preview using the real participant rendering components. Preserve the rest of the form editor and event creation precedence.

Templates -> Themes is the reusable guild-scoped library. Reuse existing templates infrastructure with kind=theme and a small validated appearance-only payload, not full form definitions. Create/name/save/edit/delete/apply themes. Applying takes a snapshot into the draft/event; future library edits/deletion do not silently change published events. Built-in Default/Halloween/Christmas presets remain available and actually render, not just persist a string. Custom theme library reads/writes must respect current organizer authority and RLS, and templates owned by another guild are inaccessible.

### Participant UI and code structure

Replace the monolithic signup route with a thin route that composes a participant/event frame, readable registration form and question renderer, plus a focused registration-state hook/use-case. Use existing API/public DTO contracts and existing shared types instead of another inline type copy. Separate loading/auth/nonmember/unavailable/error/saving/success states; do not conflate an API error with anonymous login. Use consistent installed shadcn primitives for text, radio/select and multi-choice fields, with labels, question help, required markers, inline errors, error-summary focus and meaningful section grouping. No uncontrolled reset of typed answers on failure/refetch. Preserve existing login, membership, answers/privacy/version, team-preference and completion behavior.

Public /events/:eventId becomes a real styled event landing page with dates, event details and clear signup action, using the same event appearance/frame as signup. Serve the actual compiled application rather than an unstyled metadata-only terminal document. Keep escaped title/description/Open Graph metadata in the INITIAL response and useful accessible event content if JavaScript is unavailable; do not add a second hand-maintained visual system or publish private/draft data. An organizer preview uses the actual renderer/current draft with a preview label; a public event link shows the saved/published snapshot, not unsaved configuration.

## Acceptance checklist

- [ ] Fresh default event yields a coherent public event page and one-page signup at desktop and390px, not raw h1/p or six-question pages.
- [ ] Actual editor controls for all supported appearance fields persist through create/edit/form/event templates; defaults and legacy rows render safely.
- [ ] Default and existing seasonal presets visibly differ as intended; custom colors/banner/background appear on both public and signup pages; image failure/clearing works without layout shift or losing form input.
- [ ] Named reusable theme can be saved, reapplied and managed from Templates; editing/deleting it leaves an already-applied event snapshot unchanged; guild B cannot read/apply/edit guild A's themes.
- [ ] Appearance-only edits on a populated published event preserve form version, saved answers and matching behavior. Existing structural-conflict controls remain.
- [ ] Real served journeys cover anonymous -> Discord continuation, current member signup/edit, nonmember refusal, invalid/missing answer focus, save failure with typed data retained, stale version and successful next team action; preserve existing participant regression coverage.
- [ ] en/sv parity, keyboard/AX focus/label/error semantics, reduced motion, image fallbacks and no overflow at390px and1440px. One batched screenshot inspection of public page, signup and appearance editor; one fixes batch/confirmation, not open-ended polishing.
- [ ] Route JSX is readable, multi-line and compositional; no nested all-in-one question renderer and no formatting-only claim of refactoring.
- [ ] Frozen install, typecheck, clean build -> compiled DB tests, API smoke and existing hpipe gates; all applicable exact-head CI successful after final PR metadata. One genuine independent review, one bounded repair, targeted verification and planner-owned native rebase merge/landing.

## Explicit exclusions

No uploads/object store/image proxy, arbitrary CSS/HTML, new dependencies, global rebrand, form-builder redesign, question/matcher/authority rewrite, unrelated DM/rate/SSE fixes, runtime/profile/protected workflow changes, production database changes or deployment. New requested appearance controls are not permission to change answers or loosen tenant/subject privacy.

## Verified test resources

Use explicit DATABASE_URL=postgresql://postgres@127.0.0.1:55432/chashack_test and existing UUID-isolated openTestDb fixtures; never reset shared DB or touch production. Existing organizer-browser.mjs and participant-browser.mjs supply real compiled UI/backend/synthetic sessions/native Chromium CDP; label synthetic vs real OAuth. Pin screenshots to actual candidate hashes. Build before executing dist tests. No unavailable inherited environment variable is a blocker when the approved fixture is supplied explicitly.
