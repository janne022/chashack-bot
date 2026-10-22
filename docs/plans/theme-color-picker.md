# Theme colour picker

Replace the native `<input type="color">` OS dialog in `AppearanceControls` with one
accessible, branded picker reused by every appearance surface (event appearance,
form templates, named themes).

## Constraints

- [ ] No new dependency: shadcn `Popover`/`Button`/`Input` + native range only
      (`@radix-ui/react-slider` is not installed).
- [ ] One `ColorPicker`; `appearance-controls.tsx` stays the only place the four
      colour fields are rendered.
- [ ] Server contract unchanged: `#RRGGBB` only, `undefined` stays absent from the
      JSON snapshot, contrast gate and `version` semantics untouched.

## Interaction

- [ ] Labelled swatch trigger shows the hex and "Theme default" when the field has
      no override; opens a popover that inherits the console theme.
- [ ] Curated brand swatches from `DESIGN.md` (6×2), name + hex in the accessible
      name, selected state marked by a ring and a check glyph, 44px targets.
- [ ] H/S/L native range sliders, each named for its field, arrow-key operable.
- [ ] Validated hex field: `#abc` normalises to `#aabbcc` on commit, malformed or
      partial input keeps the committed colour and preview intact.
- [ ] Escape and outside click close the popover and return focus to the trigger.
- [ ] Reset restores inherited mode: `undefined` for background/surface/text, the
      preset accent for accent — never a serialised fake default.
- [ ] EN + SV labels for every new string.

## Verify

- [ ] `pnpm typecheck`, `pnpm build`, `pnpm test` green (incl. new `lib/color` unit
      check), `hpipe check` advisory run recorded.
- [ ] `apps/bot/scripts/organizer-browser.mjs` proves the compiled journey: open,
      swatch, hex, slider, invalid draft, reset, save, reload, preview; four fields
      in light and dark at desktop and mobile; no `input[type=color]` remains.
- [ ] `impeccable detect` on the touched files.
- [ ] One PR, exact-head CI green, same-card `qa-judge` review.
