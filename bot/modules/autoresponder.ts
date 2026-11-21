import { Events, type Client } from 'discord.js';
import { pool } from '../db';
import type { CommandDef } from '../framework';
import { panel } from '../ui';

interface Row { id: string; trigger: string; response: string; match_type: string; case_sensitive: boolean; enabled: boolean; channel_ids: string[]; role_ids: string[] }
const cache = new Map<string, { at: number; rows: Row[] }>();
const lastFire = new Map<string, number>();
async function rows(gid: string): Promise<Row[]> {
  const h = cache.get(gid);
  if (h && Date.now() - h.at < 10_000) return h.rows;
  const r = (await pool.query('SELECT * FROM autoresponders WHERE guild_id=$1 AND enabled ORDER BY id', [gid])).rows as Row[];
  cache.set(gid, { at: Date.now(), rows: r });
  return r;
}
const id = { name: 'id', type: 'int', description: 'Autoresponder id' } as const;

export const autoresponder: CommandDef = {
  name: 'autoresponder', description: 'Keyword auto-replies', module: 'autoresponder', defaultSub: 'list',
  subs: {
    add: { description: 'Add a trigger', args: [{ name: 'trigger', type: 'string', description: 'Trigger (quote multi-word: "good morning")' }, { name: 'response', type: 'rest', description: 'Response text' }] },
    edit: { description: 'Edit the response', args: [id, { name: 'response', type: 'rest', description: 'New response' }] },
    remove: { description: 'Delete', args: [id] }, enable: { description: 'Enable', args: [id] }, disable: { description: 'Disable', args: [id] },
    match: { description: 'exact or partial matching', args: [id, { name: 'mode', type: 'string', description: 'Mode', choices: ['exact', 'partial'] }] },
    case: { description: 'Case sensitivity', args: [id, { name: 'value', type: 'string', description: 'on/off', choices: ['on', 'off'] }] },
    channel: { description: 'Toggle a channel restriction', args: [id, { name: 'channel', type: 'channel', description: 'Channel' }] },
    role: { description: 'Toggle a required role', args: [id, { name: 'role', type: 'role', description: 'Role' }] },
    list: { description: 'List autoresponders' },
  },
  async run(ctx) {
    const gid = ctx.guild.id;
    const done = (t: string) => { cache.delete(gid); return ctx.reply(panel('Autoresponder', t, 'ok')); };
    if (ctx.sub === 'list') {
      const r = (await pool.query('SELECT * FROM autoresponders WHERE guild_id=$1 ORDER BY id LIMIT 25', [gid])).rows as Row[];
      return ctx.reply(panel('Autoresponders', r.map((x) => `**#${x.id}** ${x.enabled ? '🟢' : '⚪'} \`${x.trigger}\` (${x.match_type}${x.case_sensitive ? ', case' : ''}) → ${x.response.slice(0, 60)}`).join('\n') || '_None_'));
    }
    if (ctx.sub === 'add') {
      const t = ctx.str('trigger')!.slice(0, 100), resp = ctx.str('response')!.slice(0, 1500);
      const n = (await pool.query('SELECT count(*)::int n FROM autoresponders WHERE guild_id=$1', [gid])).rows[0].n;
      if (n >= 100) return ctx.reply(panel('Limit reached', 'Max 100 autoresponders.', 'error'), true);
      const r = await pool.query('INSERT INTO autoresponders (guild_id, trigger, response) VALUES ($1,$2,$3) RETURNING id', [gid, t, resp]);
      return done(`Added **#${r.rows[0].id}**.`);
    }
    const rid = ctx.int('id')!;
    let r;
    switch (ctx.sub) {
      case 'edit': r = await pool.query('UPDATE autoresponders SET response=$3 WHERE guild_id=$1 AND id=$2', [gid, rid, ctx.str('response')!.slice(0, 1500)]); break;
      case 'remove': r = await pool.query('DELETE FROM autoresponders WHERE guild_id=$1 AND id=$2', [gid, rid]); break;
      case 'enable': case 'disable': r = await pool.query('UPDATE autoresponders SET enabled=$3 WHERE guild_id=$1 AND id=$2', [gid, rid, ctx.sub === 'enable']); break;
      case 'match': r = await pool.query('UPDATE autoresponders SET match_type=$3 WHERE guild_id=$1 AND id=$2', [gid, rid, ctx.str('mode')!.toLowerCase()]); break;
      case 'case': r = await pool.query('UPDATE autoresponders SET case_sensitive=$3 WHERE guild_id=$1 AND id=$2', [gid, rid, ctx.str('value')!.toLowerCase() === 'on']); break;
      case 'channel': case 'role': {
        const col = ctx.sub === 'channel' ? 'channel_ids' : 'role_ids';
        const target = ctx.sub === 'channel' ? ctx.channel('channel')!.id : ctx.role('role')!.id;
        r = await pool.query(`UPDATE autoresponders SET ${col} = CASE WHEN $3 = ANY(${col}) THEN array_remove(${col}, $3) ELSE array_append(${col}, $3) END WHERE guild_id=$1 AND id=$2`, [gid, rid, target]);
        break;
      }
    }
    return r?.rowCount ? done('Updated.') : ctx.reply(panel('Not found', `No autoresponder #${rid}.`, 'error'), true);
  },
};
export const commands = [autoresponder];

export function init(client: Client) {
  client.on(Events.MessageCreate, async (msg) => {
    // Never react to bots/webhooks (including ourselves): prevents response loops.
    if (msg.author.bot || msg.webhookId || !msg.inGuild() || !msg.content) return;
    for (const r of await rows(msg.guildId)) {
      if (r.channel_ids.length && !r.channel_ids.includes(msg.channelId)) continue;
      if (r.role_ids.length && !msg.member?.roles.cache.some((x) => r.role_ids.includes(x.id))) continue;
      const a = r.case_sensitive ? msg.content : msg.content.toLowerCase(), t = r.case_sensitive ? r.trigger : r.trigger.toLowerCase();
      if (r.match_type === 'exact' ? a.trim() !== t : !a.includes(t)) continue;
      const k = `${msg.channelId}:${r.id}`;
      if (Date.now() - (lastFire.get(k) ?? 0) < 3000) continue; // per-channel cooldown
      lastFire.set(k, Date.now());
      await msg.reply({ content: r.response, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
      break; // one response per message
    }
  });
}
