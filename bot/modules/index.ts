import type { Client } from 'discord.js';
import * as antinuke from './antinuke';
import * as automod from './automod';
import * as autoresponder from './autoresponder';
import * as emoji from './emoji';
import * as greet from './greet';
import * as honeypot from './honeypot';
import * as invites from './invites';
import * as levels from './levels';
import * as logs from './logs';
import * as moderation from './moderation';
import * as music from './music';
import * as tickets from './tickets';
import * as verification from './verification';
import * as voice from './voice';
import * as youtube from './youtube';

export const modules = [greet, logs, invites, moderation, automod, antinuke, honeypot, verification, levels, autoresponder, emoji, voice, tickets, youtube, music];
export const moduleCommands = modules.flatMap((m) => m.commands);
export function initModules(client: Client) {
  for (const m of modules) if ('init' in m) (m as any).init(client);
}
