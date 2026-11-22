import type { Queryable } from '../db';

export async function audit(
  q: Queryable,
  guildId: string,
  actorId: string,
  action: string,
  target: string | null = null,
  details: Record<string, unknown> = {},
) {
  await q.query('INSERT INTO audit_log (guild_id, actor_id, action, target, details) VALUES ($1,$2,$3,$4,$5::text::jsonb)', [
    guildId, actorId, action, target, JSON.stringify(details),
  ]);
}
