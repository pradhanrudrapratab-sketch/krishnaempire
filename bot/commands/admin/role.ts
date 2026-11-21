import { SPECIAL_ROLE_KINDS, type SpecialRoleKind } from '../../../shared/permissions/engine';
import type { CommandDef } from '../../framework';
import { getSpecialRoles, removeSpecialRole, setSpecialRole } from '../../services/roles';
import { panel } from '../../ui';

const kindArg = { name: 'type', type: 'string', description: 'Role type', choices: SPECIAL_ROLE_KINDS } as const;

export const role: CommandDef = {
  name: 'role',
  description: 'Configure the Admin, Mod and Anti-Nuke roles',
  module: 'roles', // owner-only
  defaultSub: 'view',
  subs: {
    setup: { description: 'Assign a role to a special role type', args: [kindArg, { name: 'role', type: 'role', description: 'Discord role' }] },
    view: { description: 'Show configured special roles' },
    remove: { description: 'Unassign a special role type', args: [kindArg] },
  },
  async run(ctx) {
    const gid = ctx.guild.id;
    if (ctx.sub === 'view') {
      const r = await getSpecialRoles(gid);
      const lines = SPECIAL_ROLE_KINDS.map((k) => `**${k}** → ${r[k] ? `<@&${r[k]}>` : '_not set_'}`);
      return ctx.reply(panel('Special roles', `**owner** → <@${process.env.OWNER_ID}> _(permanent)_\n${lines.join('\n')}`));
    }
    const kind = ctx.str('type')!.toLowerCase() as SpecialRoleKind;
    if (ctx.sub === 'remove') {
      const ok = await removeSpecialRole(gid, kind, ctx.member.id);
      return ctx.reply(panel('Special roles', ok ? `Removed **${kind}** role.` : `**${kind}** was not set.`, ok ? 'ok' : 'info'));
    }
    const r = ctx.role('role')!;
    if (r.id === ctx.guild.id) return ctx.reply(panel('Invalid role', '@everyone cannot be a special role.', 'error'), true);
    if (r.managed) return ctx.reply(panel('Invalid role', 'Bot/integration-managed roles cannot be used.', 'error'), true);
    await setSpecialRole(gid, kind, r.id, ctx.member.id);
    return ctx.reply(panel('Special roles', `**${kind}** is now <@&${r.id}>.`, 'ok'));
  },
};
