CREATE TABLE IF NOT EXISTS guild_config (
  guild_id    TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prefixes (
  guild_id    TEXT PRIMARY KEY REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  prefix      TEXT NOT NULL CHECK (char_length(prefix) BETWEEN 1 AND 3),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS special_roles (
  guild_id    TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('admin','mod','antinuke')),
  role_id     TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, kind)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  guild_id    TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('admin','mod','antinuke')),
  module      TEXT NOT NULL,
  allowed     BOOLEAN NOT NULL,
  PRIMARY KEY (guild_id, kind, module)
);

CREATE TABLE IF NOT EXISTS trusted_bots (
  guild_id    TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  bot_id      TEXT NOT NULL,
  added_by    TEXT NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, bot_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  details     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_guild_time ON audit_log (guild_id, created_at DESC);
