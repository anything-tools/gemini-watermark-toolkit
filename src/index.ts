import { detect, detector } from './detector.js';
import { normalizeImage } from './image.js';
import { defaultRegistry as builtInRegistry, getPreset as resolvePreset } from './registry.js';
import { restore, restorer } from './restorer.js';
import { validate, validator } from './validator.js';
import type {
  Candidate,
  DetectOptions,
  NormalizedImage,
  PixelImage,
  RemoveWatermarkMeta,
  RemoveWatermarkOptions,
  RemoveWatermarkResult,
  RestoreOptions,
  RestoreResult,
  ValidateOptions,
  ValidationResult
} from './types.js';

export type * from './types.js';
export { detector, restorer, validator };
export { calibrateTemplateFromPair, deserializeTemplate, serializeTemplate } from './calibration.js';
export { createDefaultLayoutPriors, GeminiCornerSearchPrior, GeminiOfficialLayoutPrior, OFFICIAL_GEMINI_IMAGE_SIZES } from './layoutPriors.js';
export { createDefaultRegistry, defaultRegistry, getPreset, TemplateRegistry } from './registry.js';

export function detectWatermark(image: PixelImage, options: DetectOptions = {}): Candidate[] {
  return detect(normalizeImage(image), options);
}

export function validateWatermark(
  image: PixelImage,
  candidates: Candidate[],
  options: ValidateOptions = {}
): ValidationResult {
  return validate(normalizeImage(image), candidates, options);
}

export function restoreWatermark(
  image: PixelImage,
  candidate: Candidate | undefined,
  options: RestoreOptions = {}
): RestoreResult {
  return restore(normalizeImage(image), candidate, options);
}

function buildMeta(validation: ValidationResult, changed: boolean, candidate?: Candidate): RemoveWatermarkMeta {
  const best = validation.best;
  if (!changed || !best || !candidate) {
    return {
      applied: false,
      warnings: [],
      skipReason: validation.candidates.length === 0 ? 'no-watermark-detected' : 'validation-rejected'
    };
  }

  const warnings: string[] = [];
  if (best.artifactScore > 0.18) warnings.push('artifact-score-elevated');
  if (best.nearBlackIncrease > 0.01) warnings.push('near-black-increase');
  if (best.texturePenalty > 0.2) warnings.push('texture-penalty');

  return {
    applied: true,
    templateId: best.templateId,
    x: best.x,
    y: best.y,
    width: best.width,
    height: best.height,
    confidence: best.confidence,
    residualBefore: best.residualBefore,
    residualAfter: best.residualAfter,
    residualReduction: best.residualReduction,
    artifactScore: best.artifactScore,
    warnings
  };
}

export function removeWatermark(image: PixelImage, options: RemoveWatermarkOptions = {}): RemoveWatermarkResult {
  const normalized: NormalizedImage = normalizeImage(image);
  const preset = options.preset ?? 'gemini';
  const mode = options.mode ?? 'safe';
  const registry = options.detect?.registry ?? options.validate?.registry ?? options.restore?.registry ?? builtInRegistry;
  resolvePreset(preset);

  const candidates = detector.detect(normalized, {
    ...options.detect,
    preset,
    mode,
    registry
  });
  const validation = validator.validate(normalized, candidates, {
    ...options.validate,
    preset,
    mode,
    registry
  });
  const restored = restorer.restore(normalized, validation.best, {
    ...options.restore,
    preset,
    mode,
    registry
  });
  const meta = buildMeta(validation, restored.changed, validation.best);

  return {
    ...restored,
    applied: meta.applied,
    candidates,
    validation,
    meta
  };
}
