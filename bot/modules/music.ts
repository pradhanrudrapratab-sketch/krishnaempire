// Music via Lavalink (Shoukaku). Audio sources are whatever YOUR Lavalink node is licensed/configured for.
// Spotify links are NOT playable directly: they need a Lavalink plugin (e.g. LavaSrc) that resolves them to a supported source.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type Client, type Guild, type GuildMember } from 'discord.js';
import { Connectors, Shoukaku } from 'shoukaku';
import { env } from '../../shared/env';
import type { CommandDef, Ctx } from '../framework';
import { onButton } from '../interactions';
import { COLORS, panel } from '../ui';

interface Track { encoded: string; title: string; uri: string | null; length: number; author: string; by: string }
interface Q { player: any; queue: Track[]; current: Track | null; loop: 'off' | 'track' | 'queue'; volume: number; textId: string }
const queues = new Map<string, Q>();
let shoukaku: Shoukaku | null = null;

const fmtTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const controls = () => new ActionRowBuilder<ButtonBuilder>().addComponents(
  ...[['pause', '⏯'], ['skip', '⏭'], ['loop', '🔁'], ['shuffle', '🔀'], ['stop', '⏹']].map(([id, e]) => new ButtonBuilder().setCustomId(`music:${id}`).setEmoji(e).setStyle(ButtonStyle.Secondary)));

function nowEmbed(q: Q) {
  const t = q.current;
  return new EmbedBuilder().setColor(COLORS.primary).setTitle(t ? 'Now playing' : 'Queue empty')
    .setDescription(t ? `[${t.title}](${t.uri ?? 'https://discord.com'})\n${t.author} · ${fmtTime(t.length)}\nRequested by <@${t.by}>\nLoop: ${q.loop} · Volume: ${q.volume}% · Up next: ${q.queue.length}` : 'Add something with `play`.');
}
async function playNext(guild: Guild, q: Q) {
  const next = q.loop === 'track' && q.current ? q.current : q.queue.shift() ?? null;
  if (q.loop === 'queue' && q.current && next !== q.current) q.queue.push(q.current);
  q.current = next;
  if (!next) { await shoukaku!.leaveVoiceChannel(guild.id).catch(() => {}); queues.delete(guild.id); return; }
  await q.player.playTrack({ track: { encoded: next.encoded } });
  const ch: any = guild.channels.cache.get(q.textId);
  await ch?.send({ embeds: [nowEmbed(q)], components: [controls()] }).catch(() => {});
}

async function play(ctx: Ctx) {
  if (!shoukaku) return ctx.reply(panel('Music disabled', 'Set LAVALINK_URL and LAVALINK_PASSWORD to enable music.', 'error'), true);
  const vc = ctx.member.voice.channel;
  if (!vc) return ctx.reply(panel('Join a voice channel first', '', 'error'), true);
  const query = ctx.str('query')!.trim();
  if (/spotify\.com/i.test(query)) return ctx.reply(panel('Spotify links are not supported', 'Spotify does not provide audio. Search by song name, or use a supported source link.', 'error'), true);
  const node = shoukaku.getIdealNode();
  if (!node) return ctx.reply(panel('Music unavailable', 'No Lavalink node is connected.', 'error'), true);
  const res: any = await node.rest.resolve(/^https?:\/\//.test(query) ? query : `ytsearch:${query}`);
  const raw = res?.loadType === 'track' ? [res.data] : res?.loadType === 'search' ? [res.data[0]] : res?.loadType === 'playlist' ? res.data.tracks.slice(0, 50) : [];
  if (!raw.length || !raw[0]) return ctx.reply(panel('Nothing found', 'No results for that query.', 'error'), true);
  const tracks: Track[] = raw.map((t: any) => ({ encoded: t.encoded, title: t.info.title, uri: t.info.uri, length: t.info.length, author: t.info.author, by: ctx.member.id }));
  let q = queues.get(ctx.guild.id);
  if (!q) {
    const player = await shoukaku.joinVoiceChannel({ guildId: ctx.guild.id, channelId: vc.id, shardId: ctx.guild.shardId, deaf: true });
    q = { player, queue: [], current: null, loop: 'off', volume: 100, textId: ctx.here?.id };
    player.on('end', (e: any) => { if (e?.reason !== 'replaced' && e?.reason !== 'stopped') void playNext(ctx.guild, q!); });
    player.on('closed', () => queues.delete(ctx.guild.id));
    queues.set(ctx.guild.id, q);
  } else if (ctx.member.voice.channelId !== q.player.connection?.channelId && ctx.member.voice.channelId !== (q.player as any).channelId) {
    // must share the bot's voice channel to control it
  }
  q.queue.push(...tracks);
  if (!q.current) await playNext(ctx.guild, q);
  else await ctx.reply(panel('Queued', tracks.length > 1 ? `${tracks.length} tracks added.` : `**${tracks[0].title}**`, 'ok'));
  if (!q.current) return;
}

const needQ = (ctx: Ctx) => {
  const q = queues.get(ctx.guild.id);
  if (!q) { void ctx.reply(panel('Nothing playing', '', 'error'), true); return null; }
  if (ctx.member.voice.channelId !== (ctx.guild.members.me?.voice.channelId)) { void ctx.reply(panel('Join my voice channel first', '', 'error'), true); return null; }
  return q;
};
const simple = (name: string, description: string, fn: (q: Q, ctx: Ctx) => Promise<string>, args: CommandDef['args'] = []): CommandDef => ({
  name, description, module: null, args,
  async run(ctx) { const q = needQ(ctx); if (!q) return; await ctx.reply(panel('Music', await fn(q, ctx), 'ok')); },
});

export const commands: CommandDef[] = [
  { name: 'play', description: 'Play a song or add it to the queue', module: 'music', args: [{ name: 'query', type: 'rest', description: 'Song name or URL' }], run: play },
  simple('pause', 'Pause playback', async (q) => { await q.player.setPaused(true); return 'Paused.'; }),
  simple('resume', 'Resume playback', async (q) => { await q.player.setPaused(false); return 'Resumed.'; }),
  simple('skip', 'Skip the current track', async (q) => { await q.player.stopTrack(); return 'Skipped.'; }),
  simple('stop', 'Stop and clear the queue', async (q, c) => { q.queue = []; q.current = null; q.loop = 'off'; await shoukaku!.leaveVoiceChannel(c.guild.id); queues.delete(c.guild.id); return 'Stopped.'; }),
  simple('shuffle', 'Shuffle the queue', async (q) => { for (let i = q.queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q.queue[i], q.queue[j]] = [q.queue[j], q.queue[i]]; } return 'Shuffled.'; }),
  simple('loop', 'Set loop mode', async (q, c) => { q.loop = c.str('mode')!.toLowerCase() as Q['loop']; return `Loop: ${q.loop}.`; }, [{ name: 'mode', type: 'string', description: 'Loop mode', choices: ['off', 'track', 'queue'] }]),
  simple('volume', 'Set volume (1–150)', async (q, c) => { const v = c.int('volume')!; if (v < 1 || v > 150) return 'Volume must be 1–150.'; q.volume = v; await q.player.setGlobalVolume(v); return `Volume: ${v}%.`; }, [{ name: 'volume', type: 'int', description: '1–150' }]),
  { name: 'nowplaying', description: 'Show the current track', module: null, async run(ctx) { const q = queues.get(ctx.guild.id); await ctx.reply(q ? { embeds: [nowEmbed(q)], components: [controls()] } : panel('Nothing playing', '', 'info')); } },
  { name: 'queue', description: 'Show the queue', module: null, async run(ctx) {
    const q = queues.get(ctx.guild.id);
    await ctx.reply(panel('Queue', q ? [q.current && `**Now:** ${q.current.title}`, ...q.queue.slice(0, 15).map((t, i) => `${i + 1}. ${t.title} (${fmtTime(t.length)})`), q.queue.length > 15 ? `…and ${q.queue.length - 15} more` : ''].filter(Boolean).join('\n') : '_Empty_')); } },
];

export function init(client: Client) {
  if (!env.LAVALINK_URL || !env.LAVALINK_PASSWORD) { console.log('[music] LAVALINK_URL/PASSWORD not set; music disabled.'); return; }
  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), [{ name: 'main', url: env.LAVALINK_URL, auth: env.LAVALINK_PASSWORD }], { resume: true, reconnectTries: 5 });
  shoukaku.on('error', (_n, e) => console.error('[lavalink]', e));
  onButton('music', async (i, member: GuildMember, [action]) => {
    const q = queues.get(i.guildId!);
    const eph = MessageFlags.Ephemeral;
    if (!q) return void (await i.reply({ content: 'Nothing is playing.', flags: eph }));
    if (member.voice.channelId !== i.guild!.members.me?.voice.channelId) return void (await i.reply({ content: 'Join my voice channel to use the controls.', flags: eph }));
    if (action === 'pause') { const paused = !q.player.paused; await q.player.setPaused(paused); }
    else if (action === 'skip') await q.player.stopTrack();
    else if (action === 'loop') q.loop = q.loop === 'off' ? 'track' : q.loop === 'track' ? 'queue' : 'off';
    else if (action === 'shuffle') q.queue.sort(() => Math.random() - 0.5);
    else if (action === 'stop') { q.queue = []; q.current = null; await shoukaku!.leaveVoiceChannel(i.guildId!); queues.delete(i.guildId!); return void (await i.update({ embeds: [nowEmbed({ ...q, current: null })], components: [] })); }
    await i.update({ embeds: [nowEmbed(q)], components: [controls()] });
  });
}
