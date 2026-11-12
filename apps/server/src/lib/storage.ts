import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../env';

const base = {
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED' as const,
  responseChecksumValidation: 'WHEN_REQUIRED' as const,
};

/** Talks to storage from the server. */
const s3 = new S3Client({ ...base, endpoint: env.S3_ENDPOINT });
/** Only used to sign URLs that clients will open (may be a different host). */
const signer = new S3Client({ ...base, endpoint: env.S3_PUBLIC_ENDPOINT });
const Bucket = env.S3_BUCKET;

/** Creates the bucket on first start. Never fatal: hosted providers may require creating it in their dashboard. */
export async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
    return;
  } catch {}
  try {
    await s3.send(new CreateBucketCommand({ Bucket }));
  } catch (e) {
    console.warn(`[storage] bucket "${Bucket}" is missing and could not be created: ${(e as Error).message}`);
  }
}

export function presignPut(key: string, mime: string, size: number) {
  return getSignedUrl(signer, new PutObjectCommand({ Bucket, Key: key, ContentType: mime, ContentLength: size }), {
    expiresIn: 15 * 60,
  });
}

/** MIME types that are safe to render inline (never HTML/SVG/XML/script). */
const INLINE_SAFE = /^(image\/(png|jpeg|webp|gif|avif|bmp)|video\/(mp4|webm|quicktime|ogg)|audio\/(mpeg|mp3|ogg|webm|wav|x-wav|mp4|aac|x-m4a|flac|opus))$/i;

/** Anything outside the safe set is stored as an opaque download so it can never run as a page. */
export function safeMime(mime: string) {
  const base = mime.split(';')[0].trim().toLowerCase();
  return INLINE_SAFE.test(base) ? base : 'application/octet-stream';
}

export function presignGet(key: string, opts: { filename?: string; mime?: string } = {}) {
  const mime = safeMime(opts.mime ?? 'image/webp');
  const inline = mime !== 'application/octet-stream';
  const disposition = opts.filename
    ? `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(opts.filename)}`
    : inline
      ? undefined
      : 'attachment';
  return getSignedUrl(
    signer,
    new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: disposition, ResponseContentType: mime }),
    // Short-lived: access can't be revoked, so keep the window small (clients refetch messages).
    { expiresIn: 60 * 60 },
  );
}

export async function headObject(key: string) {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
    return { size: r.ContentLength ?? 0, mime: r.ContentType ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

export async function putObject(key: string, body: Buffer, mime: string) {
  await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: mime }));
}

/** Server-side copy (one request); falls back to download + upload if the provider lacks CopyObject. Returns the size. */
export async function copyObject(from: string, to: string): Promise<number> {
  try {
    await s3.send(new CopyObjectCommand({ Bucket, Key: to, CopySource: `${Bucket}/${encodeURI(from)}` }));
    return (await headObject(to))?.size ?? 0;
  } catch {
    const buf = await getObjectBuffer(from);
    await putObject(to, buf, 'image/webp');
    return buf.length;
  }
}

export async function deleteKeys(keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    if (!chunk.length) continue;
    await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
  }
}

export async function deletePrefix(prefix: string) {
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
    await deleteKeys((r.Contents ?? []).map((o) => o.Key!).filter(Boolean));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
}

export async function listKeys(prefix: string): Promise<string[]> {
  const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix }));
  return (r.Contents ?? []).map((o) => o.Key!);
}
