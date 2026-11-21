import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { env } from '../shared/env';
import { pool } from './db';
import { registerEvents } from './events';

// Only the intents Phase 1–2 need. Message Content is privileged: enable it in the Developer Portal.
// Privileged intents to enable in the Developer Portal: Server Members, Message Content.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildInvites, GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.GuildMember], // so deletes/edits/leaves of uncached items are still logged
});

await pool.query('SELECT 1'); // fail fast if the DB is unreachable
registerEvents(client);

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
const shutdown = async () => {
  await client.destroy();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await client.login(env.BOT_TOKEN);
