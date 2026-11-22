# Discord Management Bot

Single-server Discord bot + (Phase 9) Next.js dashboard. See the master spec for the full scope.

## Status

| Phase | State |
|---|---|
| 1 Foundation | Built |
| 2 Command + permission engine | Built, engine unit-tested |
| 3 Welcome, goodbye, invites, logs, member status | Written, untested against Discord |
| 4 Moderation, warnings, bad-word filter | Written, untested against Discord |
| 5 Anti-Nuke, trusted bots/users, honeypot | Written, untested against Discord |
| 6 Verification, levels, auto rank, rank cards | Written, untested against Discord |
| 7 Tickets, join-to-create, YouTube, autoresponder, emoji | Written, untested against Discord |
| 8 Music (built-in, ffmpeg + @discordjs/voice, direct links) | Written, untested |
| 9 Web dashboard (OAuth2, Next.js) | Not started |
| 10 Integration tests, deployment | Only unit tests (permissions, level math, prefix) |

Nothing here has been run against a live Discord server or Postgres, and the code has not been type-checked
(dependencies could not be installed in the build environment). Expect small fixes on first run.

## Setup

1. Create an app in the Discord Developer Portal. Enable **Server Members** and **Message Content** intents (privileged).
2. Invite the bot with: Manage Roles, Manage Channels, Manage Messages, Moderate Members, Ban/Kick Members,
   View Audit Log, Send Messages, Embed Links, Attach Files, plus the `bot` and `applications.commands` scopes. Do not grant Administrator.
3. `cp .env.example .env` and fill it in.
4. `npm install && npm start` (the database schema is created automatically)
5. `npm test` runs the permission-engine tests.

## Database

Uses **PGlite** (real Postgres compiled to WASM) in your OS temp folder, so no database server is needed.
Data survives bot restarts but is **lost if the OS clears its temp directory** (reboot on some systems, cleanup jobs, many free hosts).
Set `DATA_DIR=/some/path` to keep it elsewhere, or `DATA_DIR=memory` for RAM-only. The SQL is standard Postgres,
so moving back to a real Postgres server later only means replacing `bot/db.ts`.

## Deploying on Render

Build: `npm install` (or `yarn install`) · Start: `npm start`. Service type: Web Service (needs an open port; `/health` uses Render's `PORT`).
Environment variables: `BOT_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `OWNER_ID` (no database variable needed).
Free instances sleep without traffic: point an uptime pinger at `https://<your-app>.onrender.com/health` every 5 minutes.
Render's disk is temporary, so data resets on each deploy/restart (fine for this setup).

## Health check

`GET /health` (or `/`) returns `200 ok`. It does nothing else (no DB/Discord calls), so it is meant only for Render and an uptime pinger such as UptimeRobot (HEAD or GET every 5 min).

## Music

`/play <link>` or `!play <link>` plays **direct audio links**: mp3/ogg/wav/flac files and radio streams. No Lavalink needed.
YouTube/Spotify page links are rejected (they are web pages, not audio files). Needs `ffmpeg-static` (installed by `npm install`).
Links to private/internal IPs are blocked.

## Design notes

- `bot/framework.ts`: one `CommandDef` generates both the slash command and the prefix command. Both go through the same `can()` check.
- `shared/permissions/engine.ts`: pure authorization logic, reusable by the dashboard backend.
- `OWNER_ID` is read only from the environment. `roles`, `permissions` and `trustedbots` are owner-only and cannot be granted by overrides.
- The Discord server owner is treated as Admin tier, never as bot owner.
- Explicit deny always beats allow when a member holds several special roles.
- Every config change is written to `audit_log` in the same transaction.

## Commands (Phase 2)

`!help` `!ping` `!prefix [view|set <p>|reset]` `!role [view|setup <admin|mod|antinuke> @Role|remove <type>]`
`!permission [view [type]|set <type> <module> <allow|deny>|reset <type>]`
`!antinuke bot add|remove|list|check @Bot` (add/remove: bot owner only)
Every command is also available as `/command subcommand`.
