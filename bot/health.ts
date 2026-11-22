import http from 'node:http';
import { env } from '../shared/env';

/** Tiny keep-alive endpoint for Render / UptimeRobot. No database or Discord calls, so it is always instant. */
export function startHealth() {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if ((path !== '/health' && path !== '/') || (req.method !== 'GET' && req.method !== 'HEAD')) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : 'ok');
  });
  const port = env.PORT ?? env.HEALTH_PORT;
  server.listen(port, '0.0.0.0', () => console.log(`Health endpoint: http://0.0.0.0:${port}/health`));
  return server;
}
