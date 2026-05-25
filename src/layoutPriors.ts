import type { Candidate, LayoutPrior, WatermarkTemplateRegistry } from './types.js';

interface GeminiSizeEntry {
  width: number;
  height: number;
  tier: '0.5k' | '1k' | '1k-square-1200' | '2k' | '4k';
}

interface GeminiWatermarkConfig {
  templateId: string;
  logoSize: 48 | 56 | 96;
  marginRight: number;
  marginBottom: number;
}

const GEMINI_TIER_CONFIGS: Record<GeminiSizeEntry['tier'], GeminiWatermarkConfig> = {
  '0.5k': { templateId: 'gemini-visible-white-48', logoSize: 48, marginRight: 32, marginBottom: 32 },
  '1k': { templateId: 'gemini-visible-white-48', logoSize: 48, marginRight: 32, marginBottom: 32 },
  '1k-square-1200': { templateId: 'gemini-visible-white-56', logoSize: 56, marginRight: 38, marginBottom: 38 },
  '2k': { templateId: 'gemini-visible-white-96', logoSize: 96, marginRight: 64, marginBottom: 64 },
  '4k': { templateId: 'gemini-visible-white-96', logoSize: 96, marginRight: 64, marginBottom: 64 }
};

export const OFFICIAL_GEMINI_IMAGE_SIZES: readonly GeminiSizeEntry[] = Object.freeze([
  ...createEntries('0.5k', [[512, 512], [256, 1024], [192, 1536], [424, 632], [632, 424], [448, 600], [1024, 256], [600, 448], [464, 576], [576, 464], [1536, 192], [384, 688], [688, 384], [792, 168]]),
  ...createEntries('1k', [[1024, 1024], [512, 2048], [384, 3072], [848, 1264], [1264, 848], [896, 1200], [2048, 512], [1200, 896], [928, 1152], [1152, 928], [3072, 384], [768, 1376], [1376, 768], [1408, 768], [1584, 672], [832, 1248], [1248, 832], [864, 1184], [1184, 864], [896, 1152], [768, 1344], [1344, 768], [1536, 672]]),
  ...createEntries('1k-square-1200', [[1200, 1200]]),
  ...createEntries('2k', [[2048, 2048], [1024, 4096], [768, 6144], [1696, 2528], [2528, 1696], [1792, 2400], [4096, 1024], [2400, 1792], [1856, 2304], [2304, 1856], [6144, 768], [1536, 2752], [2752, 1536], [3168, 1344]]),
  ...createEntries('2k', [[2816, 1536]]),
  ...createEntries('4k', [[4096, 4096], [2048, 8192], [1536, 12288], [3392, 5056], [5056, 3392], [3584, 4800], [8192, 2048], [4800, 3584], [3712, 4608], [4608, 3712], [12288, 1536], [3072, 5504], [5504, 3072], [6336, 2688]])
]);

function createEntries(tier: GeminiSizeEntry['tier'], sizes: Array<[number, number]>): GeminiSizeEntry[] {
  return sizes.map(([width, height]) => ({ width, height, tier }));
}

function emptyCandidate(config: GeminiWatermarkConfig, x: number, y: number, priorId: string, priorScore: number): Candidate {
  return {
    templateId: config.templateId,
    x,
    y,
    width: config.logoSize,
    height: config.logoSize,
    spatialScore: 0,
    gradientScore: 0,
    confidence: 0,
    priorId,
    priorScore
  };
}

function addCandidate(
  out: Candidate[],
  registry: WatermarkTemplateRegistry,
  imageWidth: number,
  imageHeight: number,
  config: GeminiWatermarkConfig,
  priorId: string,
  priorScore: number
): void {
  const template = registry.get(config.templateId);
  if (!template) return;
  const x = imageWidth - config.marginRight - config.logoSize;
  const y = imageHeight - config.marginBottom - config.logoSize;
  if (x < 0 || y < 0 || x + config.logoSize > imageWidth || y + config.logoSize > imageHeight) return;
  out.push(emptyCandidate(config, x, y, priorId, priorScore));
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

export class GeminiOfficialLayoutPrior implements LayoutPrior {
  readonly id = 'gemini-official-size-catalog';

  generateCandidates(imageWidth: number, imageHeight: number, registry: WatermarkTemplateRegistry): Candidate[] {
    const candidates: Candidate[] = [];
    const exact = OFFICIAL_GEMINI_IMAGE_SIZES.find((entry) => entry.width === imageWidth && entry.height === imageHeight);
    if (exact) {
      addCandidate(candidates, registry, imageWidth, imageHeight, GEMINI_TIER_CONFIGS[exact.tier], this.id, 1);
      return dedupe(candidates);
    }

    const aspect = imageWidth / imageHeight;
    const near = OFFICIAL_GEMINI_IMAGE_SIZES
      .map((entry) => {
        const sx = imageWidth / entry.width;
        const sy = imageHeight / entry.height;
        const mismatch = Math.abs(sx - sy) / Math.max(sx, sy);
        const aspectDelta = Math.abs(aspect - entry.width / entry.height) / (entry.width / entry.height);
        return { entry, sx, sy, score: aspectDelta * 100 + mismatch * 20 + Math.abs(Math.log2(Math.max((sx + sy) / 2, 1e-6))) };
      })
      .filter(({ score, sx, sy }) => score < 3.5 && Math.abs(sx - sy) / Math.max(sx, sy) <= 0.12)
      .sort((a, b) => a.score - b.score)
      .slice(0, 3);

    for (const item of near) {
      const base = GEMINI_TIER_CONFIGS[item.entry.tier];
      const scale = (item.sx + item.sy) / 2;
      const scaledLogoSize = Math.round(base.logoSize * scale);
      const logoSize = scaledLogoSize <= 52 ? 48 : scaledLogoSize <= 76 ? 56 : 96;
      const templateId = logoSize === 48 ? 'gemini-visible-white-48' : logoSize === 56 ? 'gemini-visible-white-56' : 'gemini-visible-white-96';
      addCandidate(candidates, registry, imageWidth, imageHeight, {
        templateId,
        logoSize,
        marginRight: Math.max(8, Math.round(base.marginRight * item.sx)),
        marginBottom: Math.max(8, Math.round(base.marginBottom * item.sy))
      }, `${this.id}:scaled`, 0.58);
    }

    return dedupe(candidates);
  }
}

export class GeminiCornerSearchPrior implements LayoutPrior {
  readonly id = 'gemini-corner-local-search';

  constructor(readonly padding = 12, readonly step = 4) {}

  generateCandidates(imageWidth: number, imageHeight: number, registry: WatermarkTemplateRegistry): Candidate[] {
    const anchors = new GeminiOfficialLayoutPrior().generateCandidates(imageWidth, imageHeight, registry);
    const candidates: Candidate[] = [];
    for (const anchor of anchors) {
      for (let dy = -this.padding; dy <= this.padding; dy += this.step) {
        for (let dx = -this.padding; dx <= this.padding; dx += this.step) {
          const x = anchor.x + dx;
          const y = anchor.y + dy;
          if (x < 0 || y < 0 || x + anchor.width > imageWidth || y + anchor.height > imageHeight) continue;
          candidates.push({ ...anchor, x, y, priorId: this.id, priorScore: (anchor.priorScore ?? 0.5) * (dx === 0 && dy === 0 ? 1 : 0.82) });
        }
      }
    }
    return dedupe(candidates);
  }
}

export function createDefaultLayoutPriors(mode: 'safe' | 'aggressive' = 'safe'): LayoutPrior[] {
  if (mode === 'safe') {
    return [new GeminiOfficialLayoutPrior()];
  }

  return [
    new GeminiOfficialLayoutPrior(),
    new GeminiCornerSearchPrior(20, 4)
  ];
}
