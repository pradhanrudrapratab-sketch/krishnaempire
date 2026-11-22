import 'dotenv/config';
import { z } from 'zod';
import { validatePrefix } from './validators/prefix';

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord snowflake ID');

const schema = z.object({
  BOT_TOKEN: z.string().min(30, 'missing or too short'),
  CLIENT_ID: snowflake,
  GUILD_ID: snowflake,
  OWNER_ID: snowflake,
  DEFAULT_PREFIX: z
    .string()
    .default('!')
    .refine((p) => validatePrefix(p) === null, 'invalid prefix'),
  DATABASE_URL: z.string().min(1, 'required'),
  // Used from Phase 9 (dashboard); optional until then.
  DASHBOARD_URL: z.string().optional(),
  API_SECRET: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}
export const env = parsed.data;
