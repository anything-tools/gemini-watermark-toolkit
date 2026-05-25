import { describe, expect, it } from 'vitest';
import {
  defaultRegistry,
  removeWatermark,
  restoreWatermark,
  type Candidate,
  type NormalizedImage,
  type WatermarkTemplate
} from '../src/index.js';

function makeBaseImage(width: number, height: number): NormalizedImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = Math.round(34 + (x % 251) * 0.31 + (y % 173) * 0.09);
      data[offset + 1] = Math.round(62 + (x % 199) * 0.12 + (y % 211) * 0.21);
      data[offset + 2] = Math.round(92 + (x % 157) * 0.08 + (y % 191) * 0.16);
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

function clone(image: NormalizedImage): NormalizedImage {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data)
  };
}

function overlayTemplate(image: NormalizedImage, template: WatermarkTemplate, x: number, y: number, opacityScale = 1): NormalizedImage {
  const output = clone(image);
  for (let ty = 0; ty < template.height; ty += 1) {
    for (let tx = 0; tx < template.width; tx += 1) {
      const alpha = Math.min(0.9, template.alpha[ty * template.width + tx] * opacityScale);
      if (alpha <= 0.002) continue;
      const offset = ((y + ty) * output.width + x + tx) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[offset + channel] = Math.round(output.data[offset + channel] * (1 - alpha) + template.color[channel] * alpha);
      }
    }
  }
  return output;
}

function regionMse(a: NormalizedImage, b: NormalizedImage, candidate: Candidate): number {
  let error = 0;
  let count = 0;
  for (let y = candidate.y; y < candidate.y + candidate.height; y += 1) {
    for (let x = candidate.x; x < candidate.x + candidate.width; x += 1) {
      const offset = (y * a.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = a.data[offset + channel] - b.data[offset + channel];
        error += delta * delta;
        count += 1;
      }
    }
  }
  return error / count;
}

describe('advanced restoration heuristics', () => {
  it('selects an alpha-gain refinement that improves aggressive restoration quality', () => {
    const clean = makeBaseImage(1024, 1024);
    const template = defaultRegistry.get('gemini-visible-white-48')!;
    const x = 944;
    const y = 944;
    const watermarked = overlayTemplate(clean, template, x, y, 1.18);

    const baseline = restoreWatermark(watermarked, {
      templateId: template.id,
      x,
      y,
      width: template.width,
      height: template.height,
      spatialScore: 1,
      gradientScore: 1,
      confidence: 1
    }, { mode: 'aggressive', alphaGain: 1 });
    const result = removeWatermark(watermarked, { mode: 'aggressive' });

    expect(result.applied).toBe(true);
    expect(result.meta.refinement).toBe('alpha-gain-search');
    expect(result.meta.alphaGain).toBeGreaterThan(1);
    expect(result.meta.passCount).toBe(1);
    expect(result.meta.residualAfter).toBeLessThan(result.meta.residualBefore!);
    expect(regionMse(result.image, clean, result.validation.best!)).toBeLessThan(
      regionMse(baseline.image, clean, result.validation.best!) * 0.75
    );
  });

  it('keeps safe mode conservative on clean benchmark negatives while reporting diagnostics', () => {
    const clean = makeBaseImage(1024, 1024);
    const result = removeWatermark(clean, { mode: 'safe' });

    expect(result.applied).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.meta.refinement).toBe('none');
    expect(result.meta.passCount).toBe(0);
    expect(result.meta.alphaGain).toBeUndefined();
    expect(Buffer.compare(Buffer.from(result.image.data), Buffer.from(clean.data))).toBe(0);
  });

  it('rejects unsafe alpha-gain search values and out-of-bounds candidates', () => {
    const clean = makeBaseImage(128, 128);
    const template = defaultRegistry.get('gemini-visible-white-96')!;
    const candidate: Candidate = {
      templateId: template.id,
      x: 16,
      y: 16,
      width: template.width,
      height: template.height,
      spatialScore: 1,
      gradientScore: 1,
      confidence: 1
    };

    expect(() => restoreWatermark(clean, candidate, {
      mode: 'aggressive',
      alphaGainSearch: [Number.NaN, Number.POSITIVE_INFINITY, -1]
    })).toThrow(/alphaGainSearch/);

    const outOfBounds = restoreWatermark(clean, { ...candidate, x: 64 }, { mode: 'aggressive' });
    expect(outOfBounds.changed).toBe(false);
    expect(outOfBounds.refinement).toBe('none');
    expect(outOfBounds.passCount).toBe(0);
    expect(Buffer.compare(Buffer.from(outOfBounds.image.data), Buffer.from(clean.data))).toBe(0);
  });
});
