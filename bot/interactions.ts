import type { ButtonInteraction, GuildMember } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { env } from '../shared/env';

type Handler = (i: ButtonInteraction, member: GuildMember, args: string[]) => Promise<void>;
const handlers = new Map<string, Handler>();

/** customId format: "<namespace>:<action>:<arg>..." — stateless, so buttons survive restarts. */
export const onButton = (ns: string, h: Handler) => void handlers.set(ns, h);

export async function routeButton(i: ButtonInteraction) {
  if (i.guildId !== env.GUILD_ID || !i.guild) return;
  const [ns, ...args] = i.customId.split(':');
  const h = handlers.get(ns);
  if (!h) return;
  try {
    // i.member is always the clicker; handlers must never act on anyone else.
    const member = (await i.guild.members.fetch(i.user.id)) as GuildMember;
    await h(i, member, args);
  } catch (e) {
    console.error(`[button:${ns}]`, e);
    const body = { content: 'Something went wrong.', flags: MessageFlags.Ephemeral } as any;
    await (i.replied || i.deferred ? i.followUp(body) : i.reply(body)).catch(() => {});
  }
}
