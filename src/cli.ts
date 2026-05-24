#!/usr/bin/env node
import { rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { readImage, writeImage } from './nodeImage.js';
import { createBenchmarkFixtures, runBenchmark } from './benchmark.js';
import { removeWatermark } from './index.js';
import type { WatermarkMode, WatermarkPresetName } from './types.js';

interface RemoveCommandOptions {
  command: 'remove';
  input: string;
  output?: string;
  preset: WatermarkPresetName;
  mode: WatermarkMode;
  json: boolean;
}

interface BenchmarkCommandOptions {
  command: 'benchmark';
  mode: WatermarkMode;
  json: boolean;
}

type CommandOptions = RemoveCommandOptions | BenchmarkCommandOptions;

function usageText(): string {
  return [
    'Usage: watermark-kit <command> [options]',
    '',
    'Commands:',
    '  remove <input.png> -o <output.png> [--preset gemini] [--mode safe|aggressive] [--json]',
    '  benchmark --json [--mode safe|aggressive]',
    '',
    'Options:',
    '  -h, --help     Show this help message',
    '  --json         Emit JSON only',
    '  --mode         safe or aggressive',
    '  --preset       gemini (remove only)'
  ].join('\n');
}

function printUsage(stream: NodeJS.WritableStream = process.stderr): void {
  stream.write(`${usageText()}\n`);
}

function parseMode(value: string | undefined): WatermarkMode {
  if (value !== 'safe' && value !== 'aggressive') throw new Error(`unsupported mode: ${value ?? ''}`);
  return value;
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

function parseArgs(args: string[]): CommandOptions | 'help' {
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') return 'help';
  const [command, ...rest] = args;
  if (command === 'remove') return parseRemoveArgs(args);
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

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options === 'help') {
    printUsage(process.stdout);
    return;
  }

  if (options.command === 'benchmark') {
    const summary = runBenchmark(createBenchmarkFixtures(), { mode: options.mode });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(summary)}\n`);
    } else {
      process.stdout.write(`benchmark ${summary.mode}: recall=${summary.detectionRecall} falsePositiveRate=${summary.falsePositiveRate}\n`);
    }
    return;
  }

  const input = await readImage(options.input);
  const result = removeWatermark(input, { preset: options.preset, mode: options.mode });
  await writeImageAtomically(options.output!, result.image);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result.meta)}\n`);
  } else {
    const status = result.applied ? 'applied' : `skipped: ${result.meta.skipReason ?? 'unknown'}`;
    process.stdout.write(`watermark removal ${status}\n`);
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'help requested') {
    printUsage(process.stdout);
    return;
  }
  printUsage();
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
