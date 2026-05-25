import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  calibrateTemplateFromPair,
  defaultRegistry,
  deserializeTemplate,
  serializeTemplate,
  TemplateRegistry,
  type NormalizedImage,
  type WatermarkTemplate
} from '../src/index.js';

function makeTemplate(): WatermarkTemplate {
  return {
    id: 'test-visible-white-2x2',
    provider: 'test-provider',
    version: 'calibrated-v1',
    width: 2,
    height: 2,
    alpha: new Float32Array([0, 0.125, 0.25, 0.5]),
    color: [255, 255, 255],
    blendMode: 'normal-alpha',
    source: 'synthetic-test-fixture',
    calibratedAt: '2026-05-24T00:00:00.000Z',
    notes: 'round-trip test template'
  };
}

function makeImage(width: number, height: number, rgb: [number, number, number]): NormalizedImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function overlayTemplate(clean: NormalizedImage, template: WatermarkTemplate, x: number, y: number): NormalizedImage {
  const watermarked = { width: clean.width, height: clean.height, data: new Uint8ClampedArray(clean.data) };
  for (let ty = 0; ty < template.height; ty += 1) {
    for (let tx = 0; tx < template.width; tx += 1) {
      const alpha = template.alpha[ty * template.width + tx];
      const offset = ((y + ty) * clean.width + x + tx) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        watermarked.data[offset + channel] = Math.round(
          clean.data[offset + channel] * (1 - alpha) + template.color[channel] * alpha
        );
      }
    }
  }
  return watermarked;
}

describe('template serialization and calibration', () => {
  it('round-trips serializable templates with metadata and bounded alpha precision loss', () => {
    const template = makeTemplate();

    const serialized = serializeTemplate(template);
    const restored = deserializeTemplate(serialized);

    expect(restored).toMatchObject({
      id: template.id,
      provider: template.provider,
      version: template.version,
      width: template.width,
      height: template.height,
      color: template.color,
      blendMode: template.blendMode,
      source: template.source,
      calibratedAt: template.calibratedAt,
      notes: template.notes
    });
    expect(Array.from(restored.alpha)).toEqual(Array.from(template.alpha));
  });

  it('registers deserialized templates for lookup by id and size', () => {
    const template = deserializeTemplate(serializeTemplate(makeTemplate()));
    const registry = new TemplateRegistry([template]);

    expect(registry.get(template.id)?.id).toBe(template.id);
    expect(registry.findBySize(2, 2).map((item) => item.id)).toEqual([template.id]);
  });

  it('calibrates alpha from paired clean and watermarked images in a selected region', () => {
    const expected = makeTemplate();
    const clean = makeImage(6, 6, [80, 100, 120]);
    const watermarked = overlayTemplate(clean, expected, 3, 2);

    const calibrated = calibrateTemplateFromPair(clean, watermarked, {
      id: 'calibrated-visible-white-2x2',
      provider: 'test-provider',
      version: 'calibrated-v1',
      region: { x: 3, y: 2, width: 2, height: 2 },
      color: [255, 255, 255],
      source: 'synthetic paired fixture',
      calibratedAt: '2026-05-24T00:00:00.000Z',
      notes: 'calibration test'
    });

    expect(calibrated).toMatchObject({
      id: 'calibrated-visible-white-2x2',
      provider: 'test-provider',
      version: 'calibrated-v1',
      width: 2,
      height: 2,
      color: [255, 255, 255],
      blendMode: 'normal-alpha',
      source: 'synthetic paired fixture',
      calibratedAt: '2026-05-24T00:00:00.000Z',
      notes: 'calibration test'
    });

    for (let i = 0; i < expected.alpha.length; i += 1) {
      expect(calibrated.alpha[i]).toBeCloseTo(expected.alpha[i], 2);
    }
  });

  it('rejects invalid serialized templates and calibration inputs', () => {
    expect(() =>
      deserializeTemplate({
        ...serializeTemplate(makeTemplate()),
        alpha: [0, 0.2, Number.NaN, 0.4]
      })
    ).toThrow(/alpha/);

    expect(() =>
      calibrateTemplateFromPair(makeImage(4, 4, [10, 20, 30]), makeImage(5, 4, [10, 20, 30]), {
        id: 'bad-size',
        version: 'v1',
        region: { x: 0, y: 0, width: 2, height: 2 }
      })
    ).toThrow(/matching dimensions/);

    expect(() =>
      calibrateTemplateFromPair(makeImage(4, 4, [10, 20, 30]), makeImage(4, 4, [10, 20, 30]), {
        id: 'bad-region',
        version: 'v1',
        region: { x: 0.5, y: 0, width: 2, height: 2 }
      })
    ).toThrow(/integers/);

    expect(() =>
      calibrateTemplateFromPair(makeImage(4, 4, [10, 20, 30]), makeImage(4, 4, [10, 20, 30]), {
        id: 'bad-color',
        version: 'v1',
        region: { x: 0, y: 0, width: 2, height: 2 },
        color: [255, Number.NaN, 255]
      })
    ).toThrow(/color/);
  });

  it('keeps built-in Gemini template JSON assets structurally valid and registered', async () => {
    for (const size of [48, 56, 96] as const) {
      const assetPath = join(process.cwd(), 'templates', `gemini-visible-white-${size}.json`);
      const asset = JSON.parse(await readFile(assetPath, 'utf8'));
      const template = defaultRegistry.get(`gemini-visible-white-${size}`);

      expect(asset).toMatchObject({
        id: `gemini-visible-white-${size}`,
        width: size,
        height: size,
        color: [255, 255, 255],
        blendMode: 'normal-alpha',
        version: 'calibrated-examples-2026-05',
        provider: 'gemini'
      });
      expect(asset.alpha).toHaveLength(size * size);
      expect(asset.alpha.every((alpha: number) => Number.isFinite(alpha) && alpha >= 0 && alpha <= 1)).toBe(true);
      expect(template).toMatchObject({
        id: asset.id,
        width: asset.width,
        height: asset.height,
        color: asset.color,
        blendMode: asset.blendMode,
        version: asset.version,
        source: asset.source,
        provider: asset.provider,
        notes: asset.notes
      });
      expect(Array.from(template!.alpha)).toEqual(Array.from(Float32Array.from(asset.alpha)));
    }
  });
});
