import { ChannelType, Events, PermissionFlagsBits, type Client } from 'discord.js';
import { env } from '../../shared/env';
import type { CommandDef } from '../framework';
import { can } from '../services/authority';
import { getCfg, patchCfg, toggle } from '../services/config';
import { logEvent } from '../services/logs';
import { isTrustedBot, isTrustedUser } from '../services/trustedBots';
import { COLORS, logEmbed, panel } from '../ui';

const ACTIONS = ['alert', 'delete', 'timeout', 'kick', 'ban'] as const;
const DEF = { enabled: false, channelIds: [] as string[], action: 'timeout' as (typeof ACTIONS)[number], logChannelId: null as string | null };
const chan = { name: 'channel', type: 'channel', description: 'Channel' } as const;

export const honeypot: CommandDef = {
  name: 'honeypot', description: 'Trap channels that catch spam bots', module: 'honeypot', defaultSub: 'list',
  subs: {
    setup: { description: 'Create a trap channel and enable' },
    add: { description: 'Mark a channel as a trap', args: [chan] },
    remove: { description: 'Unmark a trap channel', args: [chan] },
    list: { description: 'Show traps and settings' },
    action: { description: 'Set the response', args: [{ name: 'action', type: 'string', description: 'Response', choices: ACTIONS }] },
    logs: { description: 'Set the alert channel', args: [chan] },
    enable: { description: 'Enable' }, disable: { description: 'Disable' },
  },
  async run(ctx) {
    const gid = ctx.guild.id, by = ctx.member.id;
    const c = await getCfg(gid, 'honeypot', DEF);
    const ok = (t: string) => ctx.reply(panel('Honeypot', t, 'ok'));
    switch (ctx.sub) {
      case 'setup': {
        const ch = await ctx.guild.channels.create({ name: 'do-not-post-here', type: ChannelType.GuildText, topic: 'Posting here gets you punished automatically.',
          permissionOverwrites: [{ id: ctx.guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] }).catch(() => null);
        if (!ch) return ctx.reply(panel('Failed', 'I need Manage Channels.', 'error'), true);
        await ch.send('⚠️ **Do not post in this channel.** Any message here results in an automatic punishment. It exists to catch spam bots.');
        await patchCfg(gid, 'honeypot', { enabled: true, channelIds: [...c.channelIds, ch.id] }, by);
        return ok(`Created <#${ch.id}> and enabled (action: **${c.action}**).`);
      }
      case 'add': case 'remove': {
        const ch = ctx.channel('channel')!;
        if (!ch.isTextBased()) return ctx.reply(panel('Invalid channel', 'Pick a text channel.', 'error'), true);
        const has = c.channelIds.includes(ch.id);
        if ((ctx.sub === 'add') === has) return ok('No change.');
        await patchCfg(gid, 'honeypot', { channelIds: toggle(c.channelIds, ch.id) }, by);
        return ok(`<#${ch.id}> ${ctx.sub === 'add' ? 'is now a trap' : 'removed'}.`);
      }
      case 'action': await patchCfg(gid, 'honeypot', { action: ctx.str('action')!.toLowerCase() }, by); return ok('Response updated.');
      case 'logs': { const ch = ctx.channel('channel')!; await patchCfg(gid, 'honeypot', { logChannelId: ch.id }, by); return ok(`Alerts → <#${ch.id}>.`); }
      case 'enable': await patchCfg(gid, 'honeypot', { enabled: true }, by); return ok('Enabled.');
      case 'disable': await patchCfg(gid, 'honeypot', { enabled: false }, by); return ok('Disabled.');
      default: return ctx.reply(panel('Honeypot', `Enabled: **${c.enabled}** · Action: **${c.action}**\nTraps: ${c.channelIds.map((i) => `<#${i}>`).join(' ') || '_none_'}\nAlerts: ${c.logChannelId ? `<#${c.logChannelId}>` : '_not set_'}`));
    }
  },
};
export const commands = [honeypot];

export function init(client: Client) {
  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.inGuild() || msg.guildId !== env.GUILD_ID || msg.author.id === client.user!.id) return;
    const c = await getCfg(msg.guildId, 'honeypot', DEF);
    if (!c.enabled || !c.channelIds.includes(msg.channelId)) return;
    // Exemptions: bot owner, server owner, staff with the honeypot module, trusted users/bots.
    if (msg.author.id === env.OWNER_ID || msg.author.id === msg.guild.ownerId) return;
    if (msg.author.bot ? await isTrustedBot(msg.guildId, msg.author.id) : await isTrustedUser(msg.guildId, msg.author.id)) return;
    const m = msg.member ?? (await msg.guild.members.fetch(msg.author.id).catch(() => null));
    if (m && (await can(msg.guild, m, 'honeypot'))) return;
    let outcome = 'alert only';
    try {
      if (c.action !== 'alert') await msg.delete().catch(() => {});
      if (m) {
        if (c.action === 'timeout' && m.moderatable) { await m.timeout(24 * 3600_000, 'Honeypot'); outcome = 'deleted + 24h timeout'; }
        else if (c.action === 'kick' && m.kickable) { await m.kick('Honeypot'); outcome = 'kicked'; }
        else if (c.action === 'ban' && m.bannable) { await m.ban({ reason: 'Honeypot', deleteMessageSeconds: 3600 }); outcome = 'banned'; }
        else if (c.action !== 'alert' && c.action !== 'delete') outcome = 'deleted (could not punish: permissions)';
        else if (c.action === 'delete') outcome = 'deleted';
      }
    } catch (e) { console.error('[honeypot]', e); outcome = 'action failed'; }
    const e = logEmbed('🍯 Honeypot triggered', `<@${msg.author.id}> posted in <#${msg.channelId}>\nResult: **${outcome}**`, COLORS.error);
    await logEvent(msg.guild, 'security', e);
    const ch: any = c.logChannelId ? msg.guild.channels.cache.get(c.logChannelId) : null;
    if (ch?.isTextBased()) await ch.send({ embeds: [e], allowedMentions: { parse: [] } }).catch(() => {});
  });
}
