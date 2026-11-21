import { Events, type Client } from 'discord.js';
import { pool } from '../db';
import type { CommandDef } from '../framework';
import { can } from '../services/authority';
import { getCfg, patchCfg, toggle } from '../services/config';
import { logEvent } from '../services/logs';
import { COLORS, logEmbed, panel } from '../ui';

const DEF = { enabled: false, threshold: 3, timeoutMinutes: 10, exemptRoles: [] as string[], exemptChannels: [] as string[] };
const wordCache = new Map<string, { at: number; re: RegExp | null }>();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function matcher(gid: string): Promise<RegExp | null> {
  const hit = wordCache.get(gid);
  if (hit && Date.now() - hit.at < 10_000) return hit.re;
  const words = (await pool.query('SELECT word FROM bad_words WHERE guild_id=$1', [gid])).rows.map((r) => r.word as string);
  const re = words.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'iu') : null;
  wordCache.set(gid, { at: Date.now(), re });
  return re;
}

export const badword: CommandDef = {
  name: 'badword', description: 'Configure the bad-word filter', module: 'automod', defaultSub: 'config',
  subs: {
    add: { description: 'Add a blocked word', args: [{ name: 'word', type: 'string', description: 'Word' }] },
    remove: { description: 'Remove a blocked word', args: [{ name: 'word', type: 'string', description: 'Word' }] },
    list: { description: 'List blocked words' },
    enable: { description: 'Enable filter' }, disable: { description: 'Disable filter' },
    config: { description: 'Show settings' },
    'config threshold': { description: 'Violations (24h) before timeout', args: [{ name: 'count', type: 'int', description: '1–20' }] },
    'config timeout': { description: 'Timeout length in minutes', args: [{ name: 'minutes', type: 'int', description: '1–40320' }] },
    'exempt role': { description: 'Toggle an exempt role', args: [{ name: 'role', type: 'role', description: 'Role' }] },
    'exempt channel': { description: 'Toggle an exempt channel', args: [{ name: 'channel', type: 'channel', description: 'Channel' }] },
  },
  async run(ctx) {
    const gid = ctx.guild.id, by = ctx.member.id;
    const c = await getCfg(gid, 'automod', DEF);
    const ok = (t: string) => ctx.reply(panel('Bad-word filter', t, 'ok'));
    switch (ctx.sub) {
      case 'add': case 'remove': {
        const w = ctx.str('word')!.toLowerCase().slice(0, 60);
        if (ctx.sub === 'add') await pool.query('INSERT INTO bad_words (guild_id, word) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, w]);
        else await pool.query('DELETE FROM bad_words WHERE guild_id=$1 AND word=$2', [gid, w]);
        wordCache.delete(gid);
        return ctx.reply(panel('Bad-word filter', `Word ${ctx.sub === 'add' ? 'added' : 'removed'}.`, 'ok'), true); // ephemeral: don't echo the word publicly
      }
      case 'list': {
        const r = await pool.query('SELECT word FROM bad_words WHERE guild_id=$1 ORDER BY word', [gid]);
        return ctx.reply(panel('Blocked words', r.rows.map((x) => `||${x.word}||`).join(' ') || '_None_'), true);
      }
      case 'enable': await patchCfg(gid, 'automod', { enabled: true }, by); return ok('Enabled.');
      case 'disable': await patchCfg(gid, 'automod', { enabled: false }, by); return ok('Disabled.');
      case 'config threshold': { const n = ctx.int('count')!; if (n < 1 || n > 20) return ctx.reply(panel('Invalid', 'Use 1–20.', 'error'), true); await patchCfg(gid, 'automod', { threshold: n }, by); return ok(`Timeout after ${n} violations in 24h.`); }
      case 'config timeout': { const n = ctx.int('minutes')!; if (n < 1 || n > 40320) return ctx.reply(panel('Invalid', 'Use 1–40320.', 'error'), true); await patchCfg(gid, 'automod', { timeoutMinutes: n }, by); return ok(`Timeout length: ${n} min.`); }
      case 'exempt role': { const r = ctx.role('role')!; await patchCfg(gid, 'automod', { exemptRoles: toggle(c.exemptRoles, r.id) }, by); return ok(`Toggled exempt role <@&${r.id}>.`); }
      case 'exempt channel': { const ch = ctx.channel('channel')!; await patchCfg(gid, 'automod', { exemptChannels: toggle(c.exemptChannels, ch.id) }, by); return ok(`Toggled exempt channel <#${ch.id}>.`); }
      default:
        return ctx.reply(panel('Filter settings', `Enabled: ${c.enabled}\nThreshold: ${c.threshold} / 24h → ${c.timeoutMinutes} min timeout\nExempt roles: ${c.exemptRoles.map((r) => `<@&${r}>`).join(' ') || '_none_'}\nExempt channels: ${c.exemptChannels.map((r) => `<#${r}>`).join(' ') || '_none_'}`));
    }
  },
};
export const commands = [badword];

export function init(client: Client) {
  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || !msg.inGuild() || !msg.member || !msg.content) return;
    const c = await getCfg(msg.guildId, 'automod', DEF);
    if (!c.enabled || c.exemptChannels.includes(msg.channelId)) return;
    const re = await matcher(msg.guildId);
    if (!re || !re.test(msg.content)) return;
    if (msg.member.roles.cache.some((r) => c.exemptRoles.includes(r.id)) || (await can(msg.guild, msg.member, 'automod'))) return;
    await msg.delete().catch(() => {});
    await pool.query('INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES ($1,$2,$3,$4)', [msg.guildId, msg.author.id, client.user!.id, 'Automod: blocked word']);
    const n = (await pool.query(
      `SELECT count(*)::int n FROM warnings WHERE guild_id=$1 AND user_id=$2 AND moderator_id=$3 AND created_at > now() - interval '24 hours'`,
      [msg.guildId, msg.author.id, client.user!.id])).rows[0].n as number;
    let note = `Warning ${n}/${c.threshold}`;
    if (n >= c.threshold && msg.member.moderatable) {
      await msg.member.timeout(c.timeoutMinutes * 60_000, 'Automod: repeated blocked words').catch(() => {});
      note += ` — timed out for ${c.timeoutMinutes} min`;
    }
    const w = await msg.channel.send({ content: `<@${msg.author.id}> your message was removed (blocked word). ${note}.`, allowedMentions: { users: [msg.author.id] } }).catch(() => null);
    if (w) setTimeout(() => w.delete().catch(() => {}), 8000);
    await logEvent(msg.guild, 'moderation', logEmbed('Automod · blocked word', `<@${msg.author.id}> in <#${msg.channelId}>\n${note}`, COLORS.accent));
  });
}
