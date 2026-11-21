import { commands } from '..';
import type { CommandDef } from '../../framework';
import { panel } from '../../ui';

export const help: CommandDef = {
  name: 'help',
  description: 'List available commands',
  module: null,
  async run(ctx) {
    const lines = commands.map((c) => `**${ctx.prefix}${c.name}** — ${c.description}`);
    await ctx.reply(panel('Commands', lines.join('\n') + `\n\nPrefix: \`${ctx.prefix}\` · Slash commands: \`/\``));
  },
};
