CREATE TABLE IF NOT EXISTS module_config (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  module TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, module));

CREATE TABLE IF NOT EXISTS moderation_logs (
  id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  action TEXT NOT NULL, target_id TEXT NOT NULL, moderator_id TEXT NOT NULL, reason TEXT, duration_s INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS moderation_logs_target ON moderation_logs (guild_id, target_id);

CREATE TABLE IF NOT EXISTS warnings (
  id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, moderator_id TEXT NOT NULL, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS warnings_user ON warnings (guild_id, user_id);

CREATE TABLE IF NOT EXISTS bad_words (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE, word TEXT NOT NULL,
  PRIMARY KEY (guild_id, word));

CREATE TABLE IF NOT EXISTS user_levels (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE, user_id TEXT NOT NULL,
  xp BIGINT NOT NULL DEFAULT 0, level INT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id));
CREATE INDEX IF NOT EXISTS user_levels_rank ON user_levels (guild_id, xp DESC);

CREATE TABLE IF NOT EXISTS autorank_rewards (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE, level INT NOT NULL, role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, level));

CREATE TABLE IF NOT EXISTS invite_tracking (
  id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  member_id TEXT NOT NULL, inviter_id TEXT, code TEXT, source TEXT NOT NULL DEFAULT 'unknown',
  suspicious BOOLEAN NOT NULL DEFAULT false, counted BOOLEAN NOT NULL DEFAULT true,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), left_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS invite_tracking_inviter ON invite_tracking (guild_id, inviter_id);
CREATE INDEX IF NOT EXISTS invite_tracking_member ON invite_tracking (guild_id, member_id);

CREATE TABLE IF NOT EXISTS verification_records (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE, user_id TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (guild_id, user_id));

CREATE TABLE IF NOT EXISTS tickets (
  id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL, category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')), claimed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS tickets_owner ON tickets (guild_id, owner_id, status);

CREATE TABLE IF NOT EXISTS autoresponders (
  id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  trigger TEXT NOT NULL, response TEXT NOT NULL, match_type TEXT NOT NULL DEFAULT 'partial' CHECK (match_type IN ('exact','partial')),
  case_sensitive BOOLEAN NOT NULL DEFAULT false, enabled BOOLEAN NOT NULL DEFAULT true,
  channel_ids TEXT[] NOT NULL DEFAULT '{}', role_ids TEXT[] NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS autoresponders_guild ON autoresponders (guild_id);

CREATE TABLE IF NOT EXISTS temp_voice (
  channel_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE, owner_id TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS youtube_subs (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE, yt_channel_id TEXT NOT NULL,
  label TEXT NOT NULL, last_video_id TEXT, added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, yt_channel_id));

CREATE TABLE IF NOT EXISTS trusted_users (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE, user_id TEXT NOT NULL,
  added_by TEXT NOT NULL, added_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (guild_id, user_id));
