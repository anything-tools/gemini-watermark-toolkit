import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { defaultRegistry, type NormalizedImage, type WatermarkTemplate } from '../src/index.js';
import { writePngImage } from '../src/nodeImage.js';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

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

function overlayTemplate(image: NormalizedImage, template: WatermarkTemplate, x: number, y: number): NormalizedImage {
  const output = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  for (let ty = 0; ty < template.height; ty += 1) {
    for (let tx = 0; tx < template.width; tx += 1) {
      const alpha = Math.min(0.9, template.alpha[ty * template.width + tx]);
      if (alpha <= 0.002) continue;
      const offset = ((y + ty) * output.width + x + tx) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[offset + channel] = Math.round(output.data[offset + channel] * (1 - alpha) + template.color[channel] * alpha);
      }
    }
  }
  return output;
}

async function expectMissing(path: string): Promise<void> {
  await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
}

async function expectNoTemporaryOutputs(dir: string): Promise<void> {
  const entries = await readdir(dir);
  expect(entries.filter((entry) => entry.includes('watermark-kit.tmp'))).toEqual([]);
}

describe('CLI polish', () => {
  it('prints help successfully for the built CLI', async () => {
    const { stdout, stderr } = await execFileAsync('node', ['dist/cli.js', '--help'], {
      cwd: repoRoot,
      timeout: 30_000
    });

    expect(stderr).toBe('');
    expect(stdout).toContain('Usage: watermark-kit');
    expect(stdout).toContain('remove <input.png> -o <output.png>');
    expect(stdout).toContain('benchmark --json');
  });

  it('runs synthetic benchmarks as JSON from the CLI', async () => {
    const { stdout, stderr } = await execFileAsync('npx', ['tsx', cliPath, 'benchmark', '--mode', 'safe', '--json'], {
      cwd: repoRoot,
      timeout: 60_000
    });
    const summary = JSON.parse(stdout);

    expect(stderr).toBe('');
    expect(summary).toMatchObject({
      mode: 'safe',
      fixtureCount: 3,
      positiveCount: 2,
      negativeCount: 1,
      falsePositiveRate: 0
    });
    expect(summary.results).toHaveLength(3);
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  it('writes remove outputs atomically and cleans temporary files on failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'watermark-kit-atomic-'));
    try {
      const input = join(dir, 'watermarked.png');
      const output = join(dir, 'restored.png');
      const invalidOutput = join(dir, 'restored.jpg');
      const clean = makeBaseImage(1024, 1024);
      const template = defaultRegistry.get('gemini-visible-white-96')!;
      const watermarked = overlayTemplate(clean, template, 864, 864);
      await writePngImage(input, watermarked);

      await expect(execFileAsync('npx', ['tsx', cliPath, 'remove', input, '-o', invalidOutput], {
        cwd: repoRoot,
        timeout: 30_000
      })).rejects.toMatchObject({ code: 1 });
      await expectMissing(invalidOutput);
      await expectNoTemporaryOutputs(dir);

      await execFileAsync('npx', ['tsx', cliPath, 'remove', input, '-o', output, '--json'], {
        cwd: repoRoot,
        timeout: 30_000
      });
      const written = await readFile(output);
      expect(written.length).toBeGreaterThan(0);
      await expectNoTemporaryOutputs(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
