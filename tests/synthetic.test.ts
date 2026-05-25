import { describe, expect, it } from 'vitest';
import {
  detectWatermark,
  defaultRegistry,
  GeminiOfficialLayoutPrior,
  removeWatermark,
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

function overlayTemplate(
  image: NormalizedImage,
  template: WatermarkTemplate,
  x: number,
  y: number,
  opacityScale = 1
): { image: NormalizedImage; candidate: Candidate } {
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

  return {
    image: output,
    candidate: {
      templateId: template.id,
      x,
      y,
      width: template.width,
      height: template.height,
      spatialScore: 1,
      gradientScore: 1,
      confidence: 1
    }
  };
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

describe('synthetic Gemini visible watermark pipeline', () => {
  it('registers the calibrated real template sizes', () => {
    expect(defaultRegistry.get('gemini-visible-white-48')).toMatchObject({ width: 48, height: 48 });
    expect(defaultRegistry.get('gemini-visible-white-56')).toMatchObject({ width: 56, height: 56 });
    expect(defaultRegistry.get('gemini-visible-white-96')).toMatchObject({ width: 96, height: 96 });
  });

  it('detects and restores a visible 48px watermark at the observed 1024x1024 prior', () => {
    const clean = makeBaseImage(1024, 1024);
    const template = defaultRegistry.get('gemini-visible-white-48')!;
    const x = 944;
    const y = 944;
    const watermarked = overlayTemplate(clean, template, x, y).image;

    const result = removeWatermark(watermarked, { mode: 'safe' });
    expect(result.applied).toBe(true);
    expect(result.meta.templateId).toBe(template.id);
    expect(result.meta.x).toBe(x);
    expect(result.meta.y).toBe(y);
    expect(result.meta.residualReduction).toBeGreaterThan(0.25);

    const before = regionMse(watermarked, clean, result.validation.best!);
    const after = regionMse(result.image, clean, result.validation.best!);
    expect(after).toBeLessThan(before * 0.35);
  });

  it('prefers no-op behavior on clean images in safe mode', () => {
    const clean = makeBaseImage(1024, 1024);
    const result = removeWatermark(clean, { mode: 'safe' });

    expect(result.applied).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.meta.skipReason).toMatch(/no-watermark-detected|validation-rejected/);
    expect(Buffer.compare(Buffer.from(result.image.data), Buffer.from(clean.data))).toBe(0);
  });

  it('uses the 2816x1536 calibrated catalog prior', () => {
    const clean = makeBaseImage(2816, 1536);
    const template = defaultRegistry.get('gemini-visible-white-96')!;
    const x = 2656;
    const y = 1376;
    const watermarked = overlayTemplate(clean, template, x, y).image;

    const candidates = detectWatermark(watermarked, { mode: 'safe' });
    expect(candidates[0]).toMatchObject({ templateId: template.id, x, y });
  });

  it('generates official catalog prior positions for observed Gemini sizes', () => {
    const prior = new GeminiOfficialLayoutPrior();
    expect(prior.generateCandidates(1024, 1024, defaultRegistry)[0]).toMatchObject({
      templateId: 'gemini-visible-white-48',
      x: 944,
      y: 944
    });
    expect(prior.generateCandidates(1184, 864, defaultRegistry)[0]).toMatchObject({
      templateId: 'gemini-visible-white-48',
      x: 1104,
      y: 784
    });
    expect(prior.generateCandidates(864, 1184, defaultRegistry)[0]).toMatchObject({
      templateId: 'gemini-visible-white-48',
      x: 784,
      y: 1104
    });
    expect(prior.generateCandidates(1200, 1200, defaultRegistry)[0]).toMatchObject({
      templateId: 'gemini-visible-white-56',
      x: 1106,
      y: 1106
    });
    expect(prior.generateCandidates(2816, 1536, defaultRegistry)[0]).toMatchObject({
      templateId: 'gemini-visible-white-96',
      x: 2656,
      y: 1376
    });
  });
});
