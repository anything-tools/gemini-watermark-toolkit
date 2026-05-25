import { pixelOffset } from './image.js';
import { defaultRegistry } from './registry.js';
import { removeWatermark } from './index.js';
import type { Candidate, NormalizedImage, RemoveWatermarkResult, WatermarkMode, WatermarkTemplate } from './types.js';

export type BenchmarkFixtureKind = 'positive' | 'negative';

export interface BenchmarkFixtureExpected {
  applied: boolean;
  templateId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface BenchmarkFixture {
  id: string;
  kind: BenchmarkFixtureKind;
  description: string;
  image: NormalizedImage;
  cleanImage: NormalizedImage;
  expected: BenchmarkFixtureExpected;
}

export interface BenchmarkOptions {
  mode?: WatermarkMode;
}

export interface BenchmarkFixtureResult {
  id: string;
  kind: BenchmarkFixtureKind;
  expectedApplied: boolean;
  applied: boolean;
  matchedExpected: boolean;
  templateId?: string;
  x?: number;
  y?: number;
  residualReduction: number;
  mse: number;
  psnr: number | null;
  artifactScore: number;
  nearBlackIncrease: number;
}

export interface BenchmarkSummary {
  mode: WatermarkMode;
  fixtureCount: number;
  positiveCount: number;
  negativeCount: number;
  truePositiveCount: number;
  falsePositiveCount: number;
  falseNegativeCount: number;
  localizationErrorCount: number;
  detectionRecall: number;
  falsePositiveRate: number;
  averageResidualReduction: number;
  averageMse: number;
  averagePsnr: number | null;
  results: BenchmarkFixtureResult[];
}

function makeBaseImage(width: number, height: number): NormalizedImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = pixelOffset(width, x, y);
      data[offset] = Math.round(34 + (x % 251) * 0.31 + (y % 173) * 0.09);
      data[offset + 1] = Math.round(62 + (x % 199) * 0.12 + (y % 211) * 0.21);
      data[offset + 2] = Math.round(92 + (x % 157) * 0.08 + (y % 191) * 0.16);
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

function cloneImage(image: NormalizedImage): NormalizedImage {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data)
  };
}

function overlayTemplate(
  image: NormalizedImage,
  template: WatermarkTemplate,
  x: number,
  y: number,
  opacityScale = 1
): NormalizedImage {
  const output = cloneImage(image);
  for (let ty = 0; ty < template.height; ty += 1) {
    for (let tx = 0; tx < template.width; tx += 1) {
      const alpha = Math.min(0.9, template.alpha[ty * template.width + tx] * opacityScale);
      if (alpha <= 0.002) continue;
      const offset = pixelOffset(output.width, x + tx, y + ty);
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[offset + channel] = Math.round(output.data[offset + channel] * (1 - alpha) + template.color[channel] * alpha);
      }
    }
  }
  return output;
}

function makePositiveFixture(
  id: string,
  description: string,
  width: number,
  height: number,
  templateId: string,
  x: number,
  y: number
): BenchmarkFixture {
  const cleanImage = makeBaseImage(width, height);
  const template = defaultRegistry.get(templateId);
  if (!template) throw new Error(`Missing built-in template ${templateId}`);
  return {
    id,
    kind: 'positive',
    description,
    cleanImage,
    image: overlayTemplate(cleanImage, template, x, y),
    expected: {
      applied: true,
      templateId,
      x,
      y,
      width: template.width,
      height: template.height
    }
  };
}

function makeNegativeFixture(id: string, description: string, width: number, height: number): BenchmarkFixture {
  const cleanImage = makeBaseImage(width, height);
  return {
    id,
    kind: 'negative',
    description,
    cleanImage,
    image: cloneImage(cleanImage),
    expected: { applied: false }
  };
}

export function createBenchmarkFixtures(): BenchmarkFixture[] {
  return [
    makePositiveFixture(
      'synthetic-gemini-48-1024x1024-observed',
      'Synthetic 1024x1024 Gemini visible watermark at observed 48px prior.',
      1024,
      1024,
      'gemini-visible-white-48',
      944,
      944
    ),
    makeNegativeFixture(
      'synthetic-clean-1k-negative',
      'Clean 1024x1024 synthetic image with no watermark.',
      1024,
      1024
    ),
    makePositiveFixture(
      'synthetic-gemini-96-2816x1536-observed',
      'Synthetic 2816x1536 Gemini visible watermark at observed 96px prior.',
      2816,
      1536,
      'gemini-visible-white-96',
      2656,
      1376
    )
  ];
}

function candidateFromExpected(expected: BenchmarkFixtureExpected, image: NormalizedImage): Candidate | undefined {
  if (!expected.applied || expected.x === undefined || expected.y === undefined) return undefined;
  const template = expected.templateId ? defaultRegistry.get(expected.templateId) : undefined;
  return {
    templateId: expected.templateId ?? '',
    x: expected.x,
    y: expected.y,
    width: expected.width ?? template?.width ?? image.width,
    height: expected.height ?? template?.height ?? image.height,
    spatialScore: 0,
    gradientScore: 0,
    confidence: 0
  };
}

function regionMse(a: NormalizedImage, b: NormalizedImage, candidate?: Candidate): number {
  const startX = candidate?.x ?? 0;
  const startY = candidate?.y ?? 0;
  const width = candidate?.width ?? a.width;
  const height = candidate?.height ?? a.height;
  let error = 0;
  let count = 0;
  for (let y = startY; y < startY + height; y += 1) {
    for (let x = startX; x < startX + width; x += 1) {
      const offset = pixelOffset(a.width, x, y);
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = a.data[offset + channel] - b.data[offset + channel];
        error += delta * delta;
        count += 1;
      }
    }
  }
  return count === 0 ? 0 : error / count;
}

function psnrFromMse(mse: number): number | null {
  if (mse <= 1e-12) return null;
  return 10 * Math.log10((255 * 255) / mse);
}

function matchesExpected(fixture: BenchmarkFixture, result: RemoveWatermarkResult): boolean {
  if (fixture.expected.applied !== result.applied) return false;
  if (!fixture.expected.applied) return true;
  return result.meta.templateId === fixture.expected.templateId &&
    result.meta.x === fixture.expected.x &&
    result.meta.y === fixture.expected.y;
}

function summarizeAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeNullableAverage(values: Array<number | null>): number | null {
  const finiteValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finiteValues.length === 0 ? null : summarizeAverage(finiteValues);
}

export function runBenchmark(fixtures: BenchmarkFixture[] = createBenchmarkFixtures(), options: BenchmarkOptions = {}): BenchmarkSummary {
  const mode = options.mode ?? 'safe';
  const results = fixtures.map((fixture): BenchmarkFixtureResult => {
    const result = removeWatermark(fixture.image, { mode });
    const measurementCandidate = result.validation.best ?? candidateFromExpected(fixture.expected, fixture.image);
    const mse = regionMse(result.image, fixture.cleanImage, measurementCandidate);
    return {
      id: fixture.id,
      kind: fixture.kind,
      expectedApplied: fixture.expected.applied,
      applied: result.applied,
      matchedExpected: matchesExpected(fixture, result),
      templateId: result.meta.templateId,
      x: result.meta.x,
      y: result.meta.y,
      residualReduction: result.meta.residualReduction ?? 0,
      mse,
      psnr: psnrFromMse(mse),
      artifactScore: result.meta.artifactScore ?? 0,
      nearBlackIncrease: result.validation.best?.nearBlackIncrease ?? 0
    };
  });

  const positives = results.filter((result) => result.kind === 'positive');
  const negatives = results.filter((result) => result.kind === 'negative');
  const truePositiveCount = positives.filter((result) => result.matchedExpected && result.applied).length;
  const falsePositiveCount = negatives.filter((result) => result.applied).length;
  const falseNegativeCount = positives.filter((result) => !result.applied).length;
  const localizationErrorCount = positives.filter((result) => result.applied && !result.matchedExpected).length;
  const positiveQuality = results.filter((result) => result.kind === 'positive' && result.applied && result.matchedExpected);

  return {
    mode,
    fixtureCount: results.length,
    positiveCount: positives.length,
    negativeCount: negatives.length,
    truePositiveCount,
    falsePositiveCount,
    falseNegativeCount,
    localizationErrorCount,
    detectionRecall: positives.length === 0 ? 0 : truePositiveCount / positives.length,
    falsePositiveRate: negatives.length === 0 ? 0 : falsePositiveCount / negatives.length,
    averageResidualReduction: summarizeAverage(positiveQuality.map((result) => result.residualReduction)),
    averageMse: summarizeAverage(positiveQuality.map((result) => result.mse)),
    averagePsnr: summarizeNullableAverage(positiveQuality.map((result) => result.psnr)),
    results
  };
}
