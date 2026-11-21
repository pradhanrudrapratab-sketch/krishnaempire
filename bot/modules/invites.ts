import { Events, type Client, type Guild, type GuildMember } from 'discord.js';
import { pool } from '../db';
import type { CommandDef } from '../framework';
import { logEvent } from '../services/logs';
import { COLORS, logEmbed, panel } from '../ui';

interface Snap { uses: number; max: number; inviter: string | null }
const cache = new Map<string, Map<string, Snap>>();
const queue = new Map<string, Promise<unknown>>();

async function snapshot(guild: Guild) {
  const inv = await guild.invites.fetch().catch(() => null);
  if (!inv) return null;
  const m = new Map<string, Snap>();
  inv.forEach((i) => m.set(i.code, { uses: i.uses ?? 0, max: i.maxUses ?? 0, inviter: i.inviterId }));
  return m;
}

async function onJoin(member: GuildMember) {
  const g = member.guild;
  const before = cache.get(g.id) ?? new Map<string, Snap>();
  const after = await snapshot(g);
  let source = 'unknown', code: string | null = null, inviter: string | null = null;
  if (after) {
    const used = [...after].filter(([c, s]) => s.uses > (before.get(c)?.uses ?? 0));
    // An invite that hit max uses is deleted by Discord; infer it from the previous snapshot.
    for (const [c, s] of before) if (!after.has(c) && s.max > 0 && s.uses + 1 === s.max) used.push([c, s]);
    if (used.length === 1) { [code] = used[0]; inviter = used[0][1].inviter; source = 'invite'; }
    else if (used.length === 0 && g.vanityURLCode) source = 'vanity';
    // used.length > 1 → ambiguous (concurrent joins): recorded as unknown rather than guessed.
    cache.set(g.id, after);
  }
  const suspicious = Date.now() - member.user.createdTimestamp < 7 * 86400_000;
  await pool.query(
    'INSERT INTO invite_tracking (guild_id, member_id, inviter_id, code, source, suspicious) VALUES ($1,$2,$3,$4,$5,$6)',
    [g.id, member.id, inviter, code, source, suspicious],
  );
  await logEvent(g, 'join', logEmbed('Member joined', `<@${member.id}> · invited by ${inviter ? `<@${inviter}>` : source} ${code ? `(\`${code}\`)` : ''}${suspicious ? '\n⚠️ Account is under 7 days old' : ''}`, COLORS.accent));
}

const stats = async (gid: string, uid: string) => {
  const r = await pool.query(
    `SELECT count(*)::int total, (count(*) FILTER (WHERE left_at IS NOT NULL))::int left, (count(*) FILTER (WHERE suspicious))::int fake
     FROM invite_tracking WHERE guild_id=$1 AND inviter_id=$2 AND counted`, [gid, uid]);
  return r.rows[0] as { total: number; left: number; fake: number };
};
const fmt = (s: { total: number; left: number; fake: number }) =>
  `**${s.total - s.left - s.fake}** active · ${s.total} joins · ${s.left} left · ${s.fake} suspicious`;

export const inviteCommand: CommandDef = {
  name: 'invite', description: 'Invite statistics', module: null, defaultSub: 'me',
  subs: {
    me: { description: 'Your invite stats' },
    info: { description: "A member's invite stats", args: [{ name: 'user', type: 'user', description: 'Member' }] },
    leaderboard: { description: 'Top inviters' },
    reset: { description: "Reset a member's invite count", module: 'invites', args: [{ name: 'user', type: 'user', description: 'Member' }] },
  },
  async run(ctx) {
    const gid = ctx.guild.id;
    if (ctx.sub === 'me') return ctx.reply(panel('Your invites', fmt(await stats(gid, ctx.member.id))));
    if (ctx.sub === 'leaderboard') {
      const r = await pool.query(
        `SELECT inviter_id, (count(*) FILTER (WHERE left_at IS NULL AND NOT suspicious))::int active FROM invite_tracking
         WHERE guild_id=$1 AND inviter_id IS NOT NULL AND counted GROUP BY inviter_id ORDER BY active DESC LIMIT 10`, [gid]);
      return ctx.reply(panel('Invite leaderboard', r.rows.map((x, i) => `${i + 1}. <@${x.inviter_id}> — ${x.active}`).join('\n') || '_No data yet._'));
    }
    const u = (await ctx.user('user'))!;
    if (ctx.sub === 'reset') {
      await pool.query('UPDATE invite_tracking SET counted=false WHERE guild_id=$1 AND inviter_id=$2', [gid, u.id]);
      return ctx.reply(panel('Invites', `Reset invite count for <@${u.id}>.`, 'ok'));
    }
    const by = await pool.query('SELECT inviter_id, source FROM invite_tracking WHERE guild_id=$1 AND member_id=$2 ORDER BY joined_at DESC LIMIT 1', [gid, u.id]);
    const b = by.rows[0];
    return ctx.reply(panel('Invite info', `${fmt(await stats(gid, u.id))}\nInvited by: ${b ? (b.inviter_id ? `<@${b.inviter_id}>` : b.source) : '_unknown_'}`));
  },
};
export const commands = [inviteCommand];

export function init(client: Client) {
  client.once(Events.ClientReady, async (c) => {
    for (const g of c.guilds.cache.values()) { const s = await snapshot(g); if (s) cache.set(g.id, s); }
  });
  client.on(Events.InviteCreate, (i) => {
    if (!i.guild) return;
    const m = cache.get(i.guild.id) ?? new Map();
    m.set(i.code, { uses: i.uses ?? 0, max: i.maxUses ?? 0, inviter: i.inviterId });
    cache.set(i.guild.id, m);
    void logEvent(i.guild as Guild, 'invite', logEmbed('Invite created', `\`${i.code}\` by ${i.inviterId ? `<@${i.inviterId}>` : 'unknown'}`));
  });
  client.on(Events.InviteDelete, (i) => cache.get(i.guild?.id ?? '')?.delete(i.code));
  client.on(Events.GuildMemberAdd, (m) => {
    // Serialize per guild so concurrent joins don't read each other's snapshot.
    const job = (queue.get(m.guild.id) ?? Promise.resolve()).then(() => onJoin(m)).catch((e) => console.error('[invites]', e));
    queue.set(m.guild.id, job);
  });
  client.on(Events.GuildMemberRemove, (m) =>
    void pool.query(
      `UPDATE invite_tracking SET left_at=now() WHERE id = (SELECT id FROM invite_tracking WHERE guild_id=$1 AND member_id=$2 AND left_at IS NULL ORDER BY joined_at DESC LIMIT 1)`,
      [m.guild.id, m.id]).catch(() => {}));
}
