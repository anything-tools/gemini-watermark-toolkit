import { describe, expect, it } from 'vitest';
import {
  createBenchmarkFixtures,
  runBenchmark,
  type BenchmarkFixture
} from '../src/benchmark.js';

function fixtureById(fixtures: BenchmarkFixture[], id: string): BenchmarkFixture {
  const fixture = fixtures.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Missing fixture ${id}`);
  return fixture;
}

describe('benchmark fixture framework', () => {
  it('creates deterministic positive and negative fixtures with expected metadata', () => {
    const first = createBenchmarkFixtures();
    const second = createBenchmarkFixtures();

    expect(first.map((fixture) => fixture.id)).toEqual([
      'synthetic-gemini-48-1024x1024-observed',
      'synthetic-clean-1k-negative',
      'synthetic-gemini-96-2816x1536-observed'
    ]);
    expect(first.map((fixture) => fixture.kind)).toEqual(['positive', 'negative', 'positive']);
    expect(fixtureById(first, 'synthetic-gemini-48-1024x1024-observed').expected).toMatchObject({
      applied: true,
      templateId: 'gemini-visible-white-48',
      x: 944,
      y: 944
    });
    expect(fixtureById(first, 'synthetic-clean-1k-negative').expected).toEqual({ applied: false });
    expect(first.map((fixture) => ({
      id: fixture.id,
      kind: fixture.kind,
      description: fixture.description,
      width: fixture.image.width,
      height: fixture.image.height,
      expected: fixture.expected,
      firstPixel: Array.from(fixture.image.data.slice(0, 4)),
      lastPixel: Array.from(fixture.image.data.slice(-4))
    }))).toEqual(second.map((fixture) => ({
      id: fixture.id,
      kind: fixture.kind,
      description: fixture.description,
      width: fixture.image.width,
      height: fixture.image.height,
      expected: fixture.expected,
      firstPixel: Array.from(fixture.image.data.slice(0, 4)),
      lastPixel: Array.from(fixture.image.data.slice(-4))
    })));
  });

  it('reports deterministic JSON-friendly metrics for safe mode', () => {
    const summary = runBenchmark(createBenchmarkFixtures(), { mode: 'safe' });
    const repeated = runBenchmark(createBenchmarkFixtures(), { mode: 'safe' });

    expect(summary).toEqual(repeated);
    expect(summary.mode).toBe('safe');
    expect(summary.fixtureCount).toBe(3);
    expect(summary.positiveCount).toBe(2);
    expect(summary.negativeCount).toBe(1);
    expect(summary.detectionRecall).toBe(1);
    expect(summary.falsePositiveRate).toBe(0);
    expect(summary.averageResidualReduction).toBeGreaterThan(0.25);
    expect(summary.averagePsnr).toBeGreaterThan(25);
    expect(summary.localizationErrorCount).toBe(0);
    expect(summary.results).toHaveLength(3);

    const jsonRoundTrip = JSON.parse(JSON.stringify(summary));
    expect(jsonRoundTrip.results.every((result: { psnr: number | null }) =>
      result.psnr === null || Number.isFinite(result.psnr)
    )).toBe(true);
    expect(jsonRoundTrip.results.find((result: { id: string }) => result.id === 'synthetic-clean-1k-negative').psnr).toBeNull();
  });
});
