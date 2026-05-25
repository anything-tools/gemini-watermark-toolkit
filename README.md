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

- Template registry: built-in calibrated visible-white Gemini-style templates for `48x48`, `56x56`, and `96x96`. These are approximations derived from permitted clean/watermarked examples, not official Google assets. Source template data lives in `templates/*.json`; `src/geminiTemplates.ts` is generated from those assets.
- Layout priors: data-driven Gemini catalog positions. Observed `1024x1024`, `1184x864`, and `864x1184` images use a `48x48` logo with `32px` right/bottom margins; `1200x1200` uses `56x56` with `38px` margins; `2816x1536` uses `96x96` with `64px` margins.
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

## Template Assets

Built-in Gemini template alpha maps are stored as auditable JSON assets:

```sh
npm run generate:templates
npm run check:templates
```

`generate:templates` emits the generated TypeScript factory used at runtime. `check:templates` validates asset dimensions, alpha ranges, supported template sizes, and that the generated file is up to date.

## Calibration Samples

Clean/watermarked PNG pairs remain the most reliable calibration source because they measure the visible overlay against real image content. Keep those pairs as the ground truth when changing bundled templates or validating local templates.

Pure-color watermarked samples can make calibration faster. Generate multiple flat PNG/RGBA prompts at the target output sizes, ideally black, white, mid-gray, and saturated colors such as red, green, and blue. Name samples with enough metadata to audit them later, for example `gemini-visible-white-1024-black-48.png`, `gemini-visible-white-1200-gray-56.png`, or `gemini-visible-white-2816x1536-blue-96.png`.

Recommended coverage:

- Include all known template sizes: `48x48`, `56x56`, and `96x96`.
- Include all known output layouts used by Gemini priors: `1024x1024`, `1184x864`, `864x1184`, `1200x1200`, and `2816x1536`.
- Capture at least black, white, and mid-gray for alpha estimation; add saturated RGB samples when checking whether the assumed white normal-alpha model still holds.
- Verify pure-color-derived templates against real complex clean/watermarked pairs before bundling them.

Caveats: Gemini may not produce perfectly flat images even when prompted for a flat color, and compression, antialiasing, or prompt artifacts can bias alpha estimates. Treat pure-color samples as calibration aids, not replacements for pair validation. This toolkit remains scoped to visible Gemini-style PNG/RGBA watermarks and does not make JPEG/WebP, invisible SynthID, metadata, or arbitrary watermark claims.

## Limitations

- Targets known visible semi-transparent white Gemini-style marks.
- Does not remove invisible SynthID, provenance metadata, signatures, or arbitrary colored/complex watermarks.
- Does not perform AI inpainting.
- Core APIs work on raw RGBA pixels. The Node CLI decodes/encodes PNG only; it does not support JPEG or WebP.
- Bundled templates are calibrated approximations of visible Gemini-style marks from permitted examples; they are not official Google assets. The calibration CLI lets users benchmark and tune templates against permitted local samples.

## Development

```sh
npm config set registry https://registry.npmjs.org/
npm install
npm run check:templates
npm run typecheck
npm test
npm run build
```
