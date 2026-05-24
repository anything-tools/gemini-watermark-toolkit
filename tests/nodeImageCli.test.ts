import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { defaultRegistry, type NormalizedImage, type WatermarkTemplate } from '../src/index.js';
import { readPngImage, writePngImage } from '../src/nodeImage.js';

const execFileAsync = promisify(execFile);
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

describe('Node PNG image adapter and CLI', () => {
  it('round-trips RGBA PNG files while preserving alpha', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'watermark-kit-png-'));
    try {
      const input = join(dir, 'input.png');
      const output = join(dir, 'output.png');
      const image: NormalizedImage = {
        width: 2,
        height: 1,
        data: new Uint8ClampedArray([10, 20, 30, 40, 200, 210, 220, 230])
      };

      await writePngImage(input, image);
      const decoded = await readPngImage(input);
      await writePngImage(output, decoded);
      const decodedAgain = await readPngImage(output);

      expect(decoded).toEqual(image);
      expect(decodedAgain).toEqual(image);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('removes a synthetic visible watermark from a PNG file and emits JSON diagnostics only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'watermark-kit-cli-'));
    try {
      const input = join(dir, 'watermarked.png');
      const output = join(dir, 'restored.png');
      const clean = makeBaseImage(1024, 1024);
      const template = defaultRegistry.get('gemini-visible-white-96')!;
      const x = 1024 - 64 - 96;
      const y = 1024 - 64 - 96;
      const watermarked = overlayTemplate(clean, template, x, y);
      await writePngImage(input, watermarked);

      const { stdout, stderr } = await execFileAsync('npx', ['tsx', cliPath, 'remove', input, '-o', output, '--mode', 'safe', '--json'], {
        cwd: join(fileURLToPath(new URL('..', import.meta.url))),
        timeout: 30_000
      });
      const diagnostics = JSON.parse(stdout);
      const restored = await readPngImage(output);
      const written = await readFile(output);
      const parsedPng = PNG.sync.read(written);

      expect(stderr).toBe('');
      expect(diagnostics).toMatchObject({ applied: true, templateId: template.id, x, y });
      expect(parsedPng.width).toBe(clean.width);
      expect(parsedPng.height).toBe(clean.height);
      expect(restored.width).toBe(clean.width);
      expect(restored.height).toBe(clean.height);
      expect(restored.data).not.toEqual(watermarked.data);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
