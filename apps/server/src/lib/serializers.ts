import type { Attachment, Channel, Message, Session, SessionMember, Sticker, User } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { AttachmentDTO, ChannelDTO, MemberDTO, MessageDTO, PublicUser, SelfUser, SessionDTO, StickerDTO } from '@zirzircord/shared';
import { env } from '../env';
import { presignGet } from './storage';

function mediaUrl(userId: string, kind: 'avatar' | 'banner', key: string | null, still = false): string | null {
  if (!key) return null;
  const v = createHash('sha1').update(key).digest('hex').slice(0, 10);
  return `${env.PUBLIC_API_URL}/users/${userId}/${kind}?v=${v}${still ? '&static=1' : ''}`;
}

export function avatarUrl(user: Pick<User, 'id' | 'avatarKey'>): string | null {
  return mediaUrl(user.id, 'avatar', user.avatarKey);
}

/** Strictly whitelisted: never leaks email, password hash, etc. */
export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    publicId: u.publicId,
    displayName: u.displayName,
    avatarUrl: avatarUrl(u),
    avatarStaticUrl: u.avatarStaticKey ? mediaUrl(u.id, 'avatar', u.avatarStaticKey, true) : avatarUrl(u),
    bannerUrl: mediaUrl(u.id, 'banner', u.bannerKey),
    bannerStaticUrl: u.bannerStaticKey ? mediaUrl(u.id, 'banner', u.bannerStaticKey, true) : mediaUrl(u.id, 'banner', u.bannerKey),
    bio: u.bio,
    bannerColor: u.bannerColor,
    status: u.status,
    isGuest: u.isGuest,
  };
}

export function toSelfUser(u: User): SelfUser {
  return { ...toPublicUser(u), email: u.email };
}

export function toSessionDTO(s: Session): SessionDTO {
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    ownerId: s.ownerId,
    isSet: s.isSet,
    state: s.state,
    membersCanCreateText: s.membersCanCreateText,
    membersCanCreateVoice: s.membersCanCreateVoice,
    accountsOnly: s.accountsOnly,
    membersCanMentionEveryone: s.membersCanMentionEveryone,
    createdAt: s.createdAt.toISOString(),
  };
}

export function toMemberDTO(m: SessionMember & { user: User }): MemberDTO {
  return {
    user: toPublicUser(m.user),
    role: m.role,
    nickname: m.nickname,
    firstVisitedAt: m.firstVisitedAt.toISOString(),
    serverMuted: m.serverMuted,
  };
}

export function toChannelDTO(c: Channel): ChannelDTO {
  return {
    id: c.id,
    sessionId: c.sessionId,
    type: c.type,
    name: c.name,
    position: c.position,
    createdById: c.createdById,
    audioPreset: c.audioPreset,
    userLimit: c.userLimit,
  };
}

export async function toAttachmentDTO(a: Attachment): Promise<AttachmentDTO> {
  return {
    id: a.id,
    kind: a.kind,
    filename: a.filename,
    mime: a.mime,
    size: a.size,
    url: await presignGet(a.storageKey, { filename: a.filename, mime: a.mime }),
    thumbnailUrl: a.thumbnailKey ? await presignGet(a.thumbnailKey) : null,
    width: a.width,
    height: a.height,
    durationMs: a.durationMs,
    waveform: a.waveform.length ? a.waveform : null,
  };
}

export async function toMessageDTO(m: Message & { attachments: Attachment[] }): Promise<MessageDTO> {
  return {
    id: m.id,
    channelId: m.channelId,
    authorId: m.authorId,
    content: m.content,
    replyToId: m.replyToId,
    mentions: m.mentions,
    mentionsEveryone: m.mentionsEveryone,
    attachments: await Promise.all(
      [...m.attachments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(toAttachmentDTO),
    ),
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
  };
}

export async function toStickerDTO(st: Sticker): Promise<StickerDTO> {
  return {
    id: st.id,
    url: await presignGet(st.storageKey),
    staticUrl: st.animated ? await presignGet(`${st.storageKey}.still.webp`) : null,
    width: st.width,
    height: st.height,
    animated: st.animated,
  };
}
