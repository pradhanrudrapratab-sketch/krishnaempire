// One command definition -> slash command AND prefix command, same handler,
// same permission check. This is what keeps the interfaces in sync.
import {
  MessageFlags,
  SlashCommandBuilder,
  SlashCommandSubcommandGroupBuilder,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Message,
  type Role,
  type User,
} from 'discord.js';
import { commands } from './commands';
import { can } from './services/authority';
import { panel } from './ui';

export type ArgType = 'string' | 'role' | 'user' | 'rest' | 'channel' | 'int';
export interface ArgDef {
  name: string;
  type: ArgType;
  description: string;
  required?: boolean; // default true
  choices?: readonly string[];
}
export interface SubDef {
  description: string;
  /** undefined = inherit command module; null = public */
  module?: string | null;
  args?: ArgDef[];
}
export interface CommandDef {
  name: string;
  description: string;
  /** Permission module; null = public. */
  module: string | null;
  defaultSub?: string;
  /** Keys are "sub" or "group sub" (e.g. "bot add"). */
  subs?: Record<string, SubDef>;
  args?: ArgDef[];
  run(ctx: Ctx): Promise<void>;
}
export interface Ctx {
  guild: Guild;
  member: GuildMember;
  sub: string;
  prefix: string;
  raw(name: string): string | null;
  str(name: string): string | null;
  role(name: string): Role | null;
  user(name: string): Promise<User | null>;
  channel(name: string): any | null;
  int(name: string): number | null;
  /** The channel the command was run in. */
  here: any | null;
  /** Acknowledge a slow command (slash: deferReply; prefix: typing indicator). */
  defer(): Promise<void>;
  reply(o: string | BaseMessageOptions, ephemeral?: boolean): Promise<void>;
}

const ID = /\d{17,20}/;
const noPing = { parse: [] as never[] };

// ---------- slash registration ----------
function addArg(b: any, a: ArgDef) {
  const fn = ({ role: 'addRoleOption', user: 'addUserOption', channel: 'addChannelOption', int: 'addIntegerOption' } as Record<string, string>)[a.type] ?? 'addStringOption';
  b[fn]((o: any) => {
    o.setName(a.name).setDescription(a.description).setRequired(a.required !== false);
    if (a.choices && fn === 'addStringOption') o.addChoices(...a.choices.map((c) => ({ name: c, value: c })));
    return o;
  });
}

export function toSlash(cmd: CommandDef) {
  const b: any = new SlashCommandBuilder().setName(cmd.name).setDescription(cmd.description).setDMPermission(false);
  if (cmd.subs) {
    const groups = new Map<string, SlashCommandSubcommandGroupBuilder>();
    // Discord forbids a subcommand and a group sharing a name ("config" vs "config xp"): rename the plain one.
    const groupNames = new Set(Object.keys(cmd.subs).filter((k) => k.includes(' ')).map((k) => k.split(' ')[0]));
    for (const [key, def] of Object.entries(cmd.subs)) {
      const [first, second] = key.split(' ');
      const build = (s: any, name: string) => {
        s.setName(name).setDescription(def.description);
        def.args?.forEach((a) => addArg(s, a));
        return s;
      };
      if (second) {
        let g = groups.get(first);
        if (!g) groups.set(first, (g = new SlashCommandSubcommandGroupBuilder().setName(first).setDescription(`${first} commands`)));
        g.addSubcommand((s) => build(s, second));
      } else b.addSubcommand((s: any) => build(s, groupNames.has(first) ? `${first}-show` : first));
    }
    groups.forEach((g) => b.addSubcommandGroup(g));
  } else cmd.args?.forEach((a) => addArg(b, a));
  return b.toJSON();
}
export const slashBodies = () => commands.map(toSlash);

// ---------- shared execution ----------
function usage(cmd: CommandDef, ctx: Ctx, key: string) {
  const defs = cmd.subs?.[key]?.args ?? cmd.args ?? [];
  const a = defs.map((d) => (d.required === false ? `[${d.name}]` : `<${d.name}>`)).join(' ');
  return `${ctx.prefix}${cmd.name}${key ? ' ' + key : ''} ${a}`.trim();
}

async function execute(cmd: CommandDef, ctx: Ctx) {
  try {
    const key = ctx.sub;
    const sub = cmd.subs?.[key];
    if (cmd.subs && !sub) {
      const list = Object.keys(cmd.subs).map((k) => `\`${ctx.prefix}${cmd.name} ${k}\``).join('\n');
      return ctx.reply(panel('Usage', list), true);
    }
    const module = sub && sub.module !== undefined ? sub.module : cmd.module;
    if (!(await can(ctx.guild, ctx.member, module)))
      return ctx.reply(panel('Access denied', 'You are not authorized to use this command.', 'error'), true);

    for (const a of sub?.args ?? cmd.args ?? []) {
      const raw = ctx.raw(a.name);
      if (raw == null || raw === '') {
        if (a.required !== false) return ctx.reply(panel('Missing argument', `Usage: \`${usage(cmd, ctx, key)}\``, 'error'), true);
        continue;
      }
      if (a.choices && !a.choices.includes(raw.toLowerCase()))
        return ctx.reply(panel('Invalid value', `\`${a.name}\` must be one of: ${a.choices.join(', ')}`, 'error'), true);
      if (a.type === 'role' && !ctx.role(a.name)) return ctx.reply(panel('Invalid role', 'That role does not exist in this server.', 'error'), true);
      if (a.type === 'user' && !(await ctx.user(a.name))) return ctx.reply(panel('Invalid user', 'I could not find that user.', 'error'), true);
      if (a.type === 'channel' && !ctx.channel(a.name)) return ctx.reply(panel('Invalid channel', 'I could not find that channel.', 'error'), true);
      if (a.type === 'int' && ctx.int(a.name) === null) return ctx.reply(panel('Invalid number', `\`${a.name}\` must be a whole number.`, 'error'), true);
    }
    await cmd.run(ctx);
  } catch (err) {
    console.error(`[command:${cmd.name}]`, err);
    await ctx.reply(panel('Something went wrong', 'The error was logged. Please try again.', 'error'), true).catch(() => {});
  }
}

// ---------- slash entry ----------
export async function handleSlash(i: ChatInputCommandInteraction, member: GuildMember, prefix: string) {
  const cmd = commands.find((c) => c.name === i.commandName);
  if (!cmd || !i.guild) return;
  const group = i.options.getSubcommandGroup(false);
  const s = i.options.getSubcommand(false);
  const raw = (n: string) => {
    const v = i.options.get(n)?.value;
    return v == null ? null : String(v);
  };
  const ctx: Ctx = {
    guild: i.guild, member, prefix, sub: group ? `${group} ${s}` : ((s ?? '').endsWith('-show') && !cmd.subs?.[s ?? ''] ? (s as string).slice(0, -5) : (s ?? '')),
    raw, str: raw,
    role: (n) => { const r = raw(n); return r ? (i.guild!.roles.cache.get(r) ?? null) : null; },
    user: async (n) => i.options.getUser(n),
    channel: (n) => { const r = raw(n); return r ? (i.guild!.channels.cache.get(r) ?? null) : null; },
    int: (n) => { const r = raw(n); return r != null && /^-?\d+$/.test(r) ? Number(r) : null; },
    here: i.channel,
    defer: async () => { if (!i.deferred && !i.replied) await i.deferReply(); },
    reply: async (o, eph = false) => {
      const body: any = { ...(typeof o === 'string' ? { content: o } : o), allowedMentions: noPing };
      if (eph) body.flags = MessageFlags.Ephemeral;
      if (i.replied || i.deferred) await i.followUp(body);
      else await i.reply(body);
    },
  };
  await execute(cmd, ctx);
}

// ---------- prefix entry ----------
export async function handlePrefix(msg: Message<true>, member: GuildMember, prefix: string) {
  const tokens = [...msg.content.slice(prefix.length).trim().matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
  const cmd = commands.find((c) => c.name === tokens[0]?.toLowerCase());
  if (!cmd) return;
  let rest = tokens.slice(1);
  let sub = '';
  if (cmd.subs) {
    const keys = Object.keys(cmd.subs).sort((a, b) => b.split(' ').length - a.split(' ').length);
    const hit = keys.find((k) => rest.slice(0, k.split(' ').length).join(' ').toLowerCase() === k);
    if (hit) { sub = hit; rest = rest.slice(hit.split(' ').length); }
    else sub = cmd.defaultSub ?? '';
  }
  const defs = cmd.subs?.[sub]?.args ?? cmd.args ?? [];
  const values: Record<string, string> = {};
  let idx = 0;
  for (const a of defs) {
    if (a.type === 'rest') { values[a.name] = rest.slice(idx).join(' '); idx = rest.length; }
    else if (rest[idx] !== undefined) values[a.name] = rest[idx++];
  }
  const raw = (n: string) => values[n] ?? null;
  const ctx: Ctx = {
    guild: msg.guild, member, prefix, sub, raw, str: raw,
    role: (n) => { const id = values[n]?.match(ID)?.[0]; return id ? (msg.guild.roles.cache.get(id) ?? null) : null; },
    user: async (n) => { const id = values[n]?.match(ID)?.[0]; return id ? msg.client.users.fetch(id).catch(() => null) : null; },
    channel: (n) => { const id = values[n]?.match(ID)?.[0]; return id ? (msg.guild.channels.cache.get(id) ?? null) : null; },
    int: (n) => (values[n] != null && /^-?\d+$/.test(values[n]) ? Number(values[n]) : null),
    here: msg.channel,
    defer: async () => { await msg.channel.sendTyping().catch(() => {}); },
    reply: async (o) => { await msg.reply({ ...(typeof o === 'string' ? { content: o } : o), allowedMentions: { ...noPing, repliedUser: false } }); },
  };
  await execute(cmd, ctx);
}
