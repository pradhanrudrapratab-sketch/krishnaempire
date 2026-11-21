import { pool } from '../../db';
import type { CommandDef } from '../../framework';
import { panel } from '../../ui';

const optUser = { name: 'user', type: 'user', description: 'Member', required: false } as const;

export const serverinfo: CommandDef = {
  name: 'serverinfo', description: 'Server information', module: null,
  async run(ctx) {
    const g = ctx.guild;
    await ctx.reply(panel(g.name, `Owner: <@${g.ownerId}>\nMembers: **${g.memberCount}**\nChannels: ${g.channels.cache.size} · Roles: ${g.roles.cache.size}\nBoost tier: ${g.premiumTier}\nCreated: <t:${Math.floor(g.createdTimestamp / 1000)}:D>`));
  },
};

export const userinfo: CommandDef = {
  name: 'userinfo', description: 'User information', module: null, args: [optUser],
  async run(ctx) {
    const u = (await ctx.user('user')) ?? ctx.member.user;
    const m = await ctx.guild.members.fetch(u.id).catch(() => null);
    await ctx.reply(panel(u.tag, `ID: ${u.id}\nBot: ${u.bot ? 'yes' : 'no'}\nCreated: <t:${Math.floor(u.createdTimestamp / 1000)}:R>\n${m ? `Joined: <t:${Math.floor((m.joinedTimestamp ?? 0) / 1000)}:R>\nTop role: <@&${m.roles.highest.id}>` : 'Not in this server'}`));
  },
};

export const status: CommandDef = {
  name: 'status', description: 'Member statistics', module: null,
  async run(ctx) {
    const g = ctx.guild;
    const members = await g.members.fetch();
    const bots = members.filter((m) => m.user.bot).size;
    const r = await pool.query(
      `SELECT (count(*) FILTER (WHERE joined_at > now() - interval '7 days'))::int joins,
              (count(*) FILTER (WHERE left_at > now() - interval '7 days'))::int leaves FROM invite_tracking WHERE guild_id=$1`, [g.id]);
    await ctx.reply(panel('Member status', `Total: **${g.memberCount}**\nHumans: ${members.size - bots} · Bots: ${bots}\nLast 7 days: +${r.rows[0].joins} / −${r.rows[0].leaves}\n_Online counts need the Presence intent, which is not enabled._`));
  },
};
