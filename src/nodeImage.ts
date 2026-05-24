import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { PNG } from 'pngjs';
import { normalizeImage } from './image.js';
import type { NormalizedImage, PixelImage } from './types.js';

function assertPngPath(path: string): void {
  if (extname(path).toLowerCase() !== '.png') {
    throw new RangeError('only PNG files are currently supported by the Node image adapter');
  }
}

export async function readPngImage(path: string): Promise<NormalizedImage> {
  assertPngPath(path);
  const buffer = await readFile(path);
  const png = PNG.sync.read(buffer);
  return normalizeImage({
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data)
  });
}

export async function writePngImage(path: string, image: PixelImage): Promise<void> {
  assertPngPath(path);
  const normalized = normalizeImage(image);
  const png = new PNG({ width: normalized.width, height: normalized.height });
  png.data = Buffer.from(normalized.data);
  await writeFile(path, PNG.sync.write(png));
}

export async function readImage(path: string): Promise<NormalizedImage> {
  return readPngImage(path);
}

export async function writeImage(path: string, image: PixelImage): Promise<void> {
  await writePngImage(path, image);
}
