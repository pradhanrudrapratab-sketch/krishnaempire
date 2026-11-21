import { env } from '../../shared/env';
import { pool, tx, type Queryable } from '../db';
import { audit } from './audit';

const prefixCache = new Map<string, string>();

export async function ensureGuild(q: Queryable, guildId: string) {
  await q.query('INSERT INTO guild_config (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [guildId]);
}

export async function getPrefix(guildId: string): Promise<string> {
  const hit = prefixCache.get(guildId);
  if (hit) return hit;
  const r = await pool.query('SELECT prefix FROM prefixes WHERE guild_id=$1', [guildId]);
  const p: string = r.rows[0]?.prefix ?? env.DEFAULT_PREFIX;
  prefixCache.set(guildId, p);
  return p;
}

export async function setPrefix(guildId: string, prefix: string, actorId: string) {
  await tx(async (c) => {
    await ensureGuild(c, guildId);
    await c.query(
      `INSERT INTO prefixes (guild_id, prefix) VALUES ($1,$2)
       ON CONFLICT (guild_id) DO UPDATE SET prefix=EXCLUDED.prefix, updated_at=now()`,
      [guildId, prefix],
    );
    await audit(c, guildId, actorId, 'prefix.set', null, { prefix });
  });
  prefixCache.set(guildId, prefix); // effective immediately
}

export async function resetPrefix(guildId: string, actorId: string) {
  await tx(async (c) => {
    await c.query('DELETE FROM prefixes WHERE guild_id=$1', [guildId]);
    await audit(c, guildId, actorId, 'prefix.reset');
  });
  prefixCache.delete(guildId);
}
