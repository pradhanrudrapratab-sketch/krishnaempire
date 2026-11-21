import type { EmbedBuilder, Guild } from 'discord.js';
import { getCfg } from './config';

export const LOG_EVENTS = [
  'join', 'leave', 'messagedelete', 'messageedit', 'roleupdate', 'channelcreate', 'channeldelete',
  'channelupdate', 'voice', 'moderation', 'nickname', 'invite', 'security',
] as const;
export type LogEvent = (typeof LOG_EVENTS)[number];
export const LOG_DEFAULTS = { channelId: null as string | null, disabled: [] as string[] };

export async function logEvent(guild: Guild, event: LogEvent, embed: EmbedBuilder) {
  const cfg = await getCfg(guild.id, 'logs', LOG_DEFAULTS);
  if (!cfg.channelId || cfg.disabled.includes(event)) return;
  const ch: any = guild.channels.cache.get(cfg.channelId);
  if (ch?.isTextBased()) await ch.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}
