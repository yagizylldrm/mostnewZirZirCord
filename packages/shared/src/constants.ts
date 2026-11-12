export const APP_NAME = 'ZirZirCord';

/** Join codes: 8 chars of Crockford base32 (no I, L, O, U) shown as XXXX-XXXX. */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 8;

/** Public user ids look like ZZ-7F3K9Q. */
export const PUBLIC_ID_PREFIX = 'ZZ-';
export const PUBLIC_ID_LENGTH = 6;

export const LIMITS = {
  displayName: 32,
  sessionName: 48,
  channelName: 32,
  message: 4000,
  bio: 300,
  nickname: 32,
  attachmentsPerMessage: 10,
  voiceMessageMaxSeconds: 300,
  messagePageSize: 50,
} as const;

export const STATUSES = ['ONLINE', 'IDLE', 'DND', 'INVISIBLE'] as const;
export type UserStatus = (typeof STATUSES)[number];

export const ROLES = ['OWNER', 'MOD', 'MEMBER'] as const;
export type Role = (typeof ROLES)[number];

export const CHANNEL_TYPES = ['TEXT', 'VOICE'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const SESSION_STATES = ['ACTIVE', 'DORMANT'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const ATTACHMENT_KINDS = ['IMAGE', 'VIDEO', 'AUDIO', 'FILE', 'VOICE_MESSAGE', 'STICKER'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const NOTIFY_LEVELS = ['ALL', 'MENTIONS', 'NONE'] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];

/** Images accepted for avatars, banners and stickers. */
export const PROFILE_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const PROFILE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_STICKERS_PER_USER = 200;

/** Audio quality presets for voice channels (Opus bitrates, bits/s). */
export const AUDIO_PRESETS = {
  VOICE: { label: 'Voice (64 kbps)', maxBitrate: 64_000, stereo: false, music: false },
  HIGH: { label: 'High (96 kbps)', maxBitrate: 96_000, stereo: false, music: false },
  MUSIC: { label: 'Music (128 kbps stereo)', maxBitrate: 128_000, stereo: true, music: true },
} as const;
export type AudioPreset = keyof typeof AUDIO_PRESETS;

/** Screen-share presets. */
export const SCREEN_PRESETS = {
  P720_30: { label: '720p 30fps', width: 1280, height: 720, fps: 30, maxBitrate: 2_000_000 },
  P1080_30: { label: '1080p 30fps', width: 1920, height: 1080, fps: 30, maxBitrate: 4_000_000 },
  P1080_60: { label: '1080p 60fps', width: 1920, height: 1080, fps: 60, maxBitrate: 6_000_000 },
  P1440_60: { label: '1440p 60fps', width: 2560, height: 1440, fps: 60, maxBitrate: 9_000_000 },
  P2160_30: { label: '4K 30fps', width: 3840, height: 2160, fps: 30, maxBitrate: 12_000_000 },
} as const;
export type ScreenPreset = keyof typeof SCREEN_PRESETS;
