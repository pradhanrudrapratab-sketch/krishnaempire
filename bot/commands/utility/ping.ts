import type { CommandDef } from '../../framework';
import { panel } from '../../ui';

export const ping: CommandDef = {
  name: 'ping',
  description: 'Check bot latency',
  module: null,
  async run(ctx) {
    await ctx.reply(panel('Pong', `Gateway latency: **${ctx.guild.client.ws.ping} ms**`));
  },
};
