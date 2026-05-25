import { gradientCorrelation, spatialCorrelation } from './detector.js';
import { luminance, pixelOffset } from './image.js';
import { defaultRegistry } from './registry.js';
import { restore } from './restorer.js';
import type {
  Candidate,
  NormalizedImage,
  ValidatedCandidate,
  ValidateOptions,
  ValidationResult,
  WatermarkMode,
  WatermarkTemplate
} from './types.js';

const THRESHOLDS: Record<WatermarkMode, number> = {
  safe: 0.34,
  aggressive: 0.18
};

const MAX_NEAR_BLACK_INCREASE: Record<WatermarkMode, number> = {
  safe: 0.025,
  aggressive: 0.055
};

function nearBlackRatio(image: NormalizedImage, candidate: Candidate): number {
  let count = 0;
  let nearBlack = 0;
  for (let y = candidate.y; y < candidate.y + candidate.height; y += 1) {
    for (let x = candidate.x; x < candidate.x + candidate.width; x += 1) {
      const offset = pixelOffset(image.width, x, y);
      if (image.data[offset] <= 5 && image.data[offset + 1] <= 5 && image.data[offset + 2] <= 5) {
        nearBlack += 1;
      }
      count += 1;
    }
  }
  return count === 0 ? 0 : nearBlack / count;
}

function textureStats(image: NormalizedImage, candidate: Candidate): { mean: number; std: number } {
  let sum = 0;
  let sq = 0;
  let count = 0;
  for (let y = candidate.y; y < candidate.y + candidate.height; y += 1) {
    for (let x = candidate.x; x < candidate.x + candidate.width; x += 1) {
      const value = luminance(image.data, pixelOffset(image.width, x, y));
      sum += value;
      sq += value * value;
      count += 1;
    }
  }
  const mean = count === 0 ? 0 : sum / count;
  return {
    mean,
    std: count === 0 ? 0 : Math.sqrt(Math.max(0, sq / count - mean * mean))
  };
}

function residual(image: NormalizedImage, candidate: Candidate, template: WatermarkTemplate): number {
  const spatial = spatialCorrelation(image, template, candidate.x, candidate.y);
  const gradient = gradientCorrelation(image, template, candidate.x, candidate.y);
  return Math.max(0, spatial) * 0.7 + Math.max(0, gradient) * 0.3;
}

function evaluate(image: NormalizedImage, candidate: Candidate, options: ValidateOptions): ValidatedCandidate | null {
  const registry = options.registry ?? defaultRegistry;
  const template = registry.get(candidate.templateId);
  if (!template) return null;

  const beforeNearBlack = nearBlackRatio(image, candidate);
  const beforeTexture = textureStats(image, candidate);
  const trial = restore(image, candidate, {
    mode: options.mode,
    registry,
    alphaGain: options.mode === 'aggressive' ? 1.16 : 1
  });
  const afterNearBlack = nearBlackRatio(trial.image, candidate);
  const afterTexture = textureStats(trial.image, candidate);
  const residualBefore = residual(image, candidate, template);
  const residualAfter = residual(trial.image, candidate, template);
  const residualReduction = residualBefore <= 1e-9 ? 0 : (residualBefore - residualAfter) / residualBefore;
  const nearBlackIncrease = afterNearBlack - beforeNearBlack;
  const texturePenalty = Math.max(0, beforeTexture.std * 0.72 - afterTexture.std) / Math.max(1, beforeTexture.std);
  const darknessPenalty = Math.max(0, beforeTexture.mean - afterTexture.mean - 1) / Math.max(1, beforeTexture.mean);
  const artifactScore = Math.max(0, nearBlackIncrease) * 2.4 + texturePenalty * 0.75 + darknessPenalty * 0.6;
  const mode = options.mode ?? 'safe';
  const score = candidate.confidence * 0.68 + Math.max(0, residualReduction) * 0.52 - artifactScore;
  const threshold = options.threshold ?? THRESHOLDS[mode];
  const accepted =
    score >= threshold &&
    residualReduction >= (mode === 'safe' ? 0.18 : 0.08) &&
    nearBlackIncrease <= MAX_NEAR_BLACK_INCREASE[mode] &&
    texturePenalty <= (mode === 'safe' ? 0.68 : 0.72);

  return {
    ...candidate,
    accepted,
    residualBefore,
    residualAfter,
    residualReduction,
    artifactScore,
    nearBlackIncrease,
    texturePenalty
  };
}

export function validate(
  image: NormalizedImage,
  candidates: Candidate[],
  options: ValidateOptions = {}
): ValidationResult {
  const validated = candidates
    .map((candidate) => evaluate(image, candidate, options))
    .filter((candidate): candidate is ValidatedCandidate => candidate !== null)
    .sort((a, b) => {
      const scoreA = a.confidence + a.residualReduction - a.artifactScore;
      const scoreB = b.confidence + b.residualReduction - b.artifactScore;
      return scoreB - scoreA;
    });

  return {
    candidates: validated,
    best: validated.find((candidate) => candidate.accepted)
  };
}

export { nearBlackRatio as calculateNearBlackRatio };
export const validator = { validate };
