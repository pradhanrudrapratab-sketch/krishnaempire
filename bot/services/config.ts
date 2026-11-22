// Generic per-module JSON config. The dashboard will read/write the same table.
import { pool } from '../db';
import { audit } from './audit';
import { ensureGuild } from './guilds';

const cache = new Map<string, { at: number; data: any }>();
const TTL = 5000; // short TTL so dashboard edits show up quickly

export async function getCfg<T extends object>(guildId: string, module: string, defaults: T): Promise<T> {
  const k = `${guildId}:${module}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return { ...defaults, ...hit.data };
  const r = await pool.query('SELECT data FROM module_config WHERE guild_id=$1 AND module=$2', [guildId, module]);
  const data = r.rows[0]?.data ?? {};
  cache.set(k, { at: Date.now(), data });
  return { ...defaults, ...data };
}

export async function patchCfg(guildId: string, module: string, patch: Record<string, unknown>, actorId: string) {
  await ensureGuild(pool, guildId);
  await pool.query(
    `INSERT INTO module_config (guild_id, module, data) VALUES ($1,$2,$3::text::jsonb)
     ON CONFLICT (guild_id, module) DO UPDATE SET data = module_config.data || EXCLUDED.data, updated_at = now()`,
    [guildId, module, JSON.stringify(patch)],
  );
  await audit(pool, guildId, actorId, `config.${module}`, null, patch);
  cache.delete(`${guildId}:${module}`);
}

export const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
