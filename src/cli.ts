#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readImage, writeImage } from './nodeImage.js';
import { createBenchmarkFixtures, runBenchmark } from './benchmark.js';
import { calibrateTemplateFromPair, deserializeTemplate, serializeTemplate } from './calibration.js';
import { removeWatermark, TemplateRegistry } from './index.js';
import type { Candidate, LayoutPrior, SerializedWatermarkTemplate, TemplateCalibrationRegion, WatermarkMode, WatermarkPresetName, WatermarkTemplateRegistry } from './types.js';

interface RemoveCommandOptions {
  command: 'remove';
  input: string;
  output?: string;
  preset: WatermarkPresetName;
  mode: WatermarkMode;
  json: boolean;
  templatePath?: string;
}

interface BenchmarkCommandOptions {
  command: 'benchmark';
  mode: WatermarkMode;
  json: boolean;
}

interface CalibrateCommandOptions {
  command: 'calibrate';
  cleanInput: string;
  watermarkedInput: string;
  output?: string;
  region?: TemplateCalibrationRegion;
  id: string;
  version: string;
  json: boolean;
}

type CommandOptions = RemoveCommandOptions | BenchmarkCommandOptions | CalibrateCommandOptions;

interface CliStreams {
  stdout: Pick<NodeJS.WritableStream, 'write'>;
  stderr: Pick<NodeJS.WritableStream, 'write'>;
}

function usageText(): string {
  return [
    'Usage: watermark-kit <command> [options]',
    '',
    'Commands:',
    '  remove <input.png> -o <output.png> [--template template.json] [--preset gemini] [--mode safe|aggressive] [--json]',
    '  calibrate <clean.png> <watermarked.png> --region x,y,w,h --id id --version version -o <template.json> [--json]',
    '  benchmark --json [--mode safe|aggressive]',
    '',
    'Options:',
    '  -h, --help     Show this help message',
    '  --json         Emit JSON only',
    '  --mode         safe or aggressive',
    '  --preset       gemini (remove only)',
    '  --template     external serialized template JSON (remove only)',
    '  --region       x,y,width,height calibration region (calibrate only)',
    '  --id           template id (calibrate only)',
    '  --version      template version (calibrate only)'
  ].join('\n');
}

function printUsage(stream: NodeJS.WritableStream = process.stderr): void {
  stream.write(`${usageText()}\n`);
}

function parseMode(value: string | undefined): WatermarkMode {
  if (value !== 'safe' && value !== 'aggressive') throw new Error(`unsupported mode: ${value ?? ''}`);
  return value;
}

function parseRegion(value: string | undefined): TemplateCalibrationRegion {
  if (!value) throw new Error('missing region after --region');
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    throw new Error('region must be four comma-separated integers: x,y,width,height');
  }
  const [x, y, width, height] = parts;
  return { x, y, width, height };
}

function parseRemoveArgs(args: string[]): RemoveCommandOptions {
  const options: RemoveCommandOptions = {
    command: 'remove',
    input: '',
    preset: 'gemini',
    mode: 'safe',
    json: false
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-o' || arg === '--output') {
      const value = args[index + 1];
      if (!value) throw new Error('missing output path after -o/--output');
      options.output = value;
      index += 1;
    } else if (arg === '--preset') {
      const value = args[index + 1];
      if (value !== 'gemini') throw new Error(`unsupported preset: ${value ?? ''}`);
      options.preset = value;
      index += 1;
    } else if (arg === '--template') {
      const value = args[index + 1];
      if (!value) throw new Error('missing template path after --template');
      options.templatePath = value;
      index += 1;
    } else if (arg === '--mode') {
      const value = args[index + 1];
      options.mode = parseMode(value);
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '-h' || arg === '--help') {
      throw new Error('help requested');
    } else if (!options.input) {
      options.input = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  if (!options.input) throw new Error('missing input path');
  if (!options.output) throw new Error('missing output path');
  if (!options.input.toLowerCase().endsWith('.png')) throw new Error('only PNG input is supported');
  if (!options.output.toLowerCase().endsWith('.png')) throw new Error('only PNG output is supported');
  if (resolve(options.input) === resolve(options.output)) {
    throw new Error('input and output paths must be different');
  }
  return options;
}

function parseBenchmarkArgs(args: string[]): BenchmarkCommandOptions {
  const options: BenchmarkCommandOptions = { command: 'benchmark', mode: 'safe', json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--mode') {
      options.mode = parseMode(args[index + 1]);
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '-h' || arg === '--help') {
      throw new Error('help requested');
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return options;
}

function parseCalibrateArgs(args: string[]): CalibrateCommandOptions {
  const options: CalibrateCommandOptions = { command: 'calibrate', cleanInput: '', watermarkedInput: '', id: '', version: '', json: false };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-o' || arg === '--output') {
      const value = args[index + 1];
      if (!value) throw new Error('missing output path after -o/--output');
      options.output = value;
      index += 1;
    } else if (arg === '--region') {
      options.region = parseRegion(args[index + 1]);
      index += 1;
    } else if (arg === '--id') {
      const value = args[index + 1];
      if (!value) throw new Error('missing template id after --id');
      options.id = value;
      index += 1;
    } else if (arg === '--version') {
      const value = args[index + 1];
      if (!value) throw new Error('missing template version after --version');
      options.version = value;
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '-h' || arg === '--help') {
      throw new Error('help requested');
    } else if (!options.cleanInput) {
      options.cleanInput = arg;
    } else if (!options.watermarkedInput) {
      options.watermarkedInput = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  if (!options.cleanInput) throw new Error('missing clean input path');
  if (!options.watermarkedInput) throw new Error('missing watermarked input path');
  if (!options.output) throw new Error('missing output path');
  if (!options.region) throw new Error('missing calibration region');
  if (!options.id) throw new Error('missing template id');
  if (!options.version) throw new Error('missing template version');
  if (!options.cleanInput.toLowerCase().endsWith('.png')) throw new Error('only PNG clean input is supported');
  if (!options.watermarkedInput.toLowerCase().endsWith('.png')) throw new Error('only PNG watermarked input is supported');
  if (!options.output.toLowerCase().endsWith('.json')) throw new Error('only JSON template output is supported');
  return options;
}

function parseArgs(args: string[]): CommandOptions | 'help' {
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') return 'help';
  const [command, ...rest] = args;
  if (command === 'remove') return parseRemoveArgs(args);
  if (command === 'calibrate') return parseCalibrateArgs(args);
  if (command === 'benchmark') return parseBenchmarkArgs(rest);
  throw new Error(`unknown command: ${command}`);
}

async function writeImageAtomically(output: string, image: Parameters<typeof writeImage>[1]): Promise<void> {
  const temporaryOutput = join(dirname(output), `.${process.pid}-${randomUUID()}.watermark-kit.tmp.png`);
  try {
    await writeImage(temporaryOutput, image);
    await rename(temporaryOutput, output);
  } catch (error) {
    await rm(temporaryOutput, { force: true });
    throw error;
  }
}

async function writeTextAtomically(output: string, text: string): Promise<void> {
  const temporaryOutput = join(dirname(output), `.${process.pid}-${randomUUID()}.watermark-kit.tmp.json`);
  try {
    await writeFile(temporaryOutput, text);
    await rename(temporaryOutput, output);
  } catch (error) {
    await rm(temporaryOutput, { force: true });
    throw error;
  }
}

class RegistryBottomRightPrior implements LayoutPrior {
  readonly id = 'external-template-bottom-right';

  generateCandidates(imageWidth: number, imageHeight: number, registry: WatermarkTemplateRegistry): Candidate[] {
    const candidates: Candidate[] = [];
    for (const template of registry.list()) {
      const margin = template.width === 56 ? 38 : template.width <= 64 ? 32 : 64;
      const x = imageWidth - margin - template.width;
      const y = imageHeight - margin - template.height;
      if (x < 0 || y < 0) continue;
      candidates.push({
        templateId: template.id,
        x,
        y,
        width: template.width,
        height: template.height,
        spatialScore: 0,
        gradientScore: 0,
        confidence: 0,
        priorId: this.id,
        priorScore: 1
      });
    }
    return candidates;
  }
}

async function readTemplateRegistry(templatePath: string | undefined): Promise<TemplateRegistry | undefined> {
  if (!templatePath) return undefined;
  const parsed = JSON.parse(await readFile(templatePath, 'utf8')) as SerializedWatermarkTemplate;
  return new TemplateRegistry([deserializeTemplate(parsed)]);
}

export async function runCli(args = process.argv.slice(2), streams: CliStreams = process): Promise<number> {
  try {
    const options = parseArgs(args);
    if (options === 'help') {
      printUsage(streams.stdout as NodeJS.WritableStream);
      return 0;
    }

    if (options.command === 'benchmark') {
      const summary = runBenchmark(createBenchmarkFixtures(), { mode: options.mode });
      if (options.json) {
        streams.stdout.write(`${JSON.stringify(summary)}\n`);
      } else {
        streams.stdout.write(`benchmark ${summary.mode}: recall=${summary.detectionRecall} falsePositiveRate=${summary.falsePositiveRate}\n`);
      }
      return 0;
    }

    if (options.command === 'calibrate') {
      const clean = await readImage(options.cleanInput);
      const watermarked = await readImage(options.watermarkedInput);
      const template = calibrateTemplateFromPair(clean, watermarked, {
        id: options.id,
        version: options.version,
        region: options.region!
      });
      const serialized = serializeTemplate(template);
      await writeTextAtomically(options.output!, `${JSON.stringify(serialized, null, 2)}\n`);
      if (options.json) {
        streams.stdout.write(`${JSON.stringify({ id: serialized.id, width: serialized.width, height: serialized.height, output: options.output })}\n`);
      } else {
        streams.stdout.write(`calibrated template ${serialized.id} ${serialized.width}x${serialized.height}\n`);
      }
      return 0;
    }

    const registry = await readTemplateRegistry(options.templatePath);
    const input = await readImage(options.input);
    const result = removeWatermark(input, {
      preset: options.preset,
      mode: options.mode,
      detect: registry ? { registry, priors: [new RegistryBottomRightPrior()] } : undefined,
      validate: registry ? { registry } : undefined,
      restore: registry ? { registry } : undefined
    });
    await writeImageAtomically(options.output!, result.image);

    if (options.json) {
      streams.stdout.write(`${JSON.stringify(result.meta)}\n`);
    } else {
      const status = result.applied ? 'applied' : `skipped: ${result.meta.skipReason ?? 'unknown'}`;
      streams.stdout.write(`watermark removal ${status}\n`);
    }
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'help requested') {
      printUsage(streams.stdout as NodeJS.WritableStream);
      return 0;
    }
    printUsage(streams.stderr as NodeJS.WritableStream);
    streams.stderr.write(`Error: ${message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
