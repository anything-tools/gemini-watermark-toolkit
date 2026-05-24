export type WatermarkPresetName = 'gemini';
export type WatermarkMode = 'safe' | 'aggressive';
export type BlendMode = 'normal-alpha';

export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array | number[];
}

export interface NormalizedImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface WatermarkTemplate {
  id: string;
  width: number;
  height: number;
  alpha: Float32Array;
  color: [number, number, number];
  blendMode: BlendMode;
  version: string;
  source?: string;
  provider?: string;
  calibratedAt?: string;
  notes?: string;
}

export interface SerializedWatermarkTemplate {
  id: string;
  width: number;
  height: number;
  alpha: number[];
  color: [number, number, number];
  blendMode: BlendMode;
  version: string;
  source?: string;
  provider?: string;
  calibratedAt?: string;
  notes?: string;
}

export interface TemplateCalibrationRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TemplateCalibrationOptions {
  id: string;
  version: string;
  region: TemplateCalibrationRegion;
  color?: [number, number, number];
  provider?: string;
  source?: string;
  calibratedAt?: string;
  notes?: string;
}

export interface WatermarkTemplateRegistry {
  register(template: WatermarkTemplate): void;
  get(id: string): WatermarkTemplate | undefined;
  list(): WatermarkTemplate[];
  findBySize(width: number, height: number): WatermarkTemplate[];
}

export interface Candidate {
  templateId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  spatialScore: number;
  gradientScore: number;
  confidence: number;
  priorId?: string;
  priorScore?: number;
}

export interface LayoutPrior {
  id: string;
  generateCandidates(imageWidth: number, imageHeight: number, registry: WatermarkTemplateRegistry): Candidate[];
}

export interface DetectOptions {
  preset?: WatermarkPresetName;
  mode?: WatermarkMode;
  maxCandidates?: number;
  threshold?: number;
  includeExhaustiveScan?: boolean;
  searchPadding?: number;
  priors?: LayoutPrior[];
  registry?: WatermarkTemplateRegistry;
}

export interface ValidateOptions {
  preset?: WatermarkPresetName;
  mode?: WatermarkMode;
  threshold?: number;
  registry?: WatermarkTemplateRegistry;
}

export interface RestoreOptions {
  preset?: WatermarkPresetName;
  mode?: WatermarkMode;
  alphaGain?: number;
  registry?: WatermarkTemplateRegistry;
}

export interface RemoveWatermarkOptions {
  preset?: WatermarkPresetName;
  mode?: WatermarkMode;
  detect?: Omit<DetectOptions, 'preset' | 'mode'>;
  validate?: Omit<ValidateOptions, 'preset' | 'mode'>;
  restore?: Omit<RestoreOptions, 'preset' | 'mode'>;
}

export interface ValidatedCandidate extends Candidate {
  accepted: boolean;
  residualBefore: number;
  residualAfter: number;
  residualReduction: number;
  artifactScore: number;
  nearBlackIncrease: number;
  texturePenalty: number;
}

export interface ValidationResult {
  candidates: ValidatedCandidate[];
  best?: ValidatedCandidate;
}

export interface RestoreResult {
  image: NormalizedImage;
  changed: boolean;
  candidate?: ValidatedCandidate | Candidate;
}

export interface RemoveWatermarkMeta {
  applied: boolean;
  templateId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  confidence?: number;
  residualBefore?: number;
  residualAfter?: number;
  residualReduction?: number;
  artifactScore?: number;
  warnings: string[];
  skipReason?: string;
}

export interface RemoveWatermarkResult extends RestoreResult {
  applied: boolean;
  candidates: Candidate[];
  validation: ValidationResult;
  meta: RemoveWatermarkMeta;
}

export type WatermarkCandidate = Candidate;
