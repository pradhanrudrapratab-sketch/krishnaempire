import { validatePrefix } from '../../../shared/validators/prefix';
import type { CommandDef } from '../../framework';
import { env } from '../../../shared/env';
import { resetPrefix, setPrefix } from '../../services/guilds';
import { panel } from '../../ui';

export const prefix: CommandDef = {
  name: 'prefix',
  description: 'View or change the command prefix',
  module: 'prefix',
  defaultSub: 'view',
  subs: {
    view: { description: 'Show the active prefix', module: null },
    set: { description: 'Set a new prefix', args: [{ name: 'prefix', type: 'string', description: 'New prefix (1–3 characters)' }] },
    reset: { description: 'Reset the prefix to the default' },
  },
  async run(ctx) {
    const gid = ctx.guild.id;
    if (ctx.sub === 'view') return ctx.reply(panel('Prefix', `Active prefix: \`${ctx.prefix}\``));
    if (ctx.sub === 'set') {
      const p = ctx.str('prefix')!;
      const err = validatePrefix(p);
      if (err) return ctx.reply(panel('Invalid prefix', err, 'error'), true);
      await setPrefix(gid, p, ctx.member.id);
      return ctx.reply(panel('Prefix updated', `New prefix: \`${p}\``, 'ok'));
    }
    await resetPrefix(gid, ctx.member.id);
    return ctx.reply(panel('Prefix reset', `Prefix is now \`${env.DEFAULT_PREFIX}\``, 'ok'));
  },
};
