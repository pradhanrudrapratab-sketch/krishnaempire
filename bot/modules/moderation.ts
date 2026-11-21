import type { GuildMember, User } from 'discord.js';
import { pool } from '../db';
import type { CommandDef, Ctx } from '../framework';
import { canActOn } from '../services/authority';
import { logEvent } from '../services/logs';
import { COLORS, logEmbed, panel } from '../ui';

const userArg = { name: 'user', type: 'user', description: 'Target user' } as const;
const reasonArg = { name: 'reason', type: 'rest', description: 'Reason', required: false } as const;

export async function recordMod(guildId: string, action: string, targetId: string, modId: string, reason: string, durationS?: number): Promise<number> {
  const r = await pool.query(
    'INSERT INTO moderation_logs (guild_id, action, target_id, moderator_id, reason, duration_s) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [guildId, action, targetId, modId, reason, durationS ?? null]);
  return Number(r.rows[0].id);
}

async function report(ctx: Ctx, action: string, target: User, reason: string, caseId: number, extra = '') {
  const body = `**Target:** <@${target.id}> (${target.tag})\n**Moderator:** <@${ctx.member.id}>\n**Reason:** ${reason}${extra}\n**Case:** #${caseId}`;
  await logEvent(ctx.guild, 'moderation', logEmbed(`Moderation · ${action}`, body, COLORS.accent));
  await ctx.reply(panel(`${action} — case #${caseId}`, body, 'ok'));
}

/** Shared pipeline: validation → hierarchy → action → persistent log → report. */
async function act(ctx: Ctx, action: string, o: { needMember?: boolean; durationS?: number; extra?: string; run: (t: User, m: GuildMember | null, reason: string) => Promise<void> }) {
  const target = (await ctx.user('user'))!;
  const reason = (ctx.str('reason') || 'No reason provided').slice(0, 400);
  const fail = (t: string) => ctx.reply(panel('Cannot do that', t, 'error'), true);
  if (target.id === ctx.member.id) return fail('You cannot target yourself.');
  if (target.id === ctx.guild.client.user.id) return fail('I cannot target myself.');
  const m = await ctx.guild.members.fetch(target.id).catch(() => null);
  if (o.needMember && !m) return fail('That user is not in this server.');
  if (m) { const g = canActOn(ctx.guild, ctx.member, m); if (!g.ok) return fail(g.reason!); }
  try { await o.run(target, m, `${reason} (by ${ctx.member.user.tag})`); }
  catch (e) { console.error(`[mod:${action}]`, e); return fail('Discord rejected the action (check my permissions and role position).'); }
  const id = await recordMod(ctx.guild.id, action, target.id, ctx.member.id, reason, o.durationS);
  await report(ctx, action, target, reason, id, o.extra);
}

const ban: CommandDef = { name: 'ban', description: 'Ban a user', module: 'moderation', args: [userArg, reasonArg],
  run: (ctx) => act(ctx, 'Ban', { run: async (t, _m, r) => { await ctx.guild.members.ban(t.id, { reason: r }); } }) };

const unban: CommandDef = { name: 'unban', description: 'Unban a user', module: 'moderation', args: [userArg, reasonArg],
  async run(ctx) {
    const t = (await ctx.user('user'))!;
    const reason = (ctx.str('reason') || 'No reason provided').slice(0, 400);
    const banned = await ctx.guild.bans.fetch(t.id).catch(() => null);
    if (!banned) return ctx.reply(panel('Not banned', 'That user is not banned.', 'error'), true);
    await ctx.guild.bans.remove(t.id, `${reason} (by ${ctx.member.user.tag})`);
    await report(ctx, 'Unban', t, reason, await recordMod(ctx.guild.id, 'Unban', t.id, ctx.member.id, reason));
  } };

const kick: CommandDef = { name: 'kick', description: 'Kick a member', module: 'moderation', args: [userArg, reasonArg],
  run: (ctx) => act(ctx, 'Kick', { needMember: true, run: async (_t, m, r) => { await m!.kick(r); } }) };

const timeout: CommandDef = { name: 'timeout', description: 'Timeout a member', module: 'moderation',
  args: [userArg, { name: 'minutes', type: 'int', description: 'Duration in minutes (1–40320)' }, reasonArg],
  async run(ctx) {
    const mins = ctx.int('minutes')!;
    if (mins < 1 || mins > 40320) return ctx.reply(panel('Invalid duration', 'Use 1–40320 minutes (28 days max).', 'error'), true);
    return act(ctx, 'Timeout', { needMember: true, durationS: mins * 60, extra: `\n**Duration:** ${mins} min`, run: async (_t, m, r) => { await m!.timeout(mins * 60_000, r); } });
  } };

const untimeout: CommandDef = { name: 'untimeout', description: 'Remove a timeout', module: 'moderation', args: [userArg, reasonArg],
  run: (ctx) => act(ctx, 'Untimeout', { needMember: true, run: async (_t, m, r) => { await m!.timeout(null, r); } }) };

const warn: CommandDef = { name: 'warn', description: 'Warn a member', module: 'moderation', args: [userArg, { ...reasonArg, required: true }],
  run: (ctx) => act(ctx, 'Warn', { needMember: true, run: async (t, _m, r) => {
    await pool.query('INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES ($1,$2,$3,$4)', [ctx.guild.id, t.id, ctx.member.id, r]);
  } }) };

const warnings: CommandDef = { name: 'warnings', description: 'Show warnings', module: 'moderation', args: [userArg],
  async run(ctx) {
    const u = (await ctx.user('user'))!;
    const r = await pool.query('SELECT id, moderator_id, reason, created_at FROM warnings WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 10', [ctx.guild.id, u.id]);
    await ctx.reply(panel(`Warnings · ${u.tag}`, r.rows.map((w) => `**#${w.id}** <t:${Math.floor(w.created_at.getTime() / 1000)}:d> by <@${w.moderator_id}> — ${w.reason}`).join('\n') || '_No warnings._'));
  } };

const clear: CommandDef = { name: 'clear', description: 'Bulk delete recent messages', module: 'moderation',
  args: [{ name: 'amount', type: 'int', description: 'Messages to delete (1–100)' }],
  async run(ctx) {
    const n = ctx.int('amount')!;
    if (n < 1 || n > 100) return ctx.reply(panel('Invalid amount', 'Use 1–100.', 'error'), true);
    const ch = ctx.here;
    if (!ch?.bulkDelete) return ctx.reply(panel('Unsupported', 'Run this in a text channel.', 'error'), true);
    const del = await ch.bulkDelete(n, true).catch(() => null); // messages older than 14 days are skipped
    if (!del) return ctx.reply(panel('Failed', 'I could not delete messages here.', 'error'), true);
    await recordMod(ctx.guild.id, 'Clear', ch.id, ctx.member.id, `${del.size} messages`);
    await ch.send({ ...panel('Cleared', `Deleted **${del.size}** messages.`, 'ok') }).then((m: any) => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
  } };

const chArg = { name: 'channel', type: 'channel', description: 'Channel (default: here)', required: false } as const;
function lockCmd(name: 'lock' | 'unlock'): CommandDef {
  return { name, description: `${name === 'lock' ? 'Lock' : 'Unlock'} a channel`, module: 'moderation', args: [chArg],
    async run(ctx) {
      const ch = ctx.channel('channel') ?? ctx.here;
      if (!ch?.permissionOverwrites) return ctx.reply(panel('Unsupported', 'That channel cannot be locked.', 'error'), true);
      try { await ch.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: name === 'lock' ? false : null }, { reason: `${name} by ${ctx.member.user.tag}` }); }
      catch { return ctx.reply(panel('Failed', 'I lack permission to edit that channel.', 'error'), true); }
      await recordMod(ctx.guild.id, name === 'lock' ? 'Lock' : 'Unlock', ch.id, ctx.member.id, '');
      await ctx.reply(panel(name === 'lock' ? 'Channel locked' : 'Channel unlocked', `<#${ch.id}>`, 'ok'));
    } };
}

const slowmode: CommandDef = { name: 'slowmode', description: 'Set slowmode', module: 'moderation',
  args: [{ name: 'seconds', type: 'int', description: '0–21600 (0 = off)' }, chArg],
  async run(ctx) {
    const s = ctx.int('seconds')!;
    const ch = ctx.channel('channel') ?? ctx.here;
    if (s < 0 || s > 21600 || !ch?.setRateLimitPerUser) return ctx.reply(panel('Invalid', 'Seconds must be 0–21600 in a text channel.', 'error'), true);
    await ch.setRateLimitPerUser(s).catch(() => null);
    await recordMod(ctx.guild.id, 'Slowmode', ch.id, ctx.member.id, `${s}s`);
    await ctx.reply(panel('Slowmode', `<#${ch.id}>: **${s}s**`, 'ok'));
  } };

const nick: CommandDef = { name: 'nick', description: 'Change or clear a nickname', module: 'moderation',
  args: [userArg, { name: 'nickname', type: 'rest', description: 'New nickname (empty clears)', required: false }],
  run: (ctx) => act(ctx, 'Nickname', { needMember: true, run: async (_t, m, r) => { await m!.setNickname(ctx.str('nickname') || null, r); } }) };

export const commands = [ban, unban, kick, timeout, untimeout, warn, warnings, clear, lockCmd('lock'), lockCmd('unlock'), slowmode, nick];
