import { Events, type Client } from 'discord.js';
import { pool } from '../db';
import type { CommandDef } from '../framework';
import { getCfg, patchCfg } from '../services/config';
import { panel } from '../ui';

const DEF = { channelId: null as string | null, pingRoleId: null as string | null, template: '📺 **{channel}** just uploaded: **{title}**\n{url}' };
const UC = /UC[\w-]{22}/;
interface Entry { id: string; title: string; published: number }

async function parseFeed(ytId: string): Promise<{ title: string; entries: Entry[] } | null> {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ytId}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res?.ok) return null;
  const xml = await res.text();
  const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const title = dec(xml.match(/<title>([^<]*)<\/title>/)?.[1] ?? ytId);
  const entries = [...xml.matchAll(/<entry>[\s\S]*?<yt:videoId>([^<]+)<\/yt:videoId>[\s\S]*?<title>([^<]*)<\/title>[\s\S]*?<published>([^<]+)<\/published>/g)]
    .map((m) => ({ id: m[1], title: dec(m[2]), published: Date.parse(m[3]) }));
  return { title, entries }; // feed lists newest first
}
async function resolve(input: string): Promise<string | null> {
  const direct = input.match(UC)?.[0];
  if (direct) return direct;
  if (!/^(https?:\/\/)?(www\.)?youtube\.com\/@[\w.-]+/.test(input) && !/^@[\w.-]+$/.test(input)) return null;
  const url = input.startsWith('@') ? `https://www.youtube.com/${input}` : input.startsWith('http') ? input : `https://${input}`;
  const html = await fetch(url, { signal: AbortSignal.timeout(10_000) }).then((r) => r.text()).catch(() => '');
  return html.match(/"channelId":"(UC[\w-]{22})"/)?.[1] ?? html.match(/channel\/(UC[\w-]{22})/)?.[1] ?? null;
}
const fmt = (t: string, label: string, e: Entry) => t.replaceAll('{channel}', label).replaceAll('{title}', e.title).replaceAll('{url}', `https://youtu.be/${e.id}`);

async function post(guild: any, c: typeof DEF, label: string, e: Entry) {
  const ch = c.channelId ? guild.channels.cache.get(c.channelId) : null;
  if (!ch?.isTextBased()) return false;
  await ch.send({ content: `${c.pingRoleId ? `<@&${c.pingRoleId}> ` : ''}${fmt(c.template, label, e)}`, allowedMentions: { roles: c.pingRoleId ? [c.pingRoleId] : [] } });
  return true;
}

export const youtube: CommandDef = {
  name: 'youtube', description: 'YouTube upload notifications', module: 'youtube', defaultSub: 'list',
  subs: {
    add: { description: 'Subscribe (channel ID UC…, or @handle / URL)', args: [{ name: 'channel', type: 'string', description: 'YouTube channel' }] },
    remove: { description: 'Unsubscribe', args: [{ name: 'channel', type: 'string', description: 'Channel ID or name' }] },
    list: { description: 'List subscriptions' },
    channel: { description: 'Set the notification channel', args: [{ name: 'channel', type: 'channel', description: 'Text channel' }] },
    pingrole: { description: 'Set the role to ping', args: [{ name: 'role', type: 'role', description: 'Role' }] },
    template: { description: 'Set the template ({channel} {title} {url})', args: [{ name: 'text', type: 'rest', description: 'Template' }] },
    test: { description: 'Send a test notification' },
  },
  async run(ctx) {
    const gid = ctx.guild.id, by = ctx.member.id;
    const c = await getCfg(gid, 'youtube', DEF);
    const ok = (t: string) => ctx.reply(panel('YouTube', t, 'ok'));
    switch (ctx.sub) {
      case 'add': {
        const id = await resolve(ctx.str('channel')!);
        const feed = id ? await parseFeed(id) : null;
        if (!id || !feed) return ctx.reply(panel('Not found', 'Could not resolve that channel. Use its channel ID (starts with UC) or @handle.', 'error'), true);
        await pool.query(`INSERT INTO youtube_subs (guild_id, yt_channel_id, label, last_video_id) VALUES ($1,$2,$3,$4)
          ON CONFLICT (guild_id, yt_channel_id) DO NOTHING`, [gid, id, feed.title, feed.entries[0]?.id ?? null]);
        return ok(`Subscribed to **${feed.title}**. Only new uploads from now on will be announced.`);
      }
      case 'remove': {
        const q = ctx.str('channel')!;
        const r = await pool.query('DELETE FROM youtube_subs WHERE guild_id=$1 AND (yt_channel_id=$2 OR lower(label)=lower($2))', [gid, q]);
        return r.rowCount ? ok('Unsubscribed.') : ctx.reply(panel('Not found', 'No such subscription.', 'error'), true);
      }
      case 'channel': { const ch = ctx.channel('channel')!; if (!ch.isTextBased()) return ctx.reply(panel('Invalid channel', 'Pick a text channel.', 'error'), true); await patchCfg(gid, 'youtube', { channelId: ch.id }, by); return ok(`Notifications → <#${ch.id}>.`); }
      case 'pingrole': await patchCfg(gid, 'youtube', { pingRoleId: ctx.role('role')!.id }, by); return ok('Ping role set.');
      case 'template': await patchCfg(gid, 'youtube', { template: ctx.str('text')!.slice(0, 500) }, by); return ok('Template set.');
      case 'test': {
        if (!c.channelId) return ctx.reply(panel('Not ready', 'Set a channel first.', 'error'), true);
        await post(ctx.guild, c, 'Example Channel', { id: 'dQw4w9WgXcQ', title: 'Test video', published: Date.now() });
        return ok('Test sent.');
      }
      default: {
        const r = await pool.query('SELECT label, yt_channel_id FROM youtube_subs WHERE guild_id=$1 ORDER BY label', [gid]);
        return ctx.reply(panel('YouTube subscriptions', r.rows.map((x) => `**${x.label}** · \`${x.yt_channel_id}\``).join('\n') || '_None_'));
      }
    }
  },
};
export const commands = [youtube];

let running = false;
async function poll(client: Client) {
  if (running) return;
  running = true;
  try {
    const subs = (await pool.query('SELECT * FROM youtube_subs')).rows;
    for (const s of subs) {
      const guild = client.guilds.cache.get(s.guild_id);
      const feed = await parseFeed(s.yt_channel_id);
      if (!guild || !feed || !feed.entries.length) continue;
      const idx = feed.entries.findIndex((e) => e.id === s.last_video_id);
      // Unknown last id (e.g. video deleted): only consider videos newer than the subscription.
      const fresh = (idx === -1 ? feed.entries.filter((e) => e.published > new Date(s.added_at).getTime()) : feed.entries.slice(0, idx)).reverse();
      const c = await getCfg(s.guild_id, 'youtube', DEF);
      for (const e of fresh) {
        if (!(await post(guild, c, s.label, e).catch(() => false))) break; // retry next poll
        await pool.query('UPDATE youtube_subs SET last_video_id=$3 WHERE guild_id=$1 AND yt_channel_id=$2', [s.guild_id, s.yt_channel_id, e.id]); // dedupe
      }
    }
  } catch (e) { console.error('[youtube]', e); }
  finally { running = false; }
}
export function init(client: Client) {
  client.once(Events.ClientReady, () => { setInterval(() => void poll(client), 5 * 60_000); });
}
