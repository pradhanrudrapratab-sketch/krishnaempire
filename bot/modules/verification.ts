import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type Client } from 'discord.js';
import { pool } from '../db';
import type { CommandDef } from '../framework';
import { onButton } from '../interactions';
import { getCfg, patchCfg } from '../services/config';
import { logEvent } from '../services/logs';
import { COLORS, logEmbed, panel } from '../ui';

const DEF = { roleId: null as string | null, channelId: null as string | null, logChannelId: null as string | null, title: 'Verify to enter', text: 'Click the button below to gain access to the server.' };
const chan = { name: 'channel', type: 'channel', description: 'Channel' } as const;

async function sendPanel(guild: any, c: typeof DEF, channelId: string) {
  const ch = guild.channels.cache.get(channelId);
  if (!ch?.isTextBased()) return false;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('verify:go').setLabel('Verify').setStyle(ButtonStyle.Primary).setEmoji('✅'));
  await ch.send({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle(c.title).setDescription(c.text)], components: [row] });
  return true;
}

export const verify: CommandDef = {
  name: 'verify', description: 'One-click verification', module: 'verification', defaultSub: 'status',
  subs: {
    setup: { description: 'Set role + channel and post the panel', args: [{ name: 'role', type: 'role', description: 'Verified role' }, chan] },
    panel: { description: 'Post the panel', args: [{ ...chan, required: false }] },
    role: { description: 'Set the verified role', args: [{ name: 'role', type: 'role', description: 'Role' }] },
    channel: { description: 'Set the verification channel', args: [chan] },
    log: { description: 'Set the verification log channel', args: [chan] },
    reset: { description: 'Clear verification settings' },
    status: { description: 'Show settings' },
  },
  async run(ctx) {
    const gid = ctx.guild.id, by = ctx.member.id;
    const c = await getCfg(gid, 'verification', DEF);
    const ok = (t: string) => ctx.reply(panel('Verification', t, 'ok'));
    const checkRole = (r: any) => (r.id === gid || r.managed ? 'That role cannot be used.' : !r.editable ? 'That role is above my highest role — move my role higher.' : null);
    switch (ctx.sub) {
      case 'setup': {
        const r = ctx.role('role')!, ch = ctx.channel('channel')!, bad = checkRole(r);
        if (bad) return ctx.reply(panel('Cannot use role', bad, 'error'), true);
        if (!ch.isTextBased()) return ctx.reply(panel('Invalid channel', 'Pick a text channel.', 'error'), true);
        await patchCfg(gid, 'verification', { roleId: r.id, channelId: ch.id }, by);
        await sendPanel(ctx.guild, { ...c, roleId: r.id }, ch.id);
        return ok(`Panel posted in <#${ch.id}>. Verified role: <@&${r.id}>.`);
      }
      case 'panel': {
        const id = ctx.channel('channel')?.id ?? c.channelId;
        if (!id || !c.roleId) return ctx.reply(panel('Not ready', 'Run verify setup first.', 'error'), true);
        return (await sendPanel(ctx.guild, c, id)) ? ok('Panel posted.') : ctx.reply(panel('Failed', 'Invalid channel.', 'error'), true);
      }
      case 'role': { const r = ctx.role('role')!, bad = checkRole(r); if (bad) return ctx.reply(panel('Cannot use role', bad, 'error'), true); await patchCfg(gid, 'verification', { roleId: r.id }, by); return ok(`Verified role: <@&${r.id}>.`); }
      case 'channel': await patchCfg(gid, 'verification', { channelId: ctx.channel('channel')!.id }, by); return ok('Channel updated.');
      case 'log': await patchCfg(gid, 'verification', { logChannelId: ctx.channel('channel')!.id }, by); return ok('Log channel updated.');
      case 'reset': await patchCfg(gid, 'verification', { roleId: null, channelId: null, logChannelId: null }, by); return ok('Settings cleared.');
      default: {
        const n = (await pool.query('SELECT count(*)::int n FROM verification_records WHERE guild_id=$1', [gid])).rows[0].n;
        return ctx.reply(panel('Verification status', `Role: ${c.roleId ? `<@&${c.roleId}>` : '_not set_'}\nChannel: ${c.channelId ? `<#${c.channelId}>` : '_not set_'}\nLog: ${c.logChannelId ? `<#${c.logChannelId}>` : '_not set_'}\nVerified members: **${n}**`));
      }
    }
  },
};
export const commands = [verify];

export function init(_client: Client) {
  // Stateless customId => works after restarts. The clicker is always the one verified.
  onButton('verify', async (i, member) => {
    const eph = MessageFlags.Ephemeral;
    const c = await getCfg(i.guildId!, 'verification', DEF);
    const role = c.roleId ? i.guild!.roles.cache.get(c.roleId) : null;
    if (!role) return void (await i.reply({ content: 'Verification is not configured.', flags: eph }));
    if (member.roles.cache.has(role.id)) return void (await i.reply({ content: 'You are already verified.', flags: eph }));
    if (member.pending) return void (await i.reply({ content: 'Please finish the server membership screening first.', flags: eph }));
    if (!role.editable) return void (await i.reply({ content: 'I cannot assign that role. Please tell a staff member.', flags: eph }));
    const ins = await pool.query('INSERT INTO verification_records (guild_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [i.guildId, member.id]);
    await member.roles.add(role, 'Verified via button');
    await i.reply({ content: '✅ You are verified. Welcome!', flags: eph });
    const e = logEmbed('Member verified', `<@${member.id}> verified${ins.rowCount ? '' : ' (again)'}.`, COLORS.accent);
    await logEvent(i.guild!, 'security', e);
    const ch: any = c.logChannelId ? i.guild!.channels.cache.get(c.logChannelId) : null;
    if (ch?.isTextBased()) await ch.send({ embeds: [e], allowedMentions: { parse: [] } }).catch(() => {});
  });
}
