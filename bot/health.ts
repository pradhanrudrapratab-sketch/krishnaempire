import http from 'node:http';
import type { Client } from 'discord.js';
import { env } from '../shared/env';
import { pool } from './db';
import { musicAvailable } from './modules/music';

async function dbOk() {
  try {
    await Promise.race([pool.query('SELECT 1'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))]);
    return true;
  } catch { return false; }
}

/** GET /health -> which services are running. Reveals nothing else. 200 = all running, 503 = something is down. */
export function startHealth(client: Client) {
  const server = http.createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/health') return void res.writeHead(404).end();
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405, { allow: 'GET, HEAD' }).end();
    const bot = client.isReady();
    const database = await dbOk();
    const music = bot && musicAvailable();
    const s = (b: boolean) => (b ? 'running' : 'stopped');
    const all = bot && database && music;
    res.writeHead(all ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: all ? 'ok' : 'degraded', services: { bot: s(bot), database: s(database), music: s(music) } }));
  });
  server.listen(env.HEALTH_PORT, () => console.log(`Health endpoint: http://0.0.0.0:${env.HEALTH_PORT}/health`));
  return server;
}
