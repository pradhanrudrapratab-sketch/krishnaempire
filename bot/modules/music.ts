// Built-in music player: no Lavalink. Plays DIRECT audio links (mp3/ogg/wav/flac/aac files and radio streams)
// by downloading the stream ourselves and decoding it with ffmpeg -> @discordjs/voice.
// YouTube/Spotify page links are not audio files and are rejected with a clear message.
import {
  AudioPlayerStatus, StreamType, VoiceConnectionStatus, createAudioPlayer, createAudioResource, entersState, joinVoiceChannel,
  type AudioPlayer, type AudioResource, type VoiceConnection,
} from '@discordjs/voice';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, MessageFlags, type Client, type Guild, type GuildMember } from 'discord.js';
import dns from 'node:dns/promises';
import net from 'node:net';
import { Readable } from 'node:stream';
import prism from 'prism-media';
import { isPrivateIp } from '../../shared/net';
import type { CommandDef, Ctx } from '../framework';
import { onButton } from '../interactions';
import { COLORS, panel } from '../ui';

interface Track { url: string; title: string; by: string }
interface Q {
  conn: VoiceConnection; player: AudioPlayer; queue: Track[]; current: Track | null; res: AudioResource | null;
  loop: 'off' | 'track' | 'queue'; volume: number; textId: string; stopped: boolean; skipping: boolean; abort?: () => void;
}
const queues = new Map<string, Q>();
const MAX_QUEUE = 50;

let ffOk: boolean | null = null;
export function musicAvailable(): boolean {
  if (ffOk === null) { try { prism.FFmpeg.getInfo(true); ffOk = true; } catch { ffOk = false; } }
  return ffOk;
}

// ---------- safe fetching ----------
async function assertPublic(u: URL) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http/https links are supported.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('That address is not allowed.');
}

/** Follows redirects manually so every hop is checked (SSRF-safe). */
async function openStream(link: string) {
  let url = new URL(link);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000); // connect/headers timeout only
    const res = await fetch(url, { redirect: 'manual', signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; DiscordMusicBot)' } });
    clearTimeout(timer);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      ac.abort();
      if (!loc) break;
      url = new URL(loc, url);
      continue;
    }
    if (!res.ok || !res.body) { ac.abort(); throw new Error(`The server answered ${res.status}.`); }
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type.startsWith('text/') || type.includes('html') || type.includes('json')) {
      ac.abort();
      throw new Error('That link is a web page, not a direct audio file or stream (YouTube/Spotify pages are not supported). Use a direct link such as .mp3 / .ogg / .wav or a radio stream URL.');
    }
    const name = res.headers.get('icy-name') || decodeURIComponent(url.pathname.split('/').pop() || '').replace(/\.[a-z0-9]{2,5}$/i, '') || url.hostname;
    return { body: Readable.fromWeb(res.body as any), title: name.slice(0, 100), abort: () => ac.abort() };
  }
  throw new Error('Too many redirects.');
}

async function createResource(track: Track) {
  const { body, abort } = await openStream(track.url);
  const ff = new prism.FFmpeg({ args: ['-analyzeduration', '0', '-loglevel', '0', '-i', 'pipe:0', '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2'] });
  body.on('error', () => ff.destroy());
  ff.on('error', () => body.destroy());
  ff.on('close', () => { abort(); body.destroy(); });
  body.pipe(ff as any);
  const res = createAudioResource(ff as any, { inputType: StreamType.Raw, inlineVolume: true });
  return { res, abort };
}

// ---------- queue / playback ----------
const fmtEmbed = (q: Q) => new EmbedBuilder().setColor(COLORS.primary).setTitle(q.current ? 'Now playing' : 'Queue empty')
  .setDescription(q.current ? `**${q.current.title}**\n${q.current.url.slice(0, 200)}\nRequested by <@${q.current.by}>\nLoop: ${q.loop} · Volume: ${q.volume}% · Up next: ${q.queue.length}` : 'Add something with `play <link>`.');
const controls = () => new ActionRowBuilder<ButtonBuilder>().addComponents(
  ...[['pause', '⏯'], ['skip', '⏭'], ['loop', '🔁'], ['shuffle', '🔀'], ['stop', '⏹']].map(([id, e]) => new ButtonBuilder().setCustomId(`music:${id}`).setEmoji(e).setStyle(ButtonStyle.Secondary)));

function destroy(guildId: string) {
  const q = queues.get(guildId);
  if (!q) return;
  q.stopped = true;
  q.abort?.();
  q.player.stop(true);
  if (q.conn.state.status !== VoiceConnectionStatus.Destroyed) q.conn.destroy();
  queues.delete(guildId);
}

async function playNext(guild: Guild, q: Q, force = false) {
  const say = (c: any) => (guild.channels.cache.get(q.textId) as any)?.send({ ...c, allowedMentions: { parse: [] } }).catch(() => {});
  while (!q.stopped) {
    const next = !force && q.loop === 'track' && q.current ? q.current : (q.queue.shift() ?? null);
    if (q.loop === 'queue' && q.current && next !== q.current) q.queue.push(q.current);
    q.current = next;
    if (!next) return destroy(guild.id);
    try {
      const { res, abort } = await createResource(next);
      res.volume?.setVolume(q.volume / 100);
      q.res = res; q.abort = abort;
      q.player.play(res);
      await say({ embeds: [fmtEmbed(q)], components: [controls()] });
      return;
    } catch (e: any) {
      await say(panel('Could not play', `**${next.title}**: ${e?.message ?? 'unknown error'}`, 'error'));
      q.current = null; force = true;
      if (q.loop === 'track') q.loop = 'off';
    }
  }
}

async function play(ctx: Ctx) {
  const fail = (t: string) => ctx.reply(panel('Music', t, 'error'), true);
  if (!musicAvailable()) return fail('ffmpeg is not available on the server. Run `npm install` (installs ffmpeg-static) and restart.');
  const vc = ctx.member.voice.channel;
  if (!vc) return fail('Join a voice channel first.');
  let url: URL;
  try { url = new URL(ctx.str('link')!.trim()); } catch { return fail('Please give a valid link.'); }
  let q = queues.get(ctx.guild.id);
  if (q && q.conn.joinConfig.channelId !== vc.id) return fail('Join the voice channel I am in.');
  if (!q && (!vc.joinable || !(vc as any).speakable)) return fail('I need Connect and Speak permission in that voice channel.');
  if (q && q.queue.length >= MAX_QUEUE) return fail(`Queue is full (${MAX_QUEUE}).`);
  await ctx.defer();
  let title: string;
  try { const p = await openStream(url.href); title = p.title; p.abort(); p.body.destroy(); }
  catch (e: any) { return fail(e?.message ?? 'Could not open that link.'); }
  const track: Track = { url: url.href, title, by: ctx.member.id };
  if (!q) {
    const conn = joinVoiceChannel({ channelId: vc.id, guildId: ctx.guild.id, adapterCreator: ctx.guild.voiceAdapterCreator, selfDeaf: true });
    try { await entersState(conn, VoiceConnectionStatus.Ready, 20_000); }
    catch { conn.destroy(); return fail('Could not connect to the voice channel.'); }
    const player = createAudioPlayer();
    conn.subscribe(player);
    const nq: Q = { conn, player, queue: [], current: null, res: null, loop: 'off', volume: 100, textId: ctx.here?.id, stopped: false, skipping: false };
    q = nq;
    player.on(AudioPlayerStatus.Idle, () => { nq.abort?.(); const f = nq.skipping; nq.skipping = false; if (!nq.stopped) void playNext(ctx.guild, nq, f); });
    player.on('error', (e) => console.error('[music:player]', e.message));
    conn.on(VoiceConnectionStatus.Disconnected, async () => {
      try { await Promise.race([entersState(conn, VoiceConnectionStatus.Signalling, 5000), entersState(conn, VoiceConnectionStatus.Connecting, 5000)]); }
      catch { destroy(ctx.guild.id); }
    });
    queues.set(ctx.guild.id, nq);
  }
  q.queue.push(track);
  const starting = !q.current;
  await ctx.reply(panel('Added', `**${title}**`, 'ok'));
  if (starting) await playNext(ctx.guild, q);
}

function needQ(ctx: Ctx): Q | null {
  const q = queues.get(ctx.guild.id);
  if (!q) { void ctx.reply(panel('Nothing playing', '', 'error'), true); return null; }
  if (ctx.member.voice.channelId !== q.conn.joinConfig.channelId) { void ctx.reply(panel('Join my voice channel first', '', 'error'), true); return null; }
  return q;
}
const simple = (name: string, description: string, fn: (q: Q, ctx: Ctx) => string, args: CommandDef['args'] = []): CommandDef => ({
  name, description, module: null, args,
  async run(ctx) { const q = needQ(ctx); if (q) await ctx.reply(panel('Music', fn(q, ctx), 'ok')); },
});
const skip = (q: Q) => { q.skipping = true; if (!q.player.stop()) q.skipping = false; };

export const commands: CommandDef[] = [
  { name: 'play', description: 'Play a direct audio link (mp3, ogg, wav, radio stream)', module: null, args: [{ name: 'link', type: 'string', description: 'Direct audio URL' }], run: play },
  simple('pause', 'Pause playback', (q) => { q.player.pause(); return 'Paused.'; }),
  simple('resume', 'Resume playback', (q) => { q.player.unpause(); return 'Resumed.'; }),
  simple('skip', 'Skip the current track', (q) => { skip(q); return 'Skipped.'; }),
  simple('stop', 'Stop and clear the queue', (_q, c) => { destroy(c.guild.id); return 'Stopped.'; }),
  simple('shuffle', 'Shuffle the queue', (q) => { for (let i = q.queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q.queue[i], q.queue[j]] = [q.queue[j], q.queue[i]]; } return 'Shuffled.'; }),
  simple('loop', 'Set loop mode', (q, c) => { q.loop = c.str('mode')!.toLowerCase() as Q['loop']; return `Loop: ${q.loop}.`; }, [{ name: 'mode', type: 'string', description: 'Loop mode', choices: ['off', 'track', 'queue'] }]),
  simple('volume', 'Set volume (1–150)', (q, c) => { const v = c.int('volume')!; if (v < 1 || v > 150) return 'Volume must be 1–150.'; q.volume = v; q.res?.volume?.setVolume(v / 100); return `Volume: ${v}%.`; }, [{ name: 'volume', type: 'int', description: '1–150' }]),
  { name: 'nowplaying', description: 'Show the current track', module: null, async run(ctx) { const q = queues.get(ctx.guild.id); await ctx.reply(q ? { embeds: [fmtEmbed(q)], components: [controls()] } : panel('Nothing playing', '', 'info')); } },
  { name: 'queue', description: 'Show the queue', module: null, async run(ctx) {
    const q = queues.get(ctx.guild.id);
    await ctx.reply(panel('Queue', q ? [q.current && `**Now:** ${q.current.title}`, ...q.queue.slice(0, 15).map((t, i) => `${i + 1}. ${t.title}`), q.queue.length > 15 ? `…and ${q.queue.length - 15} more` : ''].filter(Boolean).join('\n') || '_Empty_' : '_Empty_')); } },
];

export function init(client: Client) {
  onButton('music', async (i, member: GuildMember, [action]) => {
    const q = queues.get(i.guildId!);
    const eph = MessageFlags.Ephemeral;
    if (!q) return void (await i.reply({ content: 'Nothing is playing.', flags: eph }));
    if (member.voice.channelId !== q.conn.joinConfig.channelId) return void (await i.reply({ content: 'Join my voice channel to use the controls.', flags: eph }));
    if (action === 'pause') { q.player.state.status === AudioPlayerStatus.Paused ? q.player.unpause() : q.player.pause(); }
    else if (action === 'skip') skip(q);
    else if (action === 'loop') q.loop = q.loop === 'off' ? 'track' : q.loop === 'track' ? 'queue' : 'off';
    else if (action === 'shuffle') q.queue.sort(() => Math.random() - 0.5);
    else if (action === 'stop') { const g = i.guildId!; q.current = null; destroy(g); return void (await i.update({ embeds: [fmtEmbed(q)], components: [] })); }
    await i.update({ embeds: [fmtEmbed(q)], components: [controls()] });
  });
  // Leave if the channel has had no humans for 60s.
  client.on(Events.VoiceStateUpdate, (a) => {
    const q = queues.get(a.guild.id);
    const ch = q && a.guild.channels.cache.get(q.conn.joinConfig.channelId ?? '');
    if (!q || !ch?.isVoiceBased() || ch.members.some((m) => !m.user.bot)) return;
    setTimeout(() => { const c2: any = a.guild.channels.cache.get(q.conn.joinConfig.channelId ?? ''); if (queues.get(a.guild.id) === q && !c2?.members.some((m: GuildMember) => !m.user.bot)) destroy(a.guild.id); }, 60_000);
  });
}
