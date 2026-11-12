import sharp from 'sharp';

export type MediaKind = 'avatar' | 'banner' | 'sticker';

export interface ProcessedImage {
  /** Final image (animated WebP when the source was animated). */
  main: Buffer;
  /** First frame as a still WebP — only produced for animated sources. */
  still: Buffer | null;
  animated: boolean;
  width: number;
  height: number;
}

const TARGET: Record<MediaKind, { width: number; height: number; fit: 'cover' | 'inside' }> = {
  avatar: { width: 256, height: 256, fit: 'cover' },
  banner: { width: 960, height: 384, fit: 'cover' },
  sticker: { width: 512, height: 512, fit: 'inside' },
};

/**
 * Normalises a user-uploaded image: resizes it, converts to WebP and keeps
 * animation (GIF / animated WebP) — plus a still first frame for places that
 * should not animate all the time.
 */
export async function processImage(input: Buffer, kind: MediaKind): Promise<ProcessedImage> {
  const meta = await sharp(input, { animated: true }).metadata();
  const animated = (meta.pages ?? 1) > 1;
  const t = TARGET[kind];
  const resize = { width: t.width, height: t.height, fit: t.fit, withoutEnlargement: kind === 'sticker' } as const;

  const main = await sharp(input, { animated, limitInputPixels: 80_000_000 })
    .rotate()
    .resize(resize)
    .webp({ quality: animated ? 75 : 85, effort: 4, loop: 0 })
    .toBuffer({ resolveWithObject: true });

  const still = animated
    ? await sharp(input, { animated: false, pages: 1 }).rotate().resize(resize).webp({ quality: 85 }).toBuffer()
    : null;

  // For animated output sharp reports the full sprite height; use pageHeight when present.
  const height = main.info.pageHeight ?? main.info.height;
  return { main: main.data, still, animated, width: main.info.width, height };
}
