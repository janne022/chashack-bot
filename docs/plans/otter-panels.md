# Otter panels in ChasHack admin

- [x] Confirm approved six-panel source manifest before importing assets.
- [x] Verified all six completed, no-hexagon original PNGs against manifest SHA-256; originals remain outside the repo.
- [x] Derived 640px WebP assets and recorded original + derivative hashes, sizes, dimensions, provider/model, and reported quality.
- [x] Added a small decorative illustration component and optional EmptyState illustration, preserving the icon fallback.
- [x] Placed six panels in the two real Events empty states and four template-kind empty states; existing copy/actions remain.
- [x] Verified responsive desktop/mobile Chromium DOM: six real WebP responses are HTTP 200; empty illustration alt/aria-hidden; broken image leaves title/action. Fixture states are synthetic, not OAuth or database data.
- [x] Frozen install, admin typecheck/build, browser check, and Impeccable detector passed; branch committed/published independently without merge.

## Asset dependency

The native manifest at `~/.hermes/cache/generated/chashack-otter/panels-no-hexagon/manifest.json` reports `state: COMPLETE`, six expected panels (A1–C2); all six original SHA-256 values were checked before deriving assets. Quality requested medium; actual provider report was low for A1/A2/B1/C1 and medium for B2/C2. Provenance is alongside the WebP assets. The original user sample is not used as an app asset.
