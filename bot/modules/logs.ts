import { ChannelType, Events, type Client } from 'discord.js';
import type { CommandDef } from '../framework';
import { getCfg, patchCfg } from '../services/config';
import { LOG_DEFAULTS, LOG_EVENTS, logEvent } from '../services/logs';
import { COLORS, logEmbed, panel } from '../ui';

const chan = { name: 'channel', type: 'channel', description: 'Log channel' } as const;
const evArg = { name: 'event', type: 'string', description: 'Event name', choices: LOG_EVENTS } as const;

export const logsCommand: CommandDef = {
  name: 'logs', description: 'Configure server logging', module: 'logs', defaultSub: 'status',
  subs: {
    setup: { description: 'Set the log channel', args: [chan] },
    channel: { description: 'Set the log channel', args: [chan] },
    enable: { description: 'Enable an event', args: [evArg] },
    disable: { description: 'Disable an event', args: [evArg] },
    status: { description: 'Show log settings' },
  },
  async run(ctx) {
    const gid = ctx.guild.id;
    const c = await getCfg(gid, 'logs', LOG_DEFAULTS);
    if (ctx.sub === 'setup' || ctx.sub === 'channel') {
      const ch = ctx.channel('channel');
      if (!ch.isTextBased()) return ctx.reply(panel('Invalid channel', 'Pick a text channel.', 'error'), true);
      await patchCfg(gid, 'logs', { channelId: ch.id }, ctx.member.id);
      return ctx.reply(panel('Logs', `Log channel set to <#${ch.id}>.`, 'ok'));
    }
    if (ctx.sub === 'enable' || ctx.sub === 'disable') {
      const ev = ctx.str('event')!.toLowerCase();
      const disabled = ctx.sub === 'enable' ? c.disabled.filter((x) => x !== ev) : [...new Set([...c.disabled, ev])];
      await patchCfg(gid, 'logs', { disabled }, ctx.member.id);
      return ctx.reply(panel('Logs', `\`${ev}\` ${ctx.sub}d.`, 'ok'));
    }
    const on = LOG_EVENTS.filter((e) => !c.disabled.includes(e));
    return ctx.reply(panel('Log status', `Channel: ${c.channelId ? `<#${c.channelId}>` : '_not set_'}\nEnabled: ${on.join(', ') || '_none_'}\nDisabled: ${c.disabled.join(', ') || '_none_'}`));
  },
};
export const commands = [logsCommand];

export function init(client: Client) {
  client.on(Events.GuildMemberRemove, (m) =>
    void logEvent(m.guild, 'leave', logEmbed('Member left', `${m.user?.tag ?? m.id} (<@${m.id}>)`, COLORS.light)));
  client.on(Events.MessageDelete, (m) => {
    if (!m.guild || m.author?.bot) return;
    void logEvent(m.guild, 'messagedelete', logEmbed('Message deleted', `Author: ${m.author ? `<@${m.author.id}>` : 'unknown'}\nChannel: <#${m.channelId}>\n${m.content ?? '_content not cached_'}`));
  });
  client.on(Events.MessageUpdate, (a, b) => {
    if (!b.guild || b.author?.bot || a.content === b.content) return;
    void logEvent(b.guild, 'messageedit', logEmbed('Message edited', `Author: ${b.author ? `<@${b.author.id}>` : 'unknown'}\nChannel: <#${b.channelId}>\n**Before:** ${a.content ?? '_not cached_'}\n**After:** ${b.content ?? '_unknown_'}`));
  });
  client.on(Events.GuildRoleUpdate, (a, b) => {
    const diff = [a.name !== b.name && `name: ${a.name} → ${b.name}`, a.permissions.bitfield !== b.permissions.bitfield && 'permissions changed', a.color !== b.color && 'color changed'].filter(Boolean);
    if (diff.length) void logEvent(b.guild, 'roleupdate', logEmbed('Role updated', `<@&${b.id}>\n${diff.join('\n')}`));
  });
  client.on(Events.ChannelCreate, (c) => void logEvent(c.guild, 'channelcreate', logEmbed('Channel created', `<#${c.id}> (${ChannelType[c.type]})`)));
  client.on(Events.ChannelDelete, (c: any) => void logEvent(c.guild, 'channeldelete', logEmbed('Channel deleted', `#${c.name} (${ChannelType[c.type]})`)));
  client.on(Events.ChannelUpdate, (a: any, b: any) => {
    if (!b.guild || a.name === b.name) return;
    void logEvent(b.guild, 'channelupdate', logEmbed('Channel renamed', `#${a.name} → <#${b.id}>`));
  });
  client.on(Events.VoiceStateUpdate, (a, b) => {
    if (a.channelId === b.channelId) return;
    const what = !a.channelId ? `joined <#${b.channelId}>` : !b.channelId ? `left <#${a.channelId}>` : `moved <#${a.channelId}> → <#${b.channelId}>`;
    void logEvent(b.guild, 'voice', logEmbed('Voice activity', `<@${b.id}> ${what}`));
  });
  client.on(Events.GuildMemberUpdate, (a, b) => {
    if (a.nickname !== b.nickname) void logEvent(b.guild, 'nickname', logEmbed('Nickname changed', `<@${b.id}>: ${a.nickname ?? '_none_'} → ${b.nickname ?? '_none_'}`));
  });
}
