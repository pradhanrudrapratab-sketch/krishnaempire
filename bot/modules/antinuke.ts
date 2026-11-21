import { AuditLogEvent, EmbedBuilder, Events, PermissionFlagsBits, type Client, type Guild, type GuildAuditLogsEntry } from 'discord.js';
import { env } from '../../shared/env';
import { pool } from '../db';
import type { CommandDef } from '../framework';
import { audit } from '../services/audit';
import { getCfg, patchCfg } from '../services/config';
import { logEvent } from '../services/logs';
import { addTrustedBot, addTrustedUser, isTrustedBot, isTrustedUser, listTrustedBots, listTrustedUsers, removeTrustedBot, removeTrustedUser } from '../services/trustedBots';
import { COLORS, logEmbed, panel } from '../ui';

type Limits = Record<string, [number, number]>; // action -> [count, windowSeconds]
export const AN_DEF = {
  enabled: false, logChannelId: null as string | null,
  punishment: 'kick' as 'ban' | 'kick' | 'strip' | 'none', recovery: false,
  limits: {
    channelDelete: [3, 10], channelCreate: [5, 10], roleDelete: [3, 10], roleCreate: [5, 10],
    permChange: [3, 10], ban: [3, 10], kick: [3, 10], webhookCreate: [3, 10],
  } as Limits,
};
const ACTIONS: Partial<Record<AuditLogEvent, string>> = {
  [AuditLogEvent.ChannelDelete]: 'channelDelete', [AuditLogEvent.ChannelCreate]: 'channelCreate',
  [AuditLogEvent.RoleDelete]: 'roleDelete', [AuditLogEvent.RoleCreate]: 'roleCreate', [AuditLogEvent.RoleUpdate]: 'permChange',
  [AuditLogEvent.MemberBanAdd]: 'ban', [AuditLogEvent.MemberKick]: 'kick', [AuditLogEvent.WebhookCreate]: 'webhookCreate',
};
const DANGEROUS = PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ManageChannels;

const seen = new Set<string>();                    // duplicate-event prevention
const hits = new Map<string, { t: number; target: string | null }[]>();
const cooldown = new Map<string, number>();

async function alert(guild: Guild, cfg: typeof AN_DEF, e: EmbedBuilder) {
  await logEvent(guild, 'security', e);
  const ch: any = cfg.logChannelId ? guild.channels.cache.get(cfg.logChannelId) : null;
  if (ch?.isTextBased()) await ch.send({ embeds: [e], allowedMentions: { parse: [] } }).catch(() => {});
}

async function onEntry(client: Client, entry: GuildAuditLogsEntry, guild: Guild) {
  if (guild.id !== env.GUILD_ID || seen.has(entry.id)) return;
  seen.add(entry.id); if (seen.size > 2000) seen.delete(seen.values().next().value!);
  const cfg = await getCfg(guild.id, 'antinuke', AN_DEF);
  if (!cfg.enabled) return;

  if (entry.action === AuditLogEvent.BotAdd && entry.targetId) {
    if (await isTrustedBot(guild.id, entry.targetId)) return;
    const kicked = await guild.members.kick(entry.targetId, 'Anti-Nuke: untrusted bot added').then(() => true).catch(() => false);
    await audit(pool, guild.id, client.user!.id, 'antinuke.untrusted_bot', entry.targetId, { by: entry.executorId, kicked });
    return alert(guild, cfg, logEmbed('Untrusted bot added', `Bot <@${entry.targetId}> added by <@${entry.executorId}>.\nAction: ${kicked ? 'bot removed' : 'could not remove (check my permissions)'}`, COLORS.error));
  }
  if (entry.action === AuditLogEvent.GuildUpdate)
    return alert(guild, cfg, logEmbed('Server settings changed', `By <@${entry.executorId}>: ${entry.changes.map((c) => c.key).join(', ')}`, COLORS.accent));

  const action = ACTIONS[entry.action];
  const exec = entry.executorId;
  if (!action || !exec || exec === client.user!.id || exec === env.OWNER_ID || exec === guild.ownerId) return;
  if (action === 'permChange') {
    const ch = entry.changes.find((c) => c.key === 'permissions');
    const gained = ch ? BigInt(String(ch.new ?? 0)) & ~BigInt(String(ch.old ?? 0)) & DANGEROUS : 0n;
    if (!gained) return; // only count changes that grant dangerous permissions
  }
  // Exemptions apply only to these detection checks and grant no Discord permissions.
  if ((await isTrustedUser(guild.id, exec)) || (await isTrustedBot(guild.id, exec))) return;

  const [limit, windowS] = cfg.limits[action] ?? AN_DEF.limits[action];
  const k = `${guild.id}:${exec}:${action}`;
  const now = Date.now();
  const arr = (hits.get(k) ?? []).filter((h) => now - h.t < windowS * 1000);
  arr.push({ t: now, target: entry.targetId ?? null });
  hits.set(k, arr);
  if (arr.length < limit || (cooldown.get(k) ?? 0) > now - 60_000) return;
  cooldown.set(k, now);

  const names = entry.changes.filter((c) => c.key === 'name').map((c) => String(c.old ?? c.new)).join(', ');
  let outcome = 'none';
  const m = await guild.members.fetch(exec).catch(() => null);
  if (m && cfg.punishment !== 'none') {
    try {
      if (cfg.punishment === 'ban' && m.bannable) { await m.ban({ reason: 'Anti-Nuke trigger' }); outcome = 'banned'; }
      else if (cfg.punishment === 'kick' && m.kickable) { await m.kick('Anti-Nuke trigger'); outcome = 'kicked'; }
      else if (cfg.punishment === 'strip') { await m.roles.remove(m.roles.cache.filter((r) => r.id !== guild.id && r.editable), 'Anti-Nuke trigger'); outcome = 'roles stripped'; }
      else outcome = 'insufficient permissions to punish';
    } catch { outcome = 'punishment failed'; }
  }
  let recovered = '';
  if (cfg.recovery && (action === 'channelCreate' || action === 'roleCreate')) {
    let n = 0;
    for (const h of arr) {
      if (!h.target) continue;
      const res: any = action === 'channelCreate' ? guild.channels.cache.get(h.target) : guild.roles.cache.get(h.target);
      if (res && (res.deletable ?? res.editable)) { await res.delete('Anti-Nuke recovery').then(() => n++).catch(() => {}); }
    }
    recovered = `\nRecovery: removed ${n} newly created ${action === 'channelCreate' ? 'channels' : 'roles'}.`;
  } else if (action.endsWith('Delete')) recovered = '\nRecovery: Discord cannot restore deleted channels/roles — recreate manually.';
  await audit(pool, guild.id, client.user!.id, 'antinuke.trigger', exec, { action, count: arr.length, windowS, outcome });
  await alert(guild, cfg, logEmbed('🚨 Anti-Nuke triggered',
    `**Actor:** <@${exec}>\n**Action:** ${action} ×${arr.length} in ${windowS}s (limit ${limit})\n**Punishment:** ${outcome}${names ? `\n**Affected:** ${names}` : ''}${recovered}`, COLORS.error));
}

export function init(client: Client) {
  client.on(Events.GuildAuditLogEntryCreate, (e, g) => void onEntry(client, e, g).catch((err) => console.error('[antinuke]', err)));
}

const botArg = { name: 'bot', type: 'user', description: 'Bot account' } as const;
const userArg = { name: 'user', type: 'user', description: 'User' } as const;
export const antinuke: CommandDef = {
  name: 'antinuke', description: 'Anti-Nuke security', module: 'antinuke', defaultSub: 'status',
  subs: {
    setup: { description: 'Enable and set the alert channel', args: [{ name: 'channel', type: 'channel', description: 'Security log channel' }] },
    enable: { description: 'Enable protection' }, disable: { description: 'Disable protection' },
    status: { description: 'Show status' }, config: { description: 'Show configuration' },
    'config threshold': { description: 'Set a limit', args: [{ name: 'action', type: 'string', description: 'Action', choices: Object.keys(AN_DEF.limits) }, { name: 'limit', type: 'int', description: 'Count (1–50)' }, { name: 'seconds', type: 'int', description: 'Window (1–300)' }] },
    'config punishment': { description: 'Set punishment', args: [{ name: 'type', type: 'string', description: 'Punishment', choices: ['ban', 'kick', 'strip', 'none'] }] },
    'config recovery': { description: 'Toggle removal of spam-created channels/roles', args: [{ name: 'value', type: 'string', description: 'on/off', choices: ['on', 'off'] }] },
    logs: { description: 'Set the alert channel', args: [{ name: 'channel', type: 'channel', description: 'Channel' }] },
    'whitelist add': { description: 'Trust a user (bot owner only)', module: 'trustedusers', args: [userArg] },
    'whitelist remove': { description: 'Untrust a user (bot owner only)', module: 'trustedusers', args: [userArg] },
    'whitelist list': { description: 'List trusted users' },
    'bot add': { description: 'Trust a bot (bot owner only)', module: 'trustedbots', args: [botArg] },
    'bot remove': { description: 'Untrust a bot (bot owner only)', module: 'trustedbots', args: [botArg] },
    'bot list': { description: 'List trusted bots' },
    'bot check': { description: 'Check if a bot is trusted', args: [botArg] },
  },
  async run(ctx) {
    const gid = ctx.guild.id, by = ctx.member.id;
    const c = await getCfg(gid, 'antinuke', AN_DEF);
    const ok = (t: string) => ctx.reply(panel('Anti-Nuke', t, 'ok'));
    switch (ctx.sub) {
      case 'setup': case 'logs': {
        const ch = ctx.channel('channel')!;
        if (!ch.isTextBased()) return ctx.reply(panel('Invalid channel', 'Pick a text channel.', 'error'), true);
        await patchCfg(gid, 'antinuke', { logChannelId: ch.id, ...(ctx.sub === 'setup' ? { enabled: true } : {}) }, by);
        return ok(`Alerts → <#${ch.id}>${ctx.sub === 'setup' ? '. Protection enabled.' : '.'}`);
      }
      case 'enable': await patchCfg(gid, 'antinuke', { enabled: true }, by); return ok('Protection enabled.');
      case 'disable': await patchCfg(gid, 'antinuke', { enabled: false }, by); return ok('Protection disabled.');
      case 'config threshold': {
        const a = ctx.str('action')!.toLowerCase(), n = ctx.int('limit')!, s = ctx.int('seconds')!;
        if (n < 1 || n > 50 || s < 1 || s > 300) return ctx.reply(panel('Invalid', 'Limit 1–50, window 1–300s.', 'error'), true);
        await patchCfg(gid, 'antinuke', { limits: { ...c.limits, [a]: [n, s] } }, by);
        return ok(`\`${a}\`: ${n} per ${s}s.`);
      }
      case 'config punishment': await patchCfg(gid, 'antinuke', { punishment: ctx.str('type')!.toLowerCase() }, by); return ok('Punishment updated.');
      case 'config recovery': await patchCfg(gid, 'antinuke', { recovery: ctx.str('value')!.toLowerCase() === 'on' }, by); return ok('Recovery setting updated.');
      case 'whitelist add': case 'whitelist remove': {
        const u = (await ctx.user('user'))!;
        const changed = ctx.sub === 'whitelist add' ? await addTrustedUser(gid, u.id, by) : await removeTrustedUser(gid, u.id, by);
        return ok(changed ? `<@${u.id}> ${ctx.sub === 'whitelist add' ? 'trusted' : 'removed'}.` : 'No change.');
      }
      case 'whitelist list': return ctx.reply(panel('Trusted users', (await listTrustedUsers(gid)).map((u) => `<@${u}>`).join('\n') || '_None_'));
      case 'bot list': {
        const rows = await listTrustedBots(gid);
        return ctx.reply(panel('Trusted bots', rows.map((r) => `<@${r.bot_id}> · added by <@${r.added_by}>`).join('\n') || '_None_'));
      }
      case 'bot add': case 'bot remove': case 'bot check': {
        const u = (await ctx.user('bot'))!;
        if (!u.bot) return ctx.reply(panel('Not a bot', 'Only Discord bot accounts can be trusted.', 'error'), true);
        if (ctx.sub === 'bot check') return ctx.reply(panel('Trusted bot check', `<@${u.id}> is **${(await isTrustedBot(gid, u.id)) ? 'trusted' : 'not trusted'}**.`));
        const changed = ctx.sub === 'bot add' ? await addTrustedBot(gid, u.id, by) : await removeTrustedBot(gid, u.id, by);
        return ok(changed ? `<@${u.id}> ${ctx.sub === 'bot add' ? 'added' : 'removed'}.` : 'No change.');
      }
      default: {
        const lim = Object.entries(c.limits).map(([k, [n, s]]) => `${k}: ${n}/${s}s`).join('\n');
        return ctx.reply(panel('Anti-Nuke status', `Enabled: **${c.enabled}**\nPunishment: **${c.punishment}** · Recovery: ${c.recovery}\nAlerts: ${c.logChannelId ? `<#${c.logChannelId}>` : '_not set_'}\nTrusted bots: ${(await listTrustedBots(gid)).length} · users: ${(await listTrustedUsers(gid)).length}\n\`\`\`${lim}\`\`\``));
      }
    }
  },
};
export const commands = [antinuke];
