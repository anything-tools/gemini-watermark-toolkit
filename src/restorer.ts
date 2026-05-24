import { clampByte, cloneImage, pixelOffset } from './image.js';
import { defaultRegistry } from './registry.js';
import type { Candidate, NormalizedImage, RestoreOptions, RestoreResult } from './types.js';

const DEFAULT_ALPHA_GAIN = {
  safe: 0.9,
  aggressive: 1.18
} as const;

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
    return { image: output, changed: false };
  }

  const alphaGain = options.alphaGain ?? DEFAULT_ALPHA_GAIN[mode];
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

  return {
    image: output,
    changed: true,
    candidate
  };
}

export const restorer = { restore };
