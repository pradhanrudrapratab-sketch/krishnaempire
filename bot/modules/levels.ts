import { Events, type Client, type GuildMember } from 'discord.js';
import { levelFromXp, xpForLevel, xpToNext } from '../../shared/levels';
import { pool } from '../db';
import type { CommandDef } from '../framework';
import { card } from '../services/cards';
import { getCfg, patchCfg, toggle } from '../services/config';
import { COLORS, panel } from '../ui';

const DEF = { enabled: true, xpMin: 15, xpMax: 25, cooldownS: 60, announce: true, announceChannelId: null as string | null, excludedChannels: [] as string[], excludedRoles: [] as string[], multiplier: 1 };
const lastXp = new Map<string, number>();

async function applyAutorank(member: GuildMember, level: number) {
  const rows = (await pool.query('SELECT level, role_id FROM autorank_rewards WHERE guild_id=$1', [member.guild.id])).rows as { level: number; role_id: string }[];
  const add = rows.filter((r) => r.level <= level).map((r) => r.role_id).filter((id) => !member.roles.cache.has(id) && member.guild.roles.cache.get(id)?.editable);
  const rem = rows.filter((r) => r.level > level).map((r) => r.role_id).filter((id) => member.roles.cache.has(id) && member.guild.roles.cache.get(id)?.editable);
  if (add.length) await member.roles.add(add, 'Auto rank').catch(() => {});
  if (rem.length) await member.roles.remove(rem, 'Auto rank (level lowered)').catch(() => {});
}

async function getRow(gid: string, uid: string) {
  const r = await pool.query('SELECT xp, level FROM user_levels WHERE guild_id=$1 AND user_id=$2', [gid, uid]);
  return { xp: Number(r.rows[0]?.xp ?? 0), level: Number(r.rows[0]?.level ?? 0) };
}
async function setXp(gid: string, uid: string, xp: number, level: number) {
  await pool.query(`INSERT INTO user_levels (guild_id, user_id, xp, level) VALUES ($1,$2,$3,$4)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET xp=EXCLUDED.xp, level=EXCLUDED.level, updated_at=now()`, [gid, uid, xp, level]);
}

async function rankReply(ctx: any, user: any) {
  const c = await getCfg(ctx.guild.id, 'levels', DEF);
  const { xp, level } = await getRow(ctx.guild.id, user.id);
  const base = xpForLevel(level, c.multiplier), need = xpToNext(level, c.multiplier);
  const pos = (await pool.query('SELECT count(*)::int n FROM user_levels WHERE guild_id=$1 AND xp > $2', [ctx.guild.id, xp])).rows[0].n + 1;
  const file = await card({ title: user.username, subtitle: `Level ${level} · Rank #${pos}`, detail: `${xp - base} / ${need} XP`, avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256 }), progress: (xp - base) / need });
  if (file) return ctx.reply({ files: [file] });
  return ctx.reply(panel(user.username, `Level **${level}** · Rank **#${pos}**\n${xp - base} / ${need} XP`));
}
const optUser = { name: 'user', type: 'user', description: 'Member', required: false } as const;
const rank: CommandDef = { name: 'rank', description: 'Show a rank card', module: null, args: [optUser], async run(ctx) { await rankReply(ctx, (await ctx.user('user')) ?? ctx.member.user); } };

const leaderboard: CommandDef = { name: 'leaderboard', description: 'XP leaderboard', module: null,
  async run(ctx) {
    const r = await pool.query('SELECT user_id, xp, level FROM user_levels WHERE guild_id=$1 ORDER BY xp DESC LIMIT 10', [ctx.guild.id]);
    await ctx.reply(panel('Leaderboard', r.rows.map((x, i) => `**${i + 1}.** <@${x.user_id}> — level ${x.level} · ${x.xp} XP`).join('\n') || '_No data yet._'));
  } };

const U = { name: 'user', type: 'user', description: 'Member' } as const;
const level: CommandDef = {
  name: 'level', description: 'Levels', module: 'levels', defaultSub: 'me',
  subs: {
    me: { description: 'Your rank card', module: null, args: [optUser] },
    set: { description: "Set a member's level", args: [U, { name: 'level', type: 'int', description: '0–500' }] },
    reset: { description: "Reset a member's XP", args: [U] },
    config: { description: 'Show settings' },
    'config xp': { description: 'XP per message', args: [{ name: 'min', type: 'int', description: 'Min' }, { name: 'max', type: 'int', description: 'Max' }] },
    'config cooldown': { description: 'Seconds between XP awards', args: [{ name: 'seconds', type: 'int', description: '0–3600' }] },
    'config announce': { description: 'Level-up messages', args: [{ name: 'value', type: 'string', description: 'on/off', choices: ['on', 'off'] }] },
    'config multiplier': { description: 'Level curve multiplier (percent)', args: [{ name: 'percent', type: 'int', description: '25–400' }] },
    'config exclude channel': { description: 'Toggle excluded channel', args: [{ name: 'channel', type: 'channel', description: 'Channel' }] },
    'config exclude role': { description: 'Toggle excluded role', args: [{ name: 'role', type: 'role', description: 'Role' }] },
  },
  async run(ctx) {
    const gid = ctx.guild.id, by = ctx.member.id;
    const c = await getCfg(gid, 'levels', DEF);
    const ok = (t: string) => ctx.reply(panel('Levels', t, 'ok'));
    const bad = (t: string) => ctx.reply(panel('Invalid', t, 'error'), true);
    switch (ctx.sub) {
      case 'me': return rankReply(ctx, (await ctx.user('user')) ?? ctx.member.user);
      case 'set': {
        const u = (await ctx.user('user'))!, l = ctx.int('level')!;
        if (l < 0 || l > 500) return bad('Level must be 0–500.');
        await setXp(gid, u.id, xpForLevel(l, c.multiplier), l);
        const m = await ctx.guild.members.fetch(u.id).catch(() => null); if (m) await applyAutorank(m, l);
        return ok(`<@${u.id}> is now level **${l}**.`);
      }
      case 'reset': {
        const u = (await ctx.user('user'))!;
        await setXp(gid, u.id, 0, 0);
        const m = await ctx.guild.members.fetch(u.id).catch(() => null); if (m) await applyAutorank(m, 0);
        return ok(`Reset <@${u.id}>.`);
      }
      case 'config xp': { const a = ctx.int('min')!, b = ctx.int('max')!; if (a < 1 || b < a || b > 500) return bad('Need 1 ≤ min ≤ max ≤ 500.'); await patchCfg(gid, 'levels', { xpMin: a, xpMax: b }, by); return ok(`XP per message: ${a}–${b}.`); }
      case 'config cooldown': { const s = ctx.int('seconds')!; if (s < 0 || s > 3600) return bad('Use 0–3600.'); await patchCfg(gid, 'levels', { cooldownS: s }, by); return ok(`Cooldown: ${s}s.`); }
      case 'config announce': await patchCfg(gid, 'levels', { announce: ctx.str('value')!.toLowerCase() === 'on' }, by); return ok('Updated.');
      case 'config multiplier': { const p = ctx.int('percent')!; if (p < 25 || p > 400) return bad('Use 25–400.'); await patchCfg(gid, 'levels', { multiplier: p / 100 }, by); return ok(`Curve multiplier: ${p}%. Existing levels recompute on next XP gain.`); }
      case 'config exclude channel': { const ch = ctx.channel('channel')!; await patchCfg(gid, 'levels', { excludedChannels: toggle(c.excludedChannels, ch.id) }, by); return ok('Toggled excluded channel.'); }
      case 'config exclude role': { const r = ctx.role('role')!; await patchCfg(gid, 'levels', { excludedRoles: toggle(c.excludedRoles, r.id) }, by); return ok('Toggled excluded role.'); }
      default: return ctx.reply(panel('Level settings', `XP: ${c.xpMin}–${c.xpMax} per message · cooldown ${c.cooldownS}s · curve ×${c.multiplier}\nAnnounce: ${c.announce}\nExcluded channels: ${c.excludedChannels.map((i) => `<#${i}>`).join(' ') || '_none_'}\nExcluded roles: ${c.excludedRoles.map((i) => `<@&${i}>`).join(' ') || '_none_'}`));
    }
  },
};

const autorank: CommandDef = {
  name: 'autorank', description: 'Role rewards for levels', module: 'levels', defaultSub: 'list',
  subs: {
    add: { description: 'Reward a role at a level', args: [{ name: 'level', type: 'int', description: 'Level (1–500)' }, { name: 'role', type: 'role', description: 'Role' }] },
    remove: { description: 'Remove a reward', args: [{ name: 'level', type: 'int', description: 'Level' }] },
    list: { description: 'List rewards' },
  },
  async run(ctx) {
    const gid = ctx.guild.id;
    if (ctx.sub === 'add') {
      const l = ctx.int('level')!, r = ctx.role('role')!;
      if (l < 1 || l > 500) return ctx.reply(panel('Invalid', 'Level must be 1–500.', 'error'), true);
      if (r.id === gid || r.managed || !r.editable) return ctx.reply(panel('Cannot use role', 'That role is managed, @everyone, or above my highest role.', 'error'), true);
      await pool.query('INSERT INTO autorank_rewards (guild_id, level, role_id) VALUES ($1,$2,$3) ON CONFLICT (guild_id, level) DO UPDATE SET role_id=EXCLUDED.role_id', [gid, l, r.id]);
      return ctx.reply(panel('Auto rank', `Level **${l}** → <@&${r.id}>.`, 'ok'));
    }
    if (ctx.sub === 'remove') {
      const r = await pool.query('DELETE FROM autorank_rewards WHERE guild_id=$1 AND level=$2', [gid, ctx.int('level')]);
      return ctx.reply(panel('Auto rank', r.rowCount ? 'Reward removed.' : 'No reward at that level.', r.rowCount ? 'ok' : 'info'));
    }
    const r = await pool.query('SELECT level, role_id FROM autorank_rewards WHERE guild_id=$1 ORDER BY level', [gid]);
    return ctx.reply(panel('Auto rank rewards', r.rows.map((x) => `Level **${x.level}** → <@&${x.role_id}>`).join('\n') || '_None_'));
  },
};

const joinrole: CommandDef = {
  name: 'joinrole', description: 'Roles given to new members', module: 'levels', defaultSub: 'list',
  subs: { add: { description: 'Add a join role', args: [{ name: 'role', type: 'role', description: 'Role' }] }, remove: { description: 'Remove a join role', args: [{ name: 'role', type: 'role', description: 'Role' }] }, list: { description: 'List join roles' } },
  async run(ctx) {
    const c = await getCfg(ctx.guild.id, 'joinroles', { roleIds: [] as string[] });
    if (ctx.sub === 'list') return ctx.reply(panel('Join roles', c.roleIds.map((r) => `<@&${r}>`).join('\n') || '_None_'));
    const r = ctx.role('role')!;
    if (ctx.sub === 'add' && (r.id === ctx.guild.id || r.managed || !r.editable)) return ctx.reply(panel('Cannot use role', 'Managed, @everyone, or above my highest role.', 'error'), true);
    const has = c.roleIds.includes(r.id);
    const next = ctx.sub === 'add' ? [...new Set([...c.roleIds, r.id])] : c.roleIds.filter((x) => x !== r.id);
    if (has === (ctx.sub === 'add')) return ctx.reply(panel('Join roles', 'No change.'));
    await patchCfg(ctx.guild.id, 'joinroles', { roleIds: next }, ctx.member.id);
    return ctx.reply(panel('Join roles', 'Updated.', 'ok'));
  },
};
export const commands = [rank, leaderboard, level, autorank, joinrole];

export function init(client: Client) {
  client.on(Events.GuildMemberAdd, async (m) => {
    const c = await getCfg(m.guild.id, 'joinroles', { roleIds: [] as string[] });
    const ids = c.roleIds.filter((id) => m.guild.roles.cache.get(id)?.editable);
    if (ids.length) await m.roles.add(ids, 'Join role').catch(() => {});
  });
  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || !msg.inGuild() || !msg.member || !msg.content) return;
    const c = await getCfg(msg.guildId, 'levels', DEF);
    if (!c.enabled || c.excludedChannels.includes(msg.channelId) || msg.member.roles.cache.some((r) => c.excludedRoles.includes(r.id))) return;
    const k = `${msg.guildId}:${msg.author.id}`, now = Date.now();
    if (now - (lastXp.get(k) ?? 0) < c.cooldownS * 1000) return;
    lastXp.set(k, now);
    const gain = c.xpMin + Math.floor(Math.random() * (c.xpMax - c.xpMin + 1));
    const r = await pool.query(
      `INSERT INTO user_levels (guild_id, user_id, xp) VALUES ($1,$2,$3)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET xp = user_levels.xp + $3, updated_at = now() RETURNING xp, level`,
      [msg.guildId, msg.author.id, gain]);
    const xp = Number(r.rows[0].xp), old = Number(r.rows[0].level), now_l = levelFromXp(xp, c.multiplier);
    if (now_l === old) return;
    await pool.query('UPDATE user_levels SET level=$3 WHERE guild_id=$1 AND user_id=$2', [msg.guildId, msg.author.id, now_l]);
    await applyAutorank(msg.member, now_l);
    if (c.announce && now_l > old) {
      const ch: any = c.announceChannelId ? msg.guild.channels.cache.get(c.announceChannelId) : msg.channel;
      await ch?.send({ ...panel('Level up!', `<@${msg.author.id}> reached **level ${now_l}** 🎉`), allowedMentions: { parse: [] } }).catch(() => {});
    }
  });
}
