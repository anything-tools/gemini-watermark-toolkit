# Gemini Watermark Toolkit Roadmap

This roadmap turns the initial MVP into a maintainable toolkit for known semi-transparent visible watermark overlays, with Gemini visible white watermarks as the first supported preset.

## Scope and non-goals

The project targets watermarks that are:

- visible, semi-transparent overlays;
- positionally regular or describable by layout priors;
- represented by a known or calibratable alpha template;
- approximately composited with normal alpha blending;
- usually white or black, with color estimable from the template/region.

The project should not claim to remove:

- arbitrary watermarks;
- invisible SynthID or other provenance metadata;
- complex colored or large text watermarks;
- backgrounds requiring AI inpainting or diffusion repair.

The default behavior should remain conservative: in `safe` mode, prefer a no-op over a false positive.

## Current MVP

The initial implementation already provides:

- TypeScript library scaffold and ESM build output.
- Public API: `removeWatermark`, `detectWatermark`, `validateWatermark`, and `restoreWatermark`.
- A modular pipeline: detector → validator → restorer.
- Template registry abstraction.
- Gemini 48px, 96px, and 96px new-margin template variants using synthetic approximation alpha maps.
- Gemini official-size layout priors:
  - 0.5K: 48px logo, 32px right/bottom margins.
  - 1K/2K/4K: 96px logo, 64px right/bottom margins.
  - Known new-margin variant: 96px logo, 192px right/bottom margins, including 2816×1536.
- Trial restoration validation with residual reduction and artifact checks.
- Diagnostics metadata explaining whether and why a removal was applied or skipped.
- Synthetic tests for positive detection/restoration, clean-image no-op behavior, and catalog-prior anchors.

## Implementation plan

### PR 2 — Template calibration and registry hardening

Goal: replace ad-hoc synthetic template assumptions with a versioned, auditable template system and calibration workflow.

Tasks:

- Define a serializable template schema with fields such as:
  - `id`
  - `provider`
  - `version`
  - `width`
  - `height`
  - `alpha`
  - `color`
  - `blendMode`
  - `source`
  - `calibratedAt`
  - `notes`
- Add template JSON import/export helpers.
- Add a calibration function that estimates alpha from paired clean/watermarked images and a selected region:

  ```text
  alpha = (watermarked - clean) / (watermarkColor - clean)
  ```

- Add a small CLI or script prototype:

  ```bash
  watermark-kit calibrate \
    --clean clean.png \
    --watermarked watermarked.png \
    --region x,y,w,h \
    --out templates/gemini-visible-white-96-v2.json
  ```

- Add tests for alpha estimation on synthetic paired samples.
- Keep built-in MVP templates clearly labeled as synthetic approximations until real calibrated templates are added.

Acceptance checks:

- Template schema round-trips without precision loss beyond an explicit tolerance.
- Calibration on synthetic fixtures recovers alpha within a small error bound.
- Existing `safe` no-op behavior remains unchanged.

### PR 3 — Node image I/O and CLI remove command

Goal: make the toolkit usable on real files without coupling core pixel logic to native dependencies.

Tasks:

- Add a Node adapter for reading/writing PNG/JPEG/WebP images.
- Prefer keeping native or heavy dependencies optional and outside the core package when possible.
- Add CLI command:

  ```bash
  watermark-kit remove input.png -o output.png --preset gemini --mode safe --json
  ```

- Output diagnostics JSON alongside or instead of human-readable text when `--json` is passed.
- Ensure file commands preserve alpha where possible and fail clearly for unsupported formats.

Acceptance checks:

- CLI can read a synthetic fixture, remove the visible watermark, and write an output image.
- `--json` emits stable diagnostics fields and no noisy logs.
- Core library remains usable without Node image I/O imports.

### PR 4 — Benchmark and fixture framework

Goal: make threshold tuning measurable instead of anecdotal.

Tasks:

- Add a benchmark fixture layout for:
  - clean images;
  - synthetic watermarked images;
  - compressed PNG/JPEG/WebP-like variants;
  - negative samples;
  - known failure cases.
- Add benchmark metrics:
  - detection recall;
  - false positive rate;
  - local MSE / PSNR;
  - residual reduction;
  - artifact score;
  - near-black increase;
  - runtime.
- Add a deterministic benchmark runner that can be used in CI on small fixtures.

Acceptance checks:

- Benchmark output is deterministic enough for regression comparisons.
- Safe mode false positives on negative fixtures remain zero or explicitly justified.
- Benchmark summary can be emitted as JSON.

### PR 5 — Advanced validation/restoration heuristics

Goal: bring in the most useful reliability ideas from the reference project while preserving this repo's modular design.

Tasks:

- Add subpixel shift / small scale search around a candidate.
- Add alpha-gain candidate search controlled by validator feedback.
- Add optional multi-pass processing for residual suppression.
- Add halo / edge cleanup scoring.
- Strengthen artifact guards:
  - near-black increase;
  - texture collapse;
  - excessive darkening;
  - spatial/gradient residual drift.
- Keep `safe` conservative; reserve broader searches and stronger gains for `aggressive`.

Acceptance checks:

- Synthetic benchmark improves or stays neutral on restoration quality.
- Negative fixtures stay no-op in `safe` mode.
- Diagnostics explain which refinement, gain, or pass was selected.

### PR 6 — Browser adapter and demo surface

Goal: make the toolkit easy to integrate into browser apps and eventually anything-tools UI.

Tasks:

- Add Canvas/ImageData adapter helpers for browser usage.
- Add a small demo page or example that shows:
  - input image;
  - output image;
  - candidate overlay;
  - diagnostics JSON.
- Ensure browser entry points do not pull in Node-only dependencies.

Acceptance checks:

- Browser example runs with the built package.
- Diagnostics and output are consistent with the core API.
- Bundle boundaries are documented.

## Engineering rules

- Keep `safe` mode as the default.
- Avoid full-image exhaustive scans by default.
- Keep template/layout data outside detector internals.
- Add tests before tuning thresholds.
- Do not copy large embedded alpha assets from reference projects without explicit license/source review.
- Do not commit generated benchmark outputs unless they are intentionally tiny fixtures.
