import { EmbedBuilder, Events, type Client, type Guild, type User } from 'discord.js';
import type { CommandDef } from '../framework';
import { card } from '../services/cards';
import { getCfg, patchCfg } from '../services/config';
import { COLORS, panel } from '../ui';

type Kind = 'welcome' | 'goodbye';
const MSG: Record<Kind, string> = {
  welcome: 'Welcome {user} to **{server}**! You are member #{member_count}.',
  goodbye: '**{username}** has left **{server}**. We are now {member_count} members.',
};
const DEF = { enabled: false, channelId: null as string | null, message: '', dm: false, card: true };
const getC = (g: string, k: Kind) => getCfg(g, k, { ...DEF, message: MSG[k] });

const render = (t: string, u: User, g: Guild, mention: boolean) =>
  t.replaceAll('{user}', mention ? `<@${u.id}>` : `**${u.username}**`).replaceAll('{username}', u.username)
    .replaceAll('{server}', g.name).replaceAll('{member_count}', String(g.memberCount)).replaceAll('{user_id}', u.id);

export async function build(kind: Kind, user: User, guild: Guild) {
  const c = await getC(guild.id, kind);
  const e = new EmbedBuilder().setColor(COLORS.primary).setDescription(render(c.message, user, guild, kind === 'welcome'));
  const file = c.card
    ? await card({ title: kind === 'welcome' ? 'Welcome!' : 'Goodbye', subtitle: user.username, detail: `${guild.name} · ${guild.memberCount} members`, avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256 }) })
    : null;
  if (file) e.setImage('attachment://card.png');
  return { embeds: [e], files: file ? [file] : [], allowedMentions: { users: kind === 'welcome' ? [user.id] : [] } };
}

const onoff = { name: 'value', type: 'string', description: 'on or off', choices: ['on', 'off'] } as const;
const chan = { name: 'channel', type: 'channel', description: 'Text channel' } as const;

function greetCommand(kind: Kind): CommandDef {
  return {
    name: kind, description: `Configure the ${kind} system`, module: 'welcome', defaultSub: 'preview',
    subs: {
      setup: { description: 'Set the channel and enable', args: [chan] },
      channel: { description: 'Set the channel', args: [chan] },
      message: { description: 'Set the message template', args: [{ name: 'text', type: 'rest', description: 'Placeholders: {user} {username} {server} {member_count} {user_id}' }] },
      preview: { description: 'Preview the message' },
      enable: { description: 'Enable' }, disable: { description: 'Disable' },
      card: { description: 'Toggle the image card', args: [onoff] },
      ...(kind === 'welcome' ? { dm: { description: 'Toggle DM welcome', args: [onoff] } } : {}),
    },
    async run(ctx) {
      const gid = ctx.guild.id, by = ctx.member.id;
      const c = await getC(gid, kind);
      const done = (t: string) => ctx.reply(panel(kind, t, 'ok'));
      switch (ctx.sub) {
        case 'preview': return ctx.reply({ ...(await build(kind, ctx.member.user, ctx.guild)), content: 'Preview:' });
        case 'setup': case 'channel': {
          const ch = ctx.channel('channel');
          if (!ch.isTextBased()) return ctx.reply(panel('Invalid channel', 'Pick a text channel.', 'error'), true);
          await patchCfg(gid, kind, { channelId: ch.id, ...(ctx.sub === 'setup' ? { enabled: true } : {}) }, by);
          return done(`Channel set to <#${ch.id}>${ctx.sub === 'setup' ? ' and enabled' : ''}.`);
        }
        case 'message': await patchCfg(gid, kind, { message: ctx.str('text')!.slice(0, 1000) }, by); return done('Message updated.');
        case 'enable':
          if (!c.channelId) return ctx.reply(panel('Not ready', `Set a channel first: \`${ctx.prefix}${kind} channel #channel\``, 'error'), true);
          await patchCfg(gid, kind, { enabled: true }, by); return done('Enabled.');
        case 'disable': await patchCfg(gid, kind, { enabled: false }, by); return done('Disabled.');
        case 'card': await patchCfg(gid, kind, { card: ctx.str('value')!.toLowerCase() === 'on' }, by); return done('Card setting updated.');
        default: await patchCfg(gid, kind, { dm: ctx.str('value')!.toLowerCase() === 'on' }, by); return done('DM setting updated.');
      }
    },
  };
}

export const commands = [greetCommand('welcome'), greetCommand('goodbye')];

export function init(client: Client) {
  client.on(Events.GuildMemberAdd, async (m) => {
    const c = await getC(m.guild.id, 'welcome');
    if (!c.enabled) return;
    const msg = await build('welcome', m.user, m.guild);
    const ch: any = c.channelId ? m.guild.channels.cache.get(c.channelId) : null;
    if (ch?.isTextBased()) await ch.send(msg).catch((e: unknown) => console.error('[welcome]', e));
    if (c.dm) await m.send(msg).catch(() => {});
  });
  client.on(Events.GuildMemberRemove, async (m) => {
    const c = await getC(m.guild.id, 'goodbye');
    if (!c.enabled || !m.user) return;
    const ch: any = c.channelId ? m.guild.channels.cache.get(c.channelId) : null;
    if (ch?.isTextBased()) await ch.send(await build('goodbye', m.user, m.guild)).catch((e: unknown) => console.error('[goodbye]', e));
  });
}
