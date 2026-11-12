import type { Role } from './constants';

/**
 * Session permission matrix. The current *host* has no special powers: it is a
 * label for the longest-present member. Only the owner and owner-appointed
 * moderators can control a session.
 */
export type SessionAction =
  | 'session.toggleSet'
  | 'session.rotateCode'
  | 'session.delete'
  | 'session.transferOwnership'
  | 'session.manageMods'
  | 'session.editSettings'
  | 'session.kick'
  | 'session.ban'
  | 'channel.kick'
  | 'channel.ban'
  | 'channel.manage'
  | 'voice.serverMute'
  | 'message.deleteAny'
  | 'message.mentionEveryone';

const OWNER_ONLY: SessionAction[] = [
  'session.toggleSet',
  'session.rotateCode',
  'session.delete',
  'session.transferOwnership',
  'session.manageMods',
];

export function can(role: Role | null | undefined, action: SessionAction): boolean {
  if (!role) return false;
  if (role === 'OWNER') return true;
  if (role === 'MOD') return !OWNER_ONLY.includes(action);
  return false;
}

/** @everyone: owner/mods always; members only when the owner enabled it. */
export function canMentionEveryone(role: Role | null | undefined, settings: { membersCanMentionEveryone: boolean }): boolean {
  if (!role) return false;
  return role === 'OWNER' || role === 'MOD' || settings.membersCanMentionEveryone;
}

export interface ChannelCreationSettings {
  membersCanCreateText: boolean;
  membersCanCreateVoice: boolean;
}

export function canCreateChannel(
  role: Role | null | undefined,
  type: 'TEXT' | 'VOICE',
  settings: ChannelCreationSettings,
): boolean {
  if (!role) return false;
  if (role === 'OWNER' || role === 'MOD') return true;
  return type === 'TEXT' ? settings.membersCanCreateText : settings.membersCanCreateVoice;
}

/** Whether `actor` may kick/ban `target` (mods can't act on owner or other mods). */
export function canModerate(actor: Role | null | undefined, target: Role | null | undefined): boolean {
  if (!actor) return false;
  if (actor === 'OWNER') return target !== 'OWNER';
  if (actor === 'MOD') return target === 'MEMBER' || !target;
  return false;
}

/** Whether `actor` may edit/delete a channel created by `creatorId`. */
export function canManageChannel(role: Role | null | undefined, actorId: string, creatorId: string | null): boolean {
  return can(role, 'channel.manage') || (!!role && creatorId === actorId);
}
