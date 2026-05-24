# gemini-watermark-toolkit

A small TypeScript toolkit for detecting and conservatively restoring **known semi-transparent visible Gemini-style white watermark overlays** in RGBA images.

This project is inspired by engineering lessons from [`GargantuaX/gemini-watermark-remover`](https://github.com/GargantuaX/gemini-watermark-remover), especially catalog-based Gemini layout priors, reverse alpha blending, template correlation, and safety validation. It is a clean modular toolkit implementation and does not copy the reference project's embedded asset maps.

It is not an AI inpainting tool, does not remove invisible SynthID watermarks or metadata, and does not claim arbitrary watermark removal.

## Usage

```ts
import { removeWatermark } from 'gemini-watermark-toolkit';

const result = removeWatermark(imageData, {
  mode: 'safe'
});

if (result.applied) {
  console.log(result.meta);
  // result.image is { width, height, data: Uint8ClampedArray }
}
```

Lower-level pipeline:

```ts
import { detectWatermark, validateWatermark, restoreWatermark } from 'gemini-watermark-toolkit';

const candidates = detectWatermark(image, { mode: 'safe' });
const validation = validateWatermark(image, candidates, { mode: 'safe' });
const restored = restoreWatermark(image, validation.best, { mode: 'safe' });
```

## Architecture

- Template registry: built-in synthetic Gemini visible-white templates for `48`, `96`, and `96-new-margin`. These are synthetic approximations for calibration and tests, not official Gemini assets.
- Layout priors: data-driven Gemini catalog positions. `0.5K` uses a `48x48` logo with `32px` right/bottom margins. `1K`, `2K`, and `4K` use `96x96` with `64px` margins. A secondary `96x96` `192px` margin candidate is included and evidence-gated, including the known `2816x1536` case.
- Detector: scores prior-generated candidates with spatial luminance correlation and gradient correlation. Full-image exhaustive scan is opt-in.
- Validator: trial-restores candidates on a clone, then scores residual reduction, near-black increase, texture penalty, and artifact risk.
- Restorer: applies reverse normal alpha blending: `original = (observed - alpha * watermarkColor) / (1 - alpha)`.
- Diagnostics: `removeWatermark` returns `meta` with `applied`, candidate geometry, confidence, residual before/after, artifact score, warnings, and skip reason.

## Modes

`safe` is the default. It uses conservative detection and validation thresholds and should no-op on clean images.

`aggressive` lowers thresholds and uses stronger alpha restoration. Use it only when the batch is expected to contain this visible Gemini watermark.

## CLI

The Node CLI currently supports PNG input/output only:

```sh
watermark-kit remove input.png -o output.png --json
watermark-kit benchmark --mode safe --json
```

You can calibrate an external template from a permitted clean/watermarked PNG pair and use it for removal:

```sh
watermark-kit calibrate clean.png watermarked.png \
  --region 864,864,96,96 \
  --id local-gemini-96 \
  --version local-v1 \
  -o template.json \
  --json

watermark-kit remove watermarked.png -o restored.png --template template.json --json
```

## Limitations

- Targets known visible semi-transparent white Gemini-style marks.
- Does not remove invisible SynthID, provenance metadata, signatures, or arbitrary colored/complex watermarks.
- Does not perform AI inpainting.
- Core APIs work on raw RGBA pixels. The Node CLI decodes/encodes PNG only; it does not support JPEG or WebP.
- Bundled templates are synthetic approximations; the calibration CLI lets users benchmark and tune templates against permitted local samples.

## Development

```sh
npm config set registry https://registry.npmjs.org/
npm install
npm run typecheck
npm test
npm run build
```
