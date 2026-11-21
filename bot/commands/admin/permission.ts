import {
  GRANTABLE_MODULES, SPECIAL_ROLE_KINDS, effectiveModules, type SpecialRoleKind,
} from '../../../shared/permissions/engine';
import type { CommandDef } from '../../framework';
import { getOverrides, resetOverrides, setOverride } from '../../services/roles';
import { panel } from '../../ui';

const kindArg = { name: 'type', type: 'string', description: 'Special role type', choices: SPECIAL_ROLE_KINDS } as const;

export const permission: CommandDef = {
  name: 'permission',
  description: 'Customize which modules each special role can use',
  module: 'permissions', // owner-only
  defaultSub: 'view',
  subs: {
    view: { description: 'Show effective module access', args: [{ ...kindArg, required: false }] },
    set: {
      description: 'Allow or deny a module for a role type',
      args: [kindArg, { name: 'module', type: 'string', description: 'Module id' }, { name: 'action', type: 'string', description: 'allow or deny', choices: ['allow', 'deny'] }],
    },
    reset: { description: 'Reset a role type to defaults', args: [kindArg] },
  },
  async run(ctx) {
    const gid = ctx.guild.id;
    const overrides = await getOverrides(gid);
    if (ctx.sub === 'view') {
      const one = ctx.str('type')?.toLowerCase() as SpecialRoleKind | undefined;
      const kinds = one ? [one] : [...SPECIAL_ROLE_KINDS];
      const lines = kinds.map((k) => `**${k}**: ${effectiveModules(k, overrides).join(', ') || '_none_'}`);
      return ctx.reply(panel('Permissions', lines.join('\n') + '\n\n_Owner-only (never grantable): roles, permissions, trustedbots_'));
    }
    const kind = ctx.str('type')!.toLowerCase() as SpecialRoleKind;
    if (ctx.sub === 'reset') {
      await resetOverrides(gid, kind, ctx.member.id);
      return ctx.reply(panel('Permissions', `**${kind}** reset to defaults.`, 'ok'));
    }
    const module = ctx.str('module')!.toLowerCase();
    if (!GRANTABLE_MODULES.includes(module))
      return ctx.reply(panel('Invalid module', `Grantable modules: ${GRANTABLE_MODULES.join(', ')}`, 'error'), true);
    const allowed = ctx.str('action')!.toLowerCase() === 'allow';
    await setOverride(gid, kind, module, allowed, ctx.member.id);
    return ctx.reply(panel('Permissions', `**${kind}** → \`${module}\`: **${allowed ? 'allowed' : 'denied'}**`, 'ok'));
  },
};
