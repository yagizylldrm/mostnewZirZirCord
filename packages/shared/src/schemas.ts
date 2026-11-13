import { z } from 'zod';
import { ATTACHMENT_KINDS, AUDIO_PRESETS, LIMITS, NOTIFY_LEVELS, PROFILE_IMAGE_MAX_BYTES, PROFILE_IMAGE_MIMES, STATUSES, TIMEOUT_MINUTES } from './constants';

const name = (max: number) => z.string().trim().min(1).max(max);

export const deviceIdSchema = z.string().min(8).max(128);

export const guestAuthSchema = z.object({
  displayName: name(LIMITS.displayName),
  deviceId: deviceIdSchema,
});

export const registerSchema = z.object({
  displayName: name(LIMITS.displayName),
  email: z.email().max(254),
  password: z.string().min(8).max(200),
  deviceId: deviceIdSchema,
});

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
  deviceId: deviceIdSchema,
});

export const upgradeSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(200),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
  deviceId: deviceIdSchema,
});

export const updateProfileSchema = z.object({
  displayName: name(LIMITS.displayName).optional(),
  bio: z.string().max(LIMITS.bio).optional(),
  bannerColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  status: z.enum(STATUSES).optional(),
  avatarUploadId: z.string().uuid().nullable().optional(),
  bannerUploadId: z.string().uuid().nullable().optional(),
});

/** Registered accounts confirm with their password; guests send nothing. */
export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(200).optional(),
});

export const mediaUploadSchema = z.object({
  purpose: z.enum(['avatar', 'banner', 'sticker', 'sessionIcon']),
  mime: z.enum(PROFILE_IMAGE_MIMES),
  size: z.number().int().positive().max(PROFILE_IMAGE_MAX_BYTES),
});

export const createStickerSchema = z.object({ uploadId: z.string().uuid() });
export const stickerFromAttachmentSchema = z.object({ attachmentId: z.string().uuid() });

export const notifySettingsSchema = z.object({
  level: z.enum(NOTIFY_LEVELS).optional(),
  mutedUntil: z.iso.datetime().nullable().optional(),
});

export const channelMuteSchema = z.object({
  mutedUntil: z.iso.datetime().nullable(),
});

export const serverMuteSchema = z.object({ muted: z.boolean() });

export const createSessionSchema = z.object({
  name: name(LIMITS.sessionName),
  isSet: z.boolean().optional(),
});

export const joinSessionSchema = z.object({
  code: z.string().min(4).max(20),
});

export const updateSessionSchema = z.object({
  name: name(LIMITS.sessionName).optional(),
  isSet: z.boolean().optional(),
  membersCanCreateText: z.boolean().optional(),
  membersCanCreateVoice: z.boolean().optional(),
  accountsOnly: z.boolean().optional(),
  membersCanMentionEveryone: z.boolean().optional(),
  /** Finished `/me/media-upload` (purpose sessionIcon); null removes the picture. Set sessions only. */
  iconUploadId: z.string().uuid().nullable().optional(),
});

export const timeoutSchema = z.object({
  /** null removes the timeout. */
  minutes: z
    .number()
    .int()
    .refine((m) => (TIMEOUT_MINUTES as readonly number[]).includes(m), 'Unsupported timeout length')
    .nullable(),
});

/** One emoji (with skin tones / ZWJ sequences / flags), never plain text. */
export const reactionEmojiSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Component}|\p{Emoji_Modifier}|\u200d|\ufe0f|\u20e3)+$/u, 'Not an emoji')
  .refine((e) => /\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|\u20e3/u.test(e), 'Not an emoji');

export const updateMemberSchema = z.object({
  nickname: z.string().trim().max(LIMITS.nickname).nullable().optional(),
});

export const byPublicIdSchema = z.object({
  publicId: z.string().trim().min(3).max(16),
});

export const banSchema = z.object({
  reason: z.string().max(200).optional(),
});

export const createChannelSchema = z.object({
  name: name(LIMITS.channelName),
  type: z.enum(['TEXT', 'VOICE']),
  audioPreset: z.enum(Object.keys(AUDIO_PRESETS) as [keyof typeof AUDIO_PRESETS]).optional(),
  userLimit: z.number().int().min(0).max(500).optional(),
});

export const updateChannelSchema = createChannelSchema.omit({ type: true }).partial();

export const sendMessageSchema = z
  .object({
    content: z.string().max(LIMITS.message).default(''),
    replyToId: z.string().uuid().optional(),
    attachmentIds: z.array(z.string().uuid()).max(LIMITS.attachmentsPerMessage).default([]),
    stickerId: z.string().uuid().optional(),
    /** Client-generated id echoed back so the sender can match its optimistic message. */
    nonce: z.string().max(64).optional(),
  })
  .refine((m) => m.content.trim().length > 0 || m.attachmentIds.length > 0 || !!m.stickerId, {
    message: 'Message must have text, attachments or a sticker',
  });

export const editMessageSchema = z.object({
  content: z.string().trim().min(1).max(LIMITS.message),
});

export const createUploadSchema = z.object({
  filename: z.string().min(1).max(200),
  mime: z
    .string()
    .max(120)
    .regex(/^[\w.+-]+\/[\w.+-]+(\s*;\s*[\w.+-]+=[\w.+"-]+)*$/, 'Invalid file type'),
  size: z.number().int().positive(),
  kind: z.enum(ATTACHMENT_KINDS),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  waveform: z.array(z.number().int().min(0).max(255)).max(256).optional(),
});

export type GuestAuthInput = z.infer<typeof guestAuthSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpgradeInput = z.infer<typeof upgradeSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
export type SendMessageInput = z.input<typeof sendMessageSchema>;
export type CreateUploadInput = z.infer<typeof createUploadSchema>;
export type MediaUploadInput = z.infer<typeof mediaUploadSchema>;
export type TimeoutInput = z.infer<typeof timeoutSchema>;
export type NotifySettingsInput = z.infer<typeof notifySettingsSchema>;
