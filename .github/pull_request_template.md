## Requirements

<!-- what must be true for this work to be accepted -->

## Acceptance

<!-- evidence that each requirement holds: commands run, outputs, links -->

## Decisions

<!-- Keys from accepted decision records that govern the changed paths,
     one per line: a backticked key and what it decided. The decision-citation
     gate fails a change under an accepted scope that cites no key.
     Find them with `hpipe decisions list` / `hpipe decisions get <key>`.
     Leave as `none` when this change is governed by no record. -->
none

## Frontend UX (when the change touches user-facing UI)

- [ ] journeys added/updated under `.hermes/journeys/` — every feature has failure + empty scenarios
- [ ] every async action verified in idle / waiting / failed states (R1)
- [ ] failed submit preserves typed input (R2)
- [ ] destructive actions name the object in a confirm, or undo within 5 s (R3)
- [ ] one primary action per view (R5)
- [ ] axe: 0 critical, 0 serious (V3)
- [ ] contrast: 0 failures, or waived with reason (V2)
- [ ] vision findings, if any, each carry a DOM confirmation
