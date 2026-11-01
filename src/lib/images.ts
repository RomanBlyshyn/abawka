// Підготовка фото в браузері перед завантаженням: поворот за EXIF, три розміри, стиснення.
// Так навіть 10-мегабайтне фото з телефона вантажиться за секунди, а сайт отримує легкі файли.
export const SIZES = [400, 800, 1600] as const;
export type Size = (typeof SIZES)[number];
export const MAX_INPUT_BYTES = 30 * 1024 * 1024;

export class ImageError extends Error {
  constructor(public reason: 'too-big' | 'unsupported') { super(reason); }
}

async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', 0.82));
  if (webp?.type === 'image/webp') return webp;
  // Safari не вміє кодувати WebP і мовчки віддає PNG — тоді беремо JPEG (браузер покаже його за content-type).
  const jpeg = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
  if (!jpeg) throw new ImageError('unsupported');
  return jpeg;
}

/** Три зменшені версії: довша сторона ≤ 400 / 800 / 1600 px, без збільшення маленьких фото. */
export async function makeVariants(file: File): Promise<Record<Size, Blob>> {
  if (file.size > MAX_INPUT_BYTES) throw new ImageError('too-big');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageError('unsupported'); // напр. HEIC з iPhone у Chrome
  }
  const out = {} as Record<Size, Blob>;
  for (const size of SIZES) {
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    out[size] = await encode(canvas);
  }
  bitmap.close();
  return out;
}
