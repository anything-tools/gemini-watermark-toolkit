import { normalizeImage } from './image.js';
import type {
  NormalizedImage,
  PixelImage,
  SerializedWatermarkTemplate,
  TemplateCalibrationOptions,
  TemplateCalibrationRegion,
  WatermarkTemplate
} from './types.js';

const DEFAULT_WATERMARK_COLOR: [number, number, number] = [255, 255, 255];
const MAX_ALPHA = 0.95;
const MIN_DENOMINATOR = 1;

function assertIntegerDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function assertColor(color: [number, number, number]): void {
  if (color.length !== 3 || color.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
    throw new RangeError('template color must be an RGB tuple with finite 0-255 values');
  }
}

function assertAlpha(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > MAX_ALPHA) {
    throw new RangeError(`template alpha values must be finite numbers between 0 and ${MAX_ALPHA}`);
  }
}

function assertTemplateShape(template: WatermarkTemplate | SerializedWatermarkTemplate): void {
  if (!template.id) throw new TypeError('template id is required');
  assertIntegerDimension(template.width, 'template width');
  assertIntegerDimension(template.height, 'template height');
  if (template.alpha.length !== template.width * template.height) {
    throw new RangeError(`template ${template.id} alpha length must match width * height`);
  }
  for (const alpha of template.alpha) assertAlpha(alpha);
  if (template.blendMode !== 'normal-alpha') {
    throw new RangeError(`unsupported blend mode: ${template.blendMode}`);
  }
  assertColor(template.color);
}

function clampAlpha(value: number): number {
  return Math.min(MAX_ALPHA, Math.max(0, value));
}

function validateRegion(region: TemplateCalibrationRegion, image: NormalizedImage): void {
  if (![region.x, region.y, region.width, region.height].every(Number.isInteger)) {
    throw new RangeError('calibration region coordinates and dimensions must be integers');
  }
  if (region.width <= 0 || region.height <= 0) {
    throw new RangeError('calibration region dimensions must be positive');
  }
  if (region.x < 0 || region.y < 0 || region.x + region.width > image.width || region.y + region.height > image.height) {
    throw new RangeError('calibration region must fit inside the image');
  }
}

function estimatePixelAlpha(clean: NormalizedImage, watermarked: NormalizedImage, offset: number, color: [number, number, number]): number {
  const estimates: number[] = [];
  for (let channel = 0; channel < 3; channel += 1) {
    const denominator = color[channel] - clean.data[offset + channel];
    if (Math.abs(denominator) < MIN_DENOMINATOR) continue;
    estimates.push((watermarked.data[offset + channel] - clean.data[offset + channel]) / denominator);
  }

  if (estimates.length === 0) return 0;
  const average = estimates.reduce((sum, value) => sum + value, 0) / estimates.length;
  return clampAlpha(average);
}

export function serializeTemplate(template: WatermarkTemplate): SerializedWatermarkTemplate {
  assertTemplateShape(template);
  return {
    id: template.id,
    width: template.width,
    height: template.height,
    alpha: Array.from(template.alpha),
    color: [...template.color] as [number, number, number],
    blendMode: template.blendMode,
    version: template.version,
    source: template.source,
    provider: template.provider,
    calibratedAt: template.calibratedAt,
    notes: template.notes
  };
}

export function deserializeTemplate(serialized: SerializedWatermarkTemplate): WatermarkTemplate {
  assertTemplateShape(serialized);
  return {
    id: serialized.id,
    width: serialized.width,
    height: serialized.height,
    alpha: Float32Array.from(serialized.alpha, clampAlpha),
    color: [...serialized.color] as [number, number, number],
    blendMode: serialized.blendMode,
    version: serialized.version,
    source: serialized.source,
    provider: serialized.provider,
    calibratedAt: serialized.calibratedAt,
    notes: serialized.notes
  };
}

export function calibrateTemplateFromPair(
  cleanImage: PixelImage,
  watermarkedImage: PixelImage,
  options: TemplateCalibrationOptions
): WatermarkTemplate {
  const clean = normalizeImage(cleanImage);
  const watermarked = normalizeImage(watermarkedImage);
  if (clean.width !== watermarked.width || clean.height !== watermarked.height) {
    throw new RangeError('clean and watermarked images must have matching dimensions');
  }

  validateRegion(options.region, clean);

  const color = options.color ?? DEFAULT_WATERMARK_COLOR;
  assertColor(color);
  const alpha = new Float32Array(options.region.width * options.region.height);
  for (let y = 0; y < options.region.height; y += 1) {
    for (let x = 0; x < options.region.width; x += 1) {
      const offset = ((options.region.y + y) * clean.width + options.region.x + x) * 4;
      alpha[y * options.region.width + x] = estimatePixelAlpha(clean, watermarked, offset, color);
    }
  }

  return {
    id: options.id,
    provider: options.provider,
    version: options.version,
    width: options.region.width,
    height: options.region.height,
    alpha,
    color,
    blendMode: 'normal-alpha',
    source: options.source,
    calibratedAt: options.calibratedAt,
    notes: options.notes
  };
}
