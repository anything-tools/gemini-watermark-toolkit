import { clampByte, cloneImage, pixelOffset } from './image.js';
import { defaultRegistry } from './registry.js';
import type { Candidate, NormalizedImage, RestoreOptions, RestoreResult } from './types.js';

const DEFAULT_ALPHA_GAIN = {
  safe: 1,
  aggressive: 1.18
} as const;

const DEFAULT_ALPHA_GAIN_SEARCH = {
  safe: [1],
  aggressive: [1, 1.08, 1.16, 1.24, 1.32]
} as const;

function isCandidateInBounds(image: NormalizedImage, candidate: Candidate): boolean {
  return Number.isInteger(candidate.x) &&
    Number.isInteger(candidate.y) &&
    candidate.x >= 0 &&
    candidate.y >= 0 &&
    candidate.x + candidate.width <= image.width &&
    candidate.y + candidate.height <= image.height;
}

function normalizeAlphaGainSearch(values: readonly number[]): number[] {
  const gains = values.filter((gain) => Number.isFinite(gain) && gain > 0 && gain <= 1.5);
  if (gains.length === 0) {
    throw new RangeError('alphaGainSearch must include at least one finite gain in the range (0, 1.5]');
  }
  return gains;
}

function restoreWithAlphaGain(
  image: NormalizedImage,
  candidate: Candidate,
  alphaGain: number,
  registry: NonNullable<RestoreOptions['registry']>
): NormalizedImage {
  const output = cloneImage(image);
  const template = registry.get(candidate.templateId);
  if (!template) return output;

  for (let ty = 0; ty < template.height; ty += 1) {
    for (let tx = 0; tx < template.width; tx += 1) {
      const rawAlpha = template.alpha[ty * template.width + tx];
      const alpha = Math.min(0.92, Math.max(0, rawAlpha * alphaGain));
      if (alpha <= 0.002) continue;

      const offset = pixelOffset(output.width, candidate.x + tx, candidate.y + ty);
      const inverse = 1 - alpha;
      for (let channel = 0; channel < 3; channel += 1) {
        const observed = output.data[offset + channel];
        const original = (observed - alpha * template.color[channel]) / inverse;
        output.data[offset + channel] = clampByte(original);
      }
    }
  }

  return output;
}

function templateResidualScore(image: NormalizedImage, candidate: Candidate, registry: NonNullable<RestoreOptions['registry']>): number {
  const template = registry.get(candidate.templateId);
  if (!template) return Number.POSITIVE_INFINITY;
  const alphaValues: number[] = [];
  const lumaValues: number[] = [];
  for (let ty = 0; ty < template.height; ty += 1) {
    for (let tx = 0; tx < template.width; tx += 1) {
      const alpha = template.alpha[ty * template.width + tx];
      if (alpha <= 0.015) continue;
      alphaValues.push(alpha);
      const offset = pixelOffset(image.width, candidate.x + tx, candidate.y + ty);
      lumaValues.push(0.2126 * image.data[offset] + 0.7152 * image.data[offset + 1] + 0.0722 * image.data[offset + 2]);
    }
  }
  if (alphaValues.length < 3) return Number.POSITIVE_INFINITY;
  let alphaSum = 0;
  let lumaSum = 0;
  for (let i = 0; i < alphaValues.length; i += 1) {
    alphaSum += alphaValues[i];
    lumaSum += lumaValues[i];
  }
  const alphaMean = alphaSum / alphaValues.length;
  const lumaMean = lumaSum / lumaValues.length;
  let numerator = 0;
  let alphaVariance = 0;
  let lumaVariance = 0;
  for (let i = 0; i < alphaValues.length; i += 1) {
    const alphaDelta = alphaValues[i] - alphaMean;
    const lumaDelta = lumaValues[i] - lumaMean;
    numerator += alphaDelta * lumaDelta;
    alphaVariance += alphaDelta * alphaDelta;
    lumaVariance += lumaDelta * lumaDelta;
  }
  if (alphaVariance <= 1e-9 || lumaVariance <= 1e-9) return 0;
  return Math.max(0, numerator / Math.sqrt(alphaVariance * lumaVariance));
}

export function restore(
  image: NormalizedImage,
  candidate: Candidate | undefined,
  options: RestoreOptions = {}
): RestoreResult {
  const output = cloneImage(image);
  if (!candidate) {
    return { image: output, changed: false };
  }

  const mode = options.mode ?? 'safe';
  const registry = options.registry ?? defaultRegistry;
  const template = registry.get(candidate.templateId);
  if (!template) {
    return { image: output, changed: false, refinement: 'none', passCount: 0 };
  }

  if (!isCandidateInBounds(image, candidate)) {
    return { image: output, changed: false, refinement: 'none', passCount: 0 };
  }

  const alphaGain = options.alphaGain ?? DEFAULT_ALPHA_GAIN[mode];
  if (!Number.isFinite(alphaGain) || alphaGain <= 0 || alphaGain > 1.5) {
    throw new RangeError('alphaGain must be finite and in the range (0, 1.5]');
  }
  const search = normalizeAlphaGainSearch(options.alphaGain === undefined
    ? options.alphaGainSearch ?? DEFAULT_ALPHA_GAIN_SEARCH[mode]
    : [alphaGain]);
  let bestGain = alphaGain;
  let bestImage = output;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const gain of search) {
    const trial = restoreWithAlphaGain(image, candidate, gain, registry);
    const score = templateResidualScore(trial, candidate, registry);
    if (score < bestScore) {
      bestScore = score;
      bestGain = gain;
      bestImage = trial;
    }
  }

  return {
    image: bestImage,
    changed: true,
    candidate,
    alphaGain: bestGain,
    passCount: 1,
    refinement: search.length > 1 ? 'alpha-gain-search' : 'fixed-alpha-gain'
  };
}

export const restorer = { restore };
