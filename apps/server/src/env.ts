import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  PRESENCE_GRACE_SECONDS: z.coerce.number().min(0).default(30),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(100),
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
