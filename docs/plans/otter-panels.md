# Otter panels in ChasHack admin

- [x] Confirm approved six-panel source manifest before importing assets.
- [x] Verified all six completed, no-hexagon original PNGs against manifest SHA-256; originals remain outside the repo.
- [x] Derived 640px WebP assets and recorded original + derivative hashes, sizes, dimensions, provider/model, and reported quality.
- [x] Added a small decorative illustration component and optional EmptyState illustration, preserving the icon fallback.
- [x] Placed six panels in the two real Events empty states and four template-kind empty states; existing copy/actions remain.
- [x] Verified the actual production-built app at desktop/mobile: all six reachable contexts, real create-form and clear-search actions, decorative DOM/AX, image geometry, actual asset HTTP 404 fallback retaining the title/create action. Only API payloads are synthetic; no database or OAuth login is claimed.
- [x] Negative control: mutating the compiled A1 binding to A2 makes the real browser check fail; the bundle was restored byte-for-byte and the check passed again.
- [x] Fixed narrow-template-tab reachability with native horizontal scrolling; no new dependency or locale copy.
- [x] Frozen install and admin build were executed during implementation; final complete checks and exact-head CI/QA remain separate delivery gates.

The first published candidate f92ab20 had A1 in an unreachable branch and a handwritten HTML fixture that did not verify React. Those claims were not accepted as app evidence. The preserved eb879eb moves A1 into the reachable outer branch; the replacement `check-otter-panels.mjs` now serves the real built app and tests its actual handlers. `provenance.md` retains public original/derivative checksums in a conventional unquoted format; no secret scanner was weakened.

## Asset dependency

The native manifest at `~/.hermes/cache/generated/chashack-otter/panels-no-hexagon/manifest.json` reports `state: COMPLETE`, six expected panels (A1–C2); all six original SHA-256 values were checked before deriving assets. Quality requested medium; actual provider report was low for A1/A2/B1/C1 and medium for B2/C2. Provenance is alongside the WebP assets. The original user sample is not used as an app asset.
