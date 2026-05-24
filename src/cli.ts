#!/usr/bin/env node
import { resolve } from 'node:path';
import { readImage, writeImage } from './nodeImage.js';
import { removeWatermark } from './index.js';
import type { WatermarkMode, WatermarkPresetName } from './types.js';

interface RemoveCommandOptions {
  input: string;
  output?: string;
  preset: WatermarkPresetName;
  mode: WatermarkMode;
  json: boolean;
}

function printUsage(): void {
  console.error('Usage: watermark-kit remove <input.png> -o <output.png> [--preset gemini] [--mode safe|aggressive] [--json]');
}

function parseRemoveArgs(args: string[]): RemoveCommandOptions {
  if (args[0] !== 'remove') {
    throw new Error('expected command: remove');
  }

  const options: RemoveCommandOptions = {
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
    } else if (arg === '--mode') {
      const value = args[index + 1];
      if (value !== 'safe' && value !== 'aggressive') throw new Error(`unsupported mode: ${value ?? ''}`);
      options.mode = value;
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (!options.input) {
      options.input = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  if (!options.input) throw new Error('missing input path');
  if (!options.output) throw new Error('missing output path');
  if (resolve(options.input) === resolve(options.output)) {
    throw new Error('input and output paths must be different');
  }
  return options;
}

async function run(): Promise<void> {
  const options = parseRemoveArgs(process.argv.slice(2));
  const input = await readImage(options.input);
  const result = removeWatermark(input, { preset: options.preset, mode: options.mode });
  await writeImage(options.output!, result.image);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result.meta)}\n`);
  } else {
    const status = result.applied ? 'applied' : `skipped: ${result.meta.skipReason ?? 'unknown'}`;
    process.stdout.write(`watermark removal ${status}\n`);
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  printUsage();
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
