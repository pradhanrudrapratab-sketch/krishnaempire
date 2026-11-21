import { ChannelType, Events, PermissionFlagsBits, type Client, type VoiceBasedChannel } from 'discord.js';
import { pool } from '../db';
import type { CommandDef } from '../framework';
import { getCfg, patchCfg } from '../services/config';
import { panel } from '../ui';

const DEF = { channelId: null as string | null, categoryId: null as string | null, nameTemplate: "{username}'s room", userLimit: 0 };
const recent = new Map<string, number>();
const chan = { name: 'channel', type: 'channel', description: 'Channel' } as const;

export const jtc: CommandDef = {
  name: 'jtc', description: 'Join to Create voice channels', module: 'voice', defaultSub: 'config',
  subs: {
    setup: { description: 'Set the Join-to-Create voice channel', args: [chan] },
    channel: { description: 'Set the Join-to-Create voice channel', args: [chan] },
    category: { description: 'Set the category for new rooms', args: [chan] },
    name: { description: 'Set the name template ({username})', args: [{ name: 'template', type: 'rest', description: 'Template' }] },
    limit: { description: 'Default user limit (0 = none)', args: [{ name: 'limit', type: 'int', description: '0–99' }] },
    config: { description: 'Show settings' }, disable: { description: 'Disable' },
  },
  async run(ctx) {
    const gid = ctx.guild.id, by = ctx.member.id;
    const ok = (t: string) => ctx.reply(panel('Join to Create', t, 'ok'));
    switch (ctx.sub) {
      case 'setup': case 'channel': {
        const ch = ctx.channel('channel')!;
        if (ch.type !== ChannelType.GuildVoice) return ctx.reply(panel('Invalid channel', 'Pick a voice channel.', 'error'), true);
        await patchCfg(gid, 'jtc', { channelId: ch.id, ...(ch.parentId && !(await getCfg(gid, 'jtc', DEF)).categoryId ? { categoryId: ch.parentId } : {}) }, by);
        return ok(`Join channel: <#${ch.id}>.`);
      }
      case 'category': {
        const ch = ctx.channel('channel')!;
        if (ch.type !== ChannelType.GuildCategory) return ctx.reply(panel('Invalid channel', 'Pick a category.', 'error'), true);
        await patchCfg(gid, 'jtc', { categoryId: ch.id }, by); return ok('Category set.');
      }
      case 'name': await patchCfg(gid, 'jtc', { nameTemplate: ctx.str('template')!.slice(0, 80) }, by); return ok('Name template set.');
      case 'limit': { const n = ctx.int('limit')!; if (n < 0 || n > 99) return ctx.reply(panel('Invalid', 'Use 0–99.', 'error'), true); await patchCfg(gid, 'jtc', { userLimit: n }, by); return ok(`Default limit: ${n}.`); }
      case 'disable': await patchCfg(gid, 'jtc', { channelId: null }, by); return ok('Disabled.');
      default: { const c = await getCfg(gid, 'jtc', DEF); return ctx.reply(panel('Join to Create', `Join channel: ${c.channelId ? `<#${c.channelId}>` : '_not set_'}\nCategory: ${c.categoryId ? `<#${c.categoryId}>` : '_none_'}\nName: \`${c.nameTemplate}\` · Limit: ${c.userLimit}`)); }
    }
  },
};

/** Owner controls for your own temporary channel (no staff permission required). */
export const vc: CommandDef = {
  name: 'vc', description: 'Manage your temporary voice channel', module: null,
  subs: {
    lock: { description: 'Lock your channel' }, unlock: { description: 'Unlock your channel' },
    hide: { description: 'Hide your channel' }, show: { description: 'Show your channel' },
    rename: { description: 'Rename', args: [{ name: 'name', type: 'rest', description: 'New name' }] },
    limit: { description: 'Set user limit', args: [{ name: 'limit', type: 'int', description: '0–99' }] },
    transfer: { description: 'Transfer ownership', args: [{ name: 'user', type: 'user', description: 'Member in your channel' }] },
  },
  async run(ctx) {
    const ch = ctx.member.voice.channel;
    const row = ch ? (await pool.query('SELECT owner_id FROM temp_voice WHERE channel_id=$1', [ch.id])).rows[0] : null;
    if (!ch || !row) return ctx.reply(panel('Not in a temporary channel', 'Join your Join-to-Create room first.', 'error'), true);
    if (row.owner_id !== ctx.member.id) return ctx.reply(panel('Not the owner', `Only <@${row.owner_id}> can do that.`, 'error'), true);
    const everyone = ctx.guild.roles.everyone;
    const done = (t: string) => ctx.reply(panel('Voice', t, 'ok'));
    try {
      switch (ctx.sub) {
        case 'lock': case 'unlock': await ch.permissionOverwrites.edit(everyone, { Connect: ctx.sub === 'lock' ? false : null }); return done(`Channel ${ctx.sub}ed.`);
        case 'hide': case 'show': await ch.permissionOverwrites.edit(everyone, { ViewChannel: ctx.sub === 'hide' ? false : null }); return done(`Channel ${ctx.sub === 'hide' ? 'hidden' : 'visible'}.`);
        case 'rename': await ch.setName(ctx.str('name')!.slice(0, 90)); return done('Renamed.');
        case 'limit': { const n = ctx.int('limit')!; if (n < 0 || n > 99) return ctx.reply(panel('Invalid', 'Use 0–99.', 'error'), true); await ch.setUserLimit(n); return done(`Limit: ${n}.`); }
        default: {
          const u = (await ctx.user('user'))!;
          if (u.bot || !ch.members.has(u.id)) return ctx.reply(panel('Invalid', 'That member must be a human in your channel.', 'error'), true);
          await pool.query('UPDATE temp_voice SET owner_id=$2 WHERE channel_id=$1', [ch.id, u.id]);
          return done(`Ownership transferred to <@${u.id}>.`);
        }
      }
    } catch { return ctx.reply(panel('Failed', 'I lack permission to edit that channel.', 'error'), true); }
  },
};
export const commands = [jtc, vc];

async function cleanup(ch: VoiceBasedChannel) {
  const r = await pool.query('SELECT 1 FROM temp_voice WHERE channel_id=$1', [ch.id]);
  if (!r.rowCount || ch.members.size > 0) return;
  await pool.query('DELETE FROM temp_voice WHERE channel_id=$1', [ch.id]);
  await ch.delete('Temporary channel empty').catch(() => {});
}

export function init(client: Client) {
  client.once(Events.ClientReady, async (c) => {
    // Startup sweep: remove empty/missing temp channels left over from downtime.
    for (const row of (await pool.query('SELECT channel_id, guild_id FROM temp_voice')).rows) {
      const ch = await c.channels.fetch(row.channel_id).catch(() => null);
      if (!ch || !ch.isVoiceBased()) await pool.query('DELETE FROM temp_voice WHERE channel_id=$1', [row.channel_id]);
      else await cleanup(ch);
    }
  });
  client.on(Events.VoiceStateUpdate, async (a, b) => {
    try {
      if (a.channel && a.channelId !== b.channelId) await cleanup(a.channel);
      if (!b.channel || a.channelId === b.channelId || !b.member) return;
      const c = await getCfg(b.guild.id, 'jtc', DEF);
      if (!c.channelId || b.channelId !== c.channelId) return;
      const now = Date.now();
      if (now - (recent.get(b.id) ?? 0) < 3000) return; // anti-spam
      recent.set(b.id, now);
      const ch = await b.guild.channels.create({
        name: c.nameTemplate.replaceAll('{username}', b.member.displayName).slice(0, 100), type: ChannelType.GuildVoice,
        parent: c.categoryId ?? b.channel.parentId ?? undefined, userLimit: c.userLimit,
        permissionOverwrites: [{ id: client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] }],
        reason: 'Join to Create',
      });
      await pool.query('INSERT INTO temp_voice (channel_id, guild_id, owner_id) VALUES ($1,$2,$3)', [ch.id, b.guild.id, b.id]);
      await b.member.voice.setChannel(ch).catch(async () => { await cleanup(ch); });
    } catch (e) { console.error('[jtc]', e); }
  });
}
