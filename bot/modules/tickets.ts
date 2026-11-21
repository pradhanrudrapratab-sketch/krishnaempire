import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits,
  type Client, type Guild, type GuildMember,
} from 'discord.js';
import { pool } from '../db';
import type { CommandDef } from '../framework';
import { onButton } from '../interactions';
import { can } from '../services/authority';
import { getCfg, patchCfg, toggle } from '../services/config';
import { COLORS, panel } from '../ui';

interface Cat { id: string; label: string }
const DEF = {
  categories: [{ id: 'support', label: 'Support' }] as Cat[], staffRoleIds: [] as string[], logChannelId: null as string | null,
  parentId: null as string | null, openMessage: 'Thanks {user}, staff will be with you shortly. Please describe your issue.',
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
const isStaff = async (g: Guild, m: GuildMember, c: typeof DEF) => c.staffRoleIds.some((r) => m.roles.cache.has(r)) || (await can(g, m, 'tickets'));
const controls = (closed: boolean) => new ActionRowBuilder<ButtonBuilder>().addComponents(
  ...(closed
    ? [new ButtonBuilder().setCustomId('ticket:reopen').setLabel('Reopen').setStyle(ButtonStyle.Success),
       new ButtonBuilder().setCustomId('ticket:transcript').setLabel('Transcript').setStyle(ButtonStyle.Secondary),
       new ButtonBuilder().setCustomId('ticket:delete').setLabel('Delete').setStyle(ButtonStyle.Danger)]
    : [new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
       new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Secondary)]));

type Res = { ok: boolean; msg: string };
const getTicket = async (channelId: string) => (await pool.query('SELECT * FROM tickets WHERE channel_id=$1', [channelId])).rows[0] as any;

async function transcript(guild: Guild, channelId: string): Promise<AttachmentBuilder> {
  const ch: any = guild.channels.cache.get(channelId);
  const lines: string[] = [];
  let before: string | undefined;
  for (let i = 0; i < 10; i++) { // up to 1000 messages
    const batch = await ch.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    for (const m of batch.values()) lines.push(`[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}${m.attachments.size ? ' ' + m.attachments.map((a: any) => a.url).join(' ') : ''}`);
    before = batch.last()!.id;
  }
  return new AttachmentBuilder(Buffer.from(lines.reverse().join('\n') || '(empty)', 'utf8'), { name: `transcript-${channelId}.txt` });
}
async function sendLog(guild: Guild, c: typeof DEF, content: string, files: AttachmentBuilder[] = []) {
  const ch: any = c.logChannelId ? guild.channels.cache.get(c.logChannelId) : null;
  if (ch?.isTextBased()) await ch.send({ content, files, allowedMentions: { parse: [] } }).catch(() => {});
}

async function openTicket(guild: Guild, member: GuildMember, catId: string): Promise<Res> {
  const c = await getCfg(guild.id, 'tickets', DEF);
  const cat = c.categories.find((x) => x.id === catId);
  if (!cat) return { ok: false, msg: 'That ticket category no longer exists.' };
  const open = (await pool.query("SELECT count(*)::int n FROM tickets WHERE guild_id=$1 AND owner_id=$2 AND status='open'", [guild.id, member.id])).rows[0].n;
  if (open >= 3) return { ok: false, msg: 'You already have 3 open tickets.' };
  const ch = await guild.channels.create({
    name: `${cat.id}-${member.user.username}`.slice(0, 90), type: ChannelType.GuildText, parent: c.parentId ?? undefined,
    topic: `Ticket · ${cat.label} · owner ${member.id}`,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: guild.client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ...c.staffRoleIds.filter((r) => guild.roles.cache.has(r)).map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
    ],
  }).catch(() => null);
  if (!ch) return { ok: false, msg: 'I could not create the ticket channel (check my permissions).' };
  await pool.query('INSERT INTO tickets (guild_id, channel_id, owner_id, category) VALUES ($1,$2,$3,$4)', [guild.id, ch.id, member.id, cat.id]);
  await ch.send({ content: c.staffRoleIds.map((r) => `<@&${r}>`).join(' ') || undefined, embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle(`${cat.label} ticket`).setDescription(c.openMessage.replaceAll('{user}', `<@${member.id}>`))], components: [controls(false)], allowedMentions: { roles: c.staffRoleIds, users: [member.id] } });
  await sendLog(guild, c, `🎫 Ticket <#${ch.id}> opened by <@${member.id}> (${cat.label})`);
  return { ok: true, msg: `Ticket created: <#${ch.id}>` };
}

async function setClosed(guild: Guild, member: GuildMember, channelId: string, close: boolean): Promise<Res> {
  const t = await getTicket(channelId), c = await getCfg(guild.id, 'tickets', DEF);
  if (!t) return { ok: false, msg: 'This is not a ticket channel.' };
  const staff = await isStaff(guild, member, c);
  if (!staff && !(close && t.owner_id === member.id)) return { ok: false, msg: 'Only staff can do that.' };
  if ((t.status === 'closed') === close) return { ok: false, msg: `Ticket is already ${close ? 'closed' : 'open'}.` };
  const ch: any = guild.channels.cache.get(channelId);
  await ch.permissionOverwrites.edit(t.owner_id, { SendMessages: close ? false : true }).catch(() => {});
  await pool.query('UPDATE tickets SET status=$2, closed_at=$3 WHERE channel_id=$1', [channelId, close ? 'closed' : 'open', close ? new Date() : null]);
  await ch.send({ embeds: [new EmbedBuilder().setColor(COLORS.accent).setDescription(`Ticket ${close ? 'closed' : 'reopened'} by <@${member.id}>.`)], components: [controls(close)], allowedMentions: { parse: [] } });
  await sendLog(guild, c, `🎫 Ticket <#${channelId}> ${close ? 'closed' : 'reopened'} by <@${member.id}>`);
  return { ok: true, msg: close ? 'Closed.' : 'Reopened.' };
}
async function claim(guild: Guild, member: GuildMember, channelId: string): Promise<Res> {
  const t = await getTicket(channelId), c = await getCfg(guild.id, 'tickets', DEF);
  if (!t) return { ok: false, msg: 'This is not a ticket channel.' };
  if (!(await isStaff(guild, member, c))) return { ok: false, msg: 'Only staff can claim tickets.' };
  if (t.claimed_by) return { ok: false, msg: `Already claimed by <@${t.claimed_by}>.` };
  await pool.query('UPDATE tickets SET claimed_by=$2 WHERE channel_id=$1', [channelId, member.id]);
  await (guild.channels.cache.get(channelId) as any)?.send({ content: `🙋 <@${member.id}> claimed this ticket.`, allowedMentions: { parse: [] } });
  return { ok: true, msg: 'Claimed.' };
}
async function getTranscript(guild: Guild, member: GuildMember, channelId: string): Promise<{ res: Res; file?: AttachmentBuilder }> {
  const t = await getTicket(channelId), c = await getCfg(guild.id, 'tickets', DEF);
  if (!t) return { res: { ok: false, msg: 'This is not a ticket channel.' } };
  if (t.owner_id !== member.id && !(await isStaff(guild, member, c))) return { res: { ok: false, msg: 'You do not have access to this transcript.' } };
  return { res: { ok: true, msg: 'Transcript attached.' }, file: await transcript(guild, channelId) };
}
async function deleteTicket(guild: Guild, member: GuildMember, channelId: string): Promise<Res> {
  const t = await getTicket(channelId), c = await getCfg(guild.id, 'tickets', DEF);
  if (!t) return { ok: false, msg: 'This is not a ticket channel.' };
  if (!(await isStaff(guild, member, c))) return { ok: false, msg: 'Only staff can delete tickets.' };
  await sendLog(guild, c, `🎫 Ticket #${t.id} deleted by <@${member.id}> (owner <@${t.owner_id}>)`, [await transcript(guild, channelId)]);
  await pool.query('DELETE FROM tickets WHERE channel_id=$1', [channelId]);
  setTimeout(() => guild.channels.cache.get(channelId)?.delete('Ticket deleted').catch(() => {}), 3000);
  return { ok: true, msg: 'Deleting in 3 seconds. A transcript was saved to the log channel (if configured).' };
}

const chan = { name: 'channel', type: 'channel', description: 'Channel' } as const;
export const ticket: CommandDef = {
  name: 'ticket', description: 'Ticket system', module: 'tickets',
  subs: {
    setup: { description: 'Set staff role + log channel and post the panel', args: [{ name: 'role', type: 'role', description: 'Staff role' }, { name: 'logs', type: 'channel', description: 'Log channel' }] },
    panel: { description: 'Post the ticket panel', args: [{ ...chan, required: false }] },
    'category add': { description: 'Add a category (max 5)', args: [{ name: 'name', type: 'rest', description: 'Category name' }] },
    'category remove': { description: 'Remove a category', args: [{ name: 'name', type: 'rest', description: 'Category name' }] },
    staff: { description: 'Toggle a staff role', args: [{ name: 'role', type: 'role', description: 'Role' }] },
    logs: { description: 'Set the log channel', args: [chan] },
    close: { description: 'Close this ticket', module: null }, reopen: { description: 'Reopen this ticket', module: null },
    claim: { description: 'Claim this ticket', module: null }, transcript: { description: 'Export a transcript', module: null },
  },
  async run(ctx) {
    const gid = ctx.guild.id, by = ctx.member.id;
    const c = await getCfg(gid, 'tickets', DEF);
    const ok = (t: string) => ctx.reply(panel('Tickets', t, 'ok'));
    const here = ctx.here?.id as string;
    const res = (r: Res) => ctx.reply(panel('Tickets', r.msg, r.ok ? 'ok' : 'error'), !r.ok);
    switch (ctx.sub) {
      case 'close': case 'reopen': return res(await setClosed(ctx.guild, ctx.member, here, ctx.sub === 'close'));
      case 'claim': return res(await claim(ctx.guild, ctx.member, here));
      case 'transcript': { const t = await getTranscript(ctx.guild, ctx.member, here); return t.file ? ctx.reply({ files: [t.file] }) : res(t.res); }
      case 'setup': {
        const r = ctx.role('role')!, l = ctx.channel('logs')!;
        await patchCfg(gid, 'tickets', { staffRoleIds: [...new Set([...c.staffRoleIds, r.id])], logChannelId: l.id }, by);
        return ok('Staff role and log channel saved. Now run `panel` in the channel where members open tickets.');
      }
      case 'panel': {
        const ch: any = ctx.channel('channel') ?? ctx.here;
        if (!ch?.isTextBased()) return ctx.reply(panel('Invalid channel', 'Pick a text channel.', 'error'), true);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(c.categories.slice(0, 5).map((x) => new ButtonBuilder().setCustomId(`ticket:open:${x.id}`).setLabel(x.label).setStyle(ButtonStyle.Primary).setEmoji('🎫')));
        await ch.send({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('Support tickets').setDescription('Choose a category below to open a private ticket.')], components: [row] });
        return ok('Panel posted.');
      }
      case 'category add': {
        const name = ctx.str('name')!.slice(0, 40), id = slug(name);
        if (!id) return ctx.reply(panel('Invalid name', 'Use letters or numbers.', 'error'), true);
        if (c.categories.length >= 5 || c.categories.some((x) => x.id === id)) return ctx.reply(panel('Cannot add', 'Max 5 categories, names must be unique.', 'error'), true);
        await patchCfg(gid, 'tickets', { categories: [...c.categories, { id, label: name }] }, by); return ok(`Category **${name}** added. Re-post the panel to show it.`);
      }
      case 'category remove': {
        const id = slug(ctx.str('name')!);
        if (!c.categories.some((x) => x.id === id) || c.categories.length === 1) return ctx.reply(panel('Cannot remove', 'Not found, or it is the last category.', 'error'), true);
        await patchCfg(gid, 'tickets', { categories: c.categories.filter((x) => x.id !== id) }, by); return ok('Category removed.');
      }
      case 'staff': { const r = ctx.role('role')!; await patchCfg(gid, 'tickets', { staffRoleIds: toggle(c.staffRoleIds, r.id) }, by); return ok('Toggled staff role.'); }
      default: { const l = ctx.channel('channel')!; await patchCfg(gid, 'tickets', { logChannelId: l.id }, by); return ok(`Logs → <#${l.id}>.`); }
    }
  },
};
export const commands = [ticket];

export function init(_client: Client) {
  const eph = MessageFlags.Ephemeral;
  onButton('ticket', async (i, member, [action, arg]) => {
    const g = i.guild!, ch = i.channelId;
    const reply = (r: Res) => i.reply({ content: r.msg, flags: eph });
    switch (action) {
      case 'open': return void (await reply(await openTicket(g, member, arg)));
      case 'close': case 'reopen': return void (await reply(await setClosed(g, member, ch, action === 'close')));
      case 'claim': return void (await reply(await claim(g, member, ch)));
      case 'delete': return void (await reply(await deleteTicket(g, member, ch)));
      case 'transcript': { const t = await getTranscript(g, member, ch); return void (await (t.file ? i.reply({ files: [t.file], flags: eph }) : reply(t.res))); }
    }
  });
}
