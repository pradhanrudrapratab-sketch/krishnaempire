import type { CommandDef, Ctx } from '../framework';
import { audit } from '../services/audit';
import { pool } from '../db';
import { panel } from '../ui';

const RE = /<(a?):(\w{2,32}):(\d{17,20})>/;
const LIMIT: Record<string, number> = { '0': 50, '1': 100, '2': 150, '3': 250 }; // per static/animated

async function steal(ctx: Ctx) {
  const m = ctx.str('emoji')?.match(RE);
  if (!m) return ctx.reply(panel('Invalid emoji', 'Provide a custom emoji like `<:name:id>`. Default Unicode emojis cannot be imported.', 'error'), true);
  const [, anim, orig, eid] = m;
  const name = (ctx.str('name') || orig).replace(/\W/g, '_').slice(0, 32).padEnd(2, '_');
  const cap = LIMIT[String(ctx.guild.premiumTier)] ?? 50;
  const used = ctx.guild.emojis.cache.filter((e) => !!e.animated === !!anim).size;
  if (used >= cap) return ctx.reply(panel('No emoji slots', `This server has used ${used}/${cap} ${anim ? 'animated' : 'static'} emoji slots.`, 'error'), true);
  const url = `https://cdn.discordapp.com/emojis/${eid}.${anim ? 'gif' : 'png'}?size=128`;
  try {
    const e = await ctx.guild.emojis.create({ attachment: url, name, reason: `Steal by ${ctx.member.user.tag}` });
    await audit(pool, ctx.guild.id, ctx.member.id, 'emoji.steal', e.id, { name });
    await ctx.reply({ ...panel('Emoji added', `${e.toString()} \`:${e.name}:\` (${used + 1}/${cap})`, 'ok') });
  } catch (err) {
    console.error('[emoji]', err);
    await ctx.reply(panel('Failed', 'Could not add the emoji (file too large, or I lack Manage Expressions).', 'error'), true);
  }
}
const args = [{ name: 'emoji', type: 'string', description: 'Custom emoji' }, { name: 'name', type: 'string', description: 'New name', required: false }] as const;

export const stealCmd: CommandDef = { name: 'steal', description: 'Import a custom emoji', module: 'emoji', args: [...args], run: steal };
export const emojiCmd: CommandDef = {
  name: 'emoji', description: 'Emoji tools', module: 'emoji', defaultSub: 'list',
  subs: { steal: { description: 'Import a custom emoji', args: [...args] }, list: { description: 'List server emojis' } },
  async run(ctx) {
    if (ctx.sub === 'steal') return steal(ctx);
    const e = ctx.guild.emojis.cache;
    await ctx.reply(panel(`Emojis (${e.size})`, e.map((x) => x.toString()).join(' ').slice(0, 3900) || '_None_'));
  },
};
export const commands = [stealCmd, emojiCmd];
