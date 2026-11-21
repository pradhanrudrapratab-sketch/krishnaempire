import type { Guild, GuildMember } from 'discord.js';
import { env } from '../../shared/env';
import { SPECIAL_ROLE_KINDS, isAllowed } from '../../shared/permissions/engine';
import { getOverrides, getSpecialRoles } from './roles';

/** The one authorization entry point for every command, from every interface. */
export async function can(guild: Guild, member: GuildMember, module: string | null): Promise<boolean> {
  if (module === null) return true;
  const isOwner = member.id === env.OWNER_ID; // from env only, never from input
  if (isOwner) return true;
  const [roles, overrides] = await Promise.all([getSpecialRoles(guild.id), getOverrides(guild.id)]);
  const kinds = SPECIAL_ROLE_KINDS.filter((k) => roles[k] && member.roles.cache.has(roles[k]!));
  return isAllowed({ isOwner, isServerOwner: guild.ownerId === member.id, kinds, module, overrides });
}

/** Native-hierarchy guard for moderation (used from Phase 4). */
export function canActOn(guild: Guild, actor: GuildMember, target: GuildMember): { ok: boolean; reason?: string } {
  if (target.id === env.OWNER_ID && actor.id !== env.OWNER_ID) return { ok: false, reason: 'You cannot act on the bot owner.' };
  if (target.id === guild.ownerId) return { ok: false, reason: 'You cannot act on the server owner.' };
  const me = guild.members.me;
  if (!me || me.roles.highest.position <= target.roles.highest.position)
    return { ok: false, reason: 'My highest role is not above that member.' };
  if (actor.id === guild.ownerId || actor.id === env.OWNER_ID) return { ok: true };
  if (actor.roles.highest.position <= target.roles.highest.position)
    return { ok: false, reason: 'Your highest role is not above that member.' };
  return { ok: true };
}
