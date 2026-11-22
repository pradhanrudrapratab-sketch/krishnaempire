// Embedded Postgres (PGlite) stored in the OS temp dir. No database server needed.
// Data lives in <tmp>/discord-bot-db and is lost if the OS clears its temp folder.
// Set DATA_DIR to another path to keep it elsewhere, or DATA_DIR=memory for RAM-only.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../shared/env';

export interface Result { rows: any[]; rowCount: number }
export interface Queryable { query(text: string, params?: unknown[]): Promise<Result> }

const dataDir = env.DATA_DIR === 'memory' ? undefined : (env.DATA_DIR ?? path.join(os.tmpdir(), 'discord-bot-db'));
if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
const pg = await PGlite.create(dataDir);
console.log(`Database: ${dataDir ?? 'memory (RAM only)'}`);

const wrap = (r: { query: PGlite['query'] }): Queryable => ({
  async query(text, params = []) {
    const res: any = await r.query(text, params as any[]);
    return { rows: res.rows, rowCount: res.rows.length || res.affectedRows || 0 };
  },
});

export const pool = { ...wrap(pg), end: () => pg.close() };

export async function tx<T>(fn: (c: Queryable) => Promise<T>): Promise<T> {
  return pg.transaction(async (t) => fn(wrap(t as any)));
}

/** Applies database/migrations/*.sql in order. Safe to run on every start. */
export async function migrate() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'database', 'migrations');
  await pg.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await pg.query('SELECT name FROM schema_migrations')).rows.map((r: any) => r.name));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    await pg.transaction(async (t) => {
      await t.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
      await t.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    console.log(`Applied migration ${file}`);
  }
}
