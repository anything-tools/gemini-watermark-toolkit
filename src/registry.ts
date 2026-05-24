import type { WatermarkPresetName, WatermarkTemplate, WatermarkTemplateRegistry } from './types.js';

export class TemplateRegistry implements WatermarkTemplateRegistry {
  readonly #templates = new Map<string, WatermarkTemplate>();

  constructor(templates: WatermarkTemplate[] = []) {
    for (const template of templates) {
      this.register(template);
    }
  }

  register(template: WatermarkTemplate): void {
    if (template.width <= 0 || template.height <= 0) {
      throw new RangeError('template dimensions must be positive');
    }
    if (template.alpha.length !== template.width * template.height) {
      throw new RangeError(`template ${template.id} alpha length must match width * height`);
    }
    this.#templates.set(template.id, template);
  }

  get(id: string): WatermarkTemplate | undefined {
    return this.#templates.get(id);
  }

  list(): WatermarkTemplate[] {
    return [...this.#templates.values()];
  }

  findBySize(width: number, height: number): WatermarkTemplate[] {
    return this.list().filter((template) => template.width === width && template.height === height);
  }
}

function put(alpha: Float32Array, width: number, height: number, x: number, y: number, value: number): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  alpha[y * width + x] = Math.max(alpha[y * width + x], value);
}

function drawDiamond(alpha: Float32Array, size: number, cx: number, cy: number, radius: number, strength: number): void {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const d = (Math.abs(x) + Math.abs(y)) / radius;
      if (d > 1) continue;
      put(alpha, size, size, cx + x, cy + y, strength * (1 - d * 0.45));
    }
  }
}

function drawRay(alpha: Float32Array, size: number, cx: number, cy: number, dx: number, dy: number, length: number): void {
  for (let i = 0; i <= length; i += 1) {
    const falloff = 1 - i / (length + 1);
    const x = Math.round(cx + dx * i);
    const y = Math.round(cy + dy * i);
    put(alpha, size, size, x, y, 0.58 * falloff);
    if (i < length * 0.72) {
      put(alpha, size, size, x + Math.sign(dy), y + Math.sign(dx), 0.28 * falloff);
      put(alpha, size, size, x - Math.sign(dy), y - Math.sign(dx), 0.28 * falloff);
    }
  }
}

function blur(alpha: Float32Array, width: number, height: number, passes: number): Float32Array {
  let current = alpha;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float32Array(current.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let weight = 0;
        for (let ky = -1; ky <= 1; ky += 1) {
          for (let kx = -1; kx <= 1; kx += 1) {
            const px = x + kx;
            const py = y + ky;
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const w = kx === 0 && ky === 0 ? 4 : 1;
            sum += current[py * width + px] * w;
            weight += w;
          }
        }
        next[y * width + x] = Math.min(0.42, sum / weight);
      }
    }
    current = next;
  }
  return current;
}

function createSyntheticGeminiAlpha(size: 48 | 96, variant: 'classic' | 'new-margin' = 'classic'): Float32Array {
  const alpha = new Float32Array(size * size);
  const scale = size / 48;
  const cx = Math.round((variant === 'new-margin' ? 23.5 : 24) * scale);
  const cy = Math.round((variant === 'new-margin' ? 23.5 : 24) * scale);
  drawDiamond(alpha, size, cx, cy, Math.round(8 * scale), 0.34);
  drawDiamond(alpha, size, cx, cy, Math.round(4 * scale), 0.4);

  const long = Math.round(18 * scale);
  const short = Math.round(11 * scale);
  drawRay(alpha, size, cx, cy, 1, 0, long);
  drawRay(alpha, size, cx, cy, -1, 0, long);
  drawRay(alpha, size, cx, cy, 0, 1, long);
  drawRay(alpha, size, cx, cy, 0, -1, long);
  drawRay(alpha, size, cx, cy, 1, 1, short);
  drawRay(alpha, size, cx, cy, -1, -1, short);
  drawRay(alpha, size, cx, cy, 1, -1, short);
  drawRay(alpha, size, cx, cy, -1, 1, short);

  return blur(alpha, size, size, size === 48 ? 1 : 2);
}

function createTemplate(id: string, size: 48 | 96, variant?: 'new-margin'): WatermarkTemplate {
  return {
    id,
    width: size,
    height: size,
    alpha: createSyntheticGeminiAlpha(size, variant === 'new-margin' ? 'new-margin' : 'classic'),
    color: [255, 255, 255],
    blendMode: 'normal-alpha',
    version: variant === 'new-margin' ? 'synthetic-approx-2026-05-new-margin' : 'synthetic-approx-2026-05',
    source: 'Synthetic approximation for deterministic tests and calibration; not an official Gemini asset.',
    provider: 'gemini'
  };
}

export function createDefaultRegistry(): TemplateRegistry {
  return new TemplateRegistry([
    createTemplate('gemini-visible-white-48', 48),
    createTemplate('gemini-visible-white-96', 96),
    createTemplate('gemini-visible-white-96-new-margin', 96, 'new-margin')
  ]);
}

export const defaultRegistry = createDefaultRegistry();

export function getPreset(name: WatermarkPresetName = 'gemini'): WatermarkTemplate {
  if (name !== 'gemini') {
    throw new RangeError(`unknown preset: ${name}`);
  }
  const template = defaultRegistry.get('gemini-visible-white-96');
  if (!template) {
    throw new Error('default Gemini template is not registered');
  }
  return template;
}
