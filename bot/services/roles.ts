import type { Overrides, SpecialRoleKind } from '../../shared/permissions/engine';
import { pool, tx } from '../db';
import { audit } from './audit';
import { ensureGuild } from './guilds';

export type SpecialRoles = Partial<Record<SpecialRoleKind, string>>;

export async function getSpecialRoles(guildId: string): Promise<SpecialRoles> {
  const r = await pool.query('SELECT kind, role_id FROM special_roles WHERE guild_id=$1', [guildId]);
  return Object.fromEntries(r.rows.map((x) => [x.kind, x.role_id]));
}

export async function setSpecialRole(guildId: string, kind: SpecialRoleKind, roleId: string, actorId: string) {
  await tx(async (c) => {
    await ensureGuild(c, guildId);
    await c.query(
      `INSERT INTO special_roles (guild_id, kind, role_id) VALUES ($1,$2,$3)
       ON CONFLICT (guild_id, kind) DO UPDATE SET role_id=EXCLUDED.role_id, updated_at=now()`,
      [guildId, kind, roleId],
    );
    await audit(c, guildId, actorId, 'role.setup', kind, { roleId });
  });
}

export async function removeSpecialRole(guildId: string, kind: SpecialRoleKind, actorId: string): Promise<boolean> {
  return tx(async (c) => {
    const r = await c.query('DELETE FROM special_roles WHERE guild_id=$1 AND kind=$2', [guildId, kind]);
    if (r.rowCount) await audit(c, guildId, actorId, 'role.remove', kind);
    return (r.rowCount ?? 0) > 0;
  });
}

export async function getOverrides(guildId: string): Promise<Overrides> {
  const r = await pool.query('SELECT kind, module, allowed FROM role_permissions WHERE guild_id=$1', [guildId]);
  const out: Overrides = {};
  for (const x of r.rows) (out[x.kind as SpecialRoleKind] ??= {})[x.module] = x.allowed;
  return out;
}

export async function setOverride(guildId: string, kind: SpecialRoleKind, module: string, allowed: boolean, actorId: string) {
  await tx(async (c) => {
    await ensureGuild(c, guildId);
    await c.query(
      `INSERT INTO role_permissions (guild_id, kind, module, allowed) VALUES ($1,$2,$3,$4)
       ON CONFLICT (guild_id, kind, module) DO UPDATE SET allowed=EXCLUDED.allowed`,
      [guildId, kind, module, allowed],
    );
    await audit(c, guildId, actorId, 'permission.set', kind, { module, allowed });
  });
}

export async function resetOverrides(guildId: string, kind: SpecialRoleKind, actorId: string) {
  await tx(async (c) => {
    await c.query('DELETE FROM role_permissions WHERE guild_id=$1 AND kind=$2', [guildId, kind]);
    await audit(c, guildId, actorId, 'permission.reset', kind);
  });
}
