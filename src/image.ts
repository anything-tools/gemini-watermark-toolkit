import type { NormalizedImage, PixelImage } from './types.js';

export function normalizeImage(image: PixelImage): NormalizedImage {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height)) {
    throw new TypeError('image.width and image.height must be integers');
  }

  if (image.width <= 0 || image.height <= 0) {
    throw new RangeError('image.width and image.height must be positive');
  }

  const expectedLength = image.width * image.height * 4;
  if (image.data.length !== expectedLength) {
    throw new RangeError(`image.data must contain ${expectedLength} RGBA values`);
  }

  return {
    width: image.width,
    height: image.height,
    data: image.data instanceof Uint8ClampedArray
      ? new Uint8ClampedArray(image.data)
      : Uint8ClampedArray.from(image.data)
  };
}

export function cloneImage(image: NormalizedImage): NormalizedImage {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data)
  };
}

export function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

export function luminance(data: ArrayLike<number>, offset: number): number {
  return 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
}

export function clampByte(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}
