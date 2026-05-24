import { luminance, pixelOffset } from './image.js';
import { createDefaultLayoutPriors } from './layoutPriors.js';
import { defaultRegistry } from './registry.js';
import type { Candidate, DetectOptions, NormalizedImage, WatermarkMode, WatermarkTemplate } from './types.js';

interface ModeSettings {
  threshold: number;
  maxCandidates: number;
  exhaustiveStride: number;
}

const MODE_SETTINGS: Record<WatermarkMode, ModeSettings> = {
  safe: { threshold: 0.38, maxCandidates: 6, exhaustiveStride: 8 },
  aggressive: { threshold: 0.26, maxCandidates: 12, exhaustiveStride: 4 }
};

function pearson(a: number[], b: number[]): number {
  if (a.length < 3 || a.length !== b.length) return 0;
  let aSum = 0;
  let bSum = 0;
  for (let i = 0; i < a.length; i += 1) {
    aSum += a[i];
    bSum += b[i];
  }
  const aMean = aSum / a.length;
  const bMean = bSum / b.length;
  let numerator = 0;
  let aVariance = 0;
  let bVariance = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ad = a[i] - aMean;
    const bd = b[i] - bMean;
    numerator += ad * bd;
    aVariance += ad * ad;
    bVariance += bd * bd;
  }
  if (aVariance <= 1e-9 || bVariance <= 1e-9) return 0;
  return numerator / Math.sqrt(aVariance * bVariance);
}

export function spatialCorrelation(image: NormalizedImage, template: WatermarkTemplate, x: number, y: number): number {
  const alphaValues: number[] = [];
  const lumaValues: number[] = [];
  for (let ty = 0; ty < template.height; ty += 1) {
    for (let tx = 0; tx < template.width; tx += 1) {
      const alpha = template.alpha[ty * template.width + tx];
      if (alpha <= 0.015) continue;
      alphaValues.push(alpha);
      lumaValues.push(luminance(image.data, pixelOffset(image.width, x + tx, y + ty)));
    }
  }
  return pearson(alphaValues, lumaValues);
}

export function gradientCorrelation(image: NormalizedImage, template: WatermarkTemplate, x: number, y: number): number {
  const alphaGradients: number[] = [];
  const lumaGradients: number[] = [];
  for (let ty = 1; ty < template.height - 1; ty += 1) {
    for (let tx = 1; tx < template.width - 1; tx += 1) {
      const center = template.alpha[ty * template.width + tx];
      if (center <= 0.015) continue;
      const ax = template.alpha[ty * template.width + tx + 1] - template.alpha[ty * template.width + tx - 1];
      const ay = template.alpha[(ty + 1) * template.width + tx] - template.alpha[(ty - 1) * template.width + tx];
      const alphaMagnitude = Math.hypot(ax, ay);
      if (alphaMagnitude <= 0.006) continue;

      const i = pixelOffset(image.width, x + tx, y + ty);
      const lx = luminance(image.data, i + 4) - luminance(image.data, i - 4);
      const ly = luminance(image.data, i + image.width * 4) - luminance(image.data, i - image.width * 4);
      alphaGradients.push(alphaMagnitude);
      lumaGradients.push(Math.hypot(lx, ly));
    }
  }
  return pearson(alphaGradients, lumaGradients);
}

function scoreCandidate(image: NormalizedImage, candidate: Candidate, template: WatermarkTemplate): Candidate {
  const spatialScore = spatialCorrelation(image, template, candidate.x, candidate.y);
  const gradientScore = gradientCorrelation(image, template, candidate.x, candidate.y);
  const priorBoost = Math.max(0, Math.min(1, candidate.priorScore ?? 0.5)) * 0.08;
  return {
    ...candidate,
    spatialScore,
    gradientScore,
    confidence: Math.max(0, spatialScore) * 0.62 + Math.max(0, gradientScore) * 0.3 + priorBoost
  };
}

function exhaustiveCandidates(image: NormalizedImage, options: DetectOptions, stride: number): Candidate[] {
  const registry = options.registry ?? defaultRegistry;
  const out: Candidate[] = [];
  for (const template of registry.list()) {
    for (let y = 0; y <= image.height - template.height; y += stride) {
      for (let x = 0; x <= image.width - template.width; x += stride) {
        out.push({
          templateId: template.id,
          x,
          y,
          width: template.width,
          height: template.height,
          spatialScore: 0,
          gradientScore: 0,
          confidence: 0,
          priorId: 'exhaustive-scan',
          priorScore: 0.15
        });
      }
    }
  }
  return out;
}

function dedupe(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.templateId}:${candidate.x}:${candidate.y}:${candidate.width}:${candidate.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

export function detect(image: NormalizedImage, options: DetectOptions = {}): Candidate[] {
  const mode = options.mode ?? 'safe';
  const settings = MODE_SETTINGS[mode];
  const registry = options.registry ?? defaultRegistry;
  const priors = options.priors ?? createDefaultLayoutPriors(mode);
  const threshold = options.threshold ?? settings.threshold;
  const maxCandidates = options.maxCandidates ?? settings.maxCandidates;

  const seeded = priors.flatMap((prior) => prior.generateCandidates(image.width, image.height, registry));
  const rawCandidates = options.includeExhaustiveScan
    ? [...seeded, ...exhaustiveCandidates(image, options, settings.exhaustiveStride)]
    : seeded;

  return dedupe(rawCandidates)
    .map((candidate) => {
      const template = registry.get(candidate.templateId);
      if (!template) return null;
      if (candidate.x < 0 || candidate.y < 0 || candidate.x + template.width > image.width || candidate.y + template.height > image.height) return null;
      return scoreCandidate(image, candidate, template);
    })
    .filter((candidate): candidate is Candidate => candidate !== null && candidate.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxCandidates);
}

export const detector = { detect };
