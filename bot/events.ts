import { Events, REST, Routes, type Client, type GuildMember } from 'discord.js';
import { env } from '../shared/env';
import { pool } from './db';
import { handlePrefix, handleSlash, slashBodies } from './framework';
import { routeButton } from './interactions';
import { initModules } from './modules';
import { ensureGuild, getPrefix } from './services/guilds';

async function memberOf(guild: import('discord.js').Guild, userId: string): Promise<GuildMember | null> {
  return guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
}

export function registerEvents(client: Client) {
  initModules(client);
  client.once(Events.ClientReady, async (c) => {
    const guild = await c.guilds.fetch(env.GUILD_ID).catch(() => null);
    if (!guild) {
      console.error(`Bot is not a member of GUILD_ID ${env.GUILD_ID}. Invite it first.`);
      process.exit(1);
    }
    await ensureGuild(pool, guild.id);
    const rest = new REST().setToken(env.BOT_TOKEN);
    await rest.put(Routes.applicationGuildCommands(env.CLIENT_ID, env.GUILD_ID), { body: slashBodies() });
    console.log(`Ready as ${c.user.tag}; ${slashBodies().length} slash commands registered.`);
  });

  // Single-server bot: leave anywhere else.
  client.on(Events.GuildCreate, (g) => {
    if (g.id !== env.GUILD_ID) void g.leave();
  });

  client.on(Events.InteractionCreate, async (i) => {
    if (i.isButton()) return void (await routeButton(i));
    if (!i.isChatInputCommand() || i.guildId !== env.GUILD_ID || !i.guild) return;
    const member = await memberOf(i.guild, i.user.id);
    if (!member) return;
    await handleSlash(i, member, await getPrefix(i.guild.id));
  });

  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || !msg.inGuild() || msg.guildId !== env.GUILD_ID) return;
    const prefix = await getPrefix(msg.guildId);
    if (!msg.content.startsWith(prefix)) return;
    const member = msg.member ?? (await memberOf(msg.guild, msg.author.id));
    if (!member) return;
    await handlePrefix(msg, member, prefix);
  });

  client.on(Events.Error, (e) => console.error('[client]', e));
}
