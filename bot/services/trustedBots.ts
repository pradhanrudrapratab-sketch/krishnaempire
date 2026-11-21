import { pool, tx } from '../db';
import { audit } from './audit';
import { ensureGuild } from './guilds';

export async function addTrustedBot(guildId: string, botId: string, actorId: string): Promise<boolean> {
  return tx(async (c) => {
    await ensureGuild(c, guildId);
    const r = await c.query(
      'INSERT INTO trusted_bots (guild_id, bot_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [guildId, botId, actorId],
    );
    if (r.rowCount) await audit(c, guildId, actorId, 'trustedbot.add', botId);
    return (r.rowCount ?? 0) > 0;
  });
}

export async function removeTrustedBot(guildId: string, botId: string, actorId: string): Promise<boolean> {
  return tx(async (c) => {
    const r = await c.query('DELETE FROM trusted_bots WHERE guild_id=$1 AND bot_id=$2', [guildId, botId]);
    if (r.rowCount) await audit(c, guildId, actorId, 'trustedbot.remove', botId);
    return (r.rowCount ?? 0) > 0;
  });
}

export async function listTrustedBots(guildId: string) {
  const r = await pool.query('SELECT bot_id, added_by, added_at FROM trusted_bots WHERE guild_id=$1 ORDER BY added_at', [guildId]);
  return r.rows as { bot_id: string; added_by: string; added_at: Date }[];
}

export async function isTrustedBot(guildId: string, botId: string) {
  const r = await pool.query('SELECT 1 FROM trusted_bots WHERE guild_id=$1 AND bot_id=$2', [guildId, botId]);
  return (r.rowCount ?? 0) > 0;
}

export async function addTrustedUser(guildId: string, userId: string, actorId: string): Promise<boolean> {
  return tx(async (c) => {
    await ensureGuild(c, guildId);
    const r = await c.query('INSERT INTO trusted_users (guild_id, user_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [guildId, userId, actorId]);
    if (r.rowCount) await audit(c, guildId, actorId, 'trusteduser.add', userId);
    return (r.rowCount ?? 0) > 0;
  });
}
export async function removeTrustedUser(guildId: string, userId: string, actorId: string): Promise<boolean> {
  return tx(async (c) => {
    const r = await c.query('DELETE FROM trusted_users WHERE guild_id=$1 AND user_id=$2', [guildId, userId]);
    if (r.rowCount) await audit(c, guildId, actorId, 'trusteduser.remove', userId);
    return (r.rowCount ?? 0) > 0;
  });
}
export async function listTrustedUsers(guildId: string) {
  return (await pool.query('SELECT user_id FROM trusted_users WHERE guild_id=$1', [guildId])).rows.map((r) => r.user_id as string);
}
export async function isTrustedUser(guildId: string, userId: string) {
  return ((await pool.query('SELECT 1 FROM trusted_users WHERE guild_id=$1 AND user_id=$2', [guildId, userId])).rowCount ?? 0) > 0;
}
