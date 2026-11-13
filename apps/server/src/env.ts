import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  /** Number of trusted proxy hops ('1' = one proxy such as Caddy or cloudflared). 'true' trusts every hop (spoofable X-Forwarded-For), 'false' trusts none. */
  TRUST_PROXY: z.string().default('1'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  PRESENCE_GRACE_SECONDS: z.coerce.number().min(0).default(30),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(100),
  /** Bytes a user may upload per rolling 24 h (abuse guard). */
  UPLOAD_QUOTA_MB_GUEST: z.coerce.number().positive().default(300),
  UPLOAD_QUOTA_MB_USER: z.coerce.number().positive().default(2000),
  /** Guest accounts are deleted after being offline this long. */
  GUEST_TTL_HOURS: z.coerce.number().positive().default(24),
  /** Set sessions with no activity for this long go to sleep… */
  SESSION_SLEEP_DAYS: z.coerce.number().positive().default(5),
  /** …and are deleted after sleeping this long. */
  SESSION_DELETE_AFTER_SLEEP_DAYS: z.coerce.number().positive().default(30),
  /**
   * 'enforce': requests must come from an allowed web origin or carry the official app header.
   * 'log': only log offenders (lets old phone/desktop builds work during a rollout).
   */
  CLIENT_CHECK: z.enum(['enforce', 'log']).default('enforce'),
  S3_ENDPOINT: z.string().url(),
  S3_PUBLIC_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  LIVEKIT_URL: z.string(),
  LIVEKIT_API_KEY: z.string(),
  LIVEKIT_API_SECRET: z.string(),
});

// On Railway, default the public URL to the service's generated domain.
const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
export const env = schema.parse({
  ...process.env,
  PUBLIC_API_URL: process.env.PUBLIC_API_URL || (railwayDomain ? `https://${railwayDomain}` : undefined),
});
export type Env = typeof env;
