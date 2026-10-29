/** Authoritative PostgreSQL schema. Keep tables before their referencing tables. */
export const schemaSql = `
CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      event_id TEXT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      owner_id TEXT,
      join_code TEXT UNIQUE,
      role_id TEXT,
      text_channel_id TEXT,
      voice_channel_id TEXT,
      color TEXT,
      created_at BIGINT NOT NULL
    );

CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      bucket TEXT NOT NULL,
      window_start BIGINT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (bucket, window_start)
    );
CREATE INDEX IF NOT EXISTS idx_rate_limit_window ON rate_limit_buckets(window_start);

CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      starts_at BIGINT,
      ends_at BIGINT,
      signup_starts_at BIGINT,
      signup_ends_at BIGINT,
      status TEXT NOT NULL DEFAULT 'draft',
      form_json TEXT,
      panel_channel_id TEXT,
      category_id TEXT,
      cleanup_delay_hours BIGINT NOT NULL DEFAULT 48,
      cleanup_done BIGINT NOT NULL DEFAULT 0,
      cleanup_warned_72h BIGINT NOT NULL DEFAULT 0,
      cleanup_warned_24h BIGINT NOT NULL DEFAULT 0,
      reminded_24h BIGINT NOT NULL DEFAULT 0,
      match_at BIGINT,
      match_locked BIGINT NOT NULL DEFAULT 0,
      discord_event_ids TEXT NOT NULL DEFAULT '[]',
      announcement_channel_id TEXT,
      schedule_channel_id TEXT,
      schedule_json TEXT NOT NULL DEFAULT '[]',
      announcements_json TEXT NOT NULL DEFAULT '[]',
      assignments_json TEXT NOT NULL DEFAULT '[]',
      announced_schedule_ids TEXT NOT NULL DEFAULT '[]',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_events_guild ON events(guild_id, status);

CREATE TABLE IF NOT EXISTS event_templates (
      id TEXT PRIMARY KEY,
      guild_id TEXT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      json TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

CREATE TABLE IF NOT EXISTS form_config (
      guild_id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    );

CREATE TABLE IF NOT EXISTS participants (
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      experience TEXT NOT NULL,
      role_track TEXT NOT NULL,
      skills TEXT NOT NULL,
      team_pref TEXT NOT NULL,
      teammates TEXT NOT NULL,
      team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active',
      block_reason TEXT,
      imported_signup_id TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (event_id, user_id)
    );

CREATE TABLE IF NOT EXISTS registration_answers (
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      form_version BIGINT NOT NULL,
      answers_json TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (event_id, user_id),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS registration_form_versions (
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      form_version BIGINT NOT NULL,
      form_json TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (event_id, form_version)
    );

CREATE TABLE IF NOT EXISTS registration_answer_history (
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      form_version BIGINT NOT NULL,
      answers_json TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (event_id, user_id, form_version)
    );

CREATE TABLE IF NOT EXISTS submission_forms (
      event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      version BIGINT NOT NULL,
      enabled BIGINT NOT NULL DEFAULT 0,
      allow_edits BIGINT NOT NULL DEFAULT 1,
      questions_json TEXT NOT NULL DEFAULT '[]',
      updated_at BIGINT NOT NULL
    );

CREATE TABLE IF NOT EXISTS submission_answers (
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      form_version BIGINT NOT NULL,
      answers_json TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (event_id, user_id)
    );

CREATE TABLE IF NOT EXISTS imported_signups (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      source_row BIGINT NOT NULL,
      source_timestamp TEXT NOT NULL DEFAULT '',
      form_version BIGINT NOT NULL DEFAULT 1,
      values_json TEXT NOT NULL,
      answers_json TEXT NOT NULL DEFAULT '{}',
      discord_username TEXT,
      discord_user_id TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE (event_id, source_row),
      UNIQUE (event_id, id)
    );

CREATE TABLE IF NOT EXISTS imported_signup_answer_history (
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      import_id TEXT NOT NULL REFERENCES imported_signups(id) ON DELETE CASCADE,
      form_version BIGINT NOT NULL,
      answers_json TEXT NOT NULL,
      values_json TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (event_id, import_id, form_version),
      FOREIGN KEY (event_id, import_id) REFERENCES imported_signups(event_id, id) ON DELETE CASCADE
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_imported_signups_event_email ON imported_signups(event_id, lower(values_json::jsonb->>'email')) WHERE NULLIF(trim(values_json::jsonb->>'email'), '') IS NOT NULL;

CREATE TABLE IF NOT EXISTS team_requests (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      event_id TEXT,
      guild_id TEXT NOT NULL,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      requester_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      decided_at BIGINT
    );

CREATE INDEX IF NOT EXISTS idx_requests_team ON team_requests(team_id, status);

CREATE INDEX IF NOT EXISTS idx_requests_target ON team_requests(target_id, status);

CREATE TABLE IF NOT EXISTS member_deletions (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      deleted_at BIGINT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

CREATE TABLE IF NOT EXISTS private_answer_deletions (
      guild_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      deleted_at BIGINT NOT NULL,
      PRIMARY KEY (guild_id, event_id, user_id)
    );

CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      team_category_id TEXT,
      default_announcement_channel_id TEXT,
      default_panel_channel_id TEXT,
      default_category_id TEXT,
      default_cleanup_delay_hours BIGINT,
      default_form_template_id TEXT,
      default_schedule_channel_id TEXT,
      mod_role_ids TEXT NOT NULL DEFAULT '[]',
      updated_at BIGINT NOT NULL
    );

CREATE TABLE IF NOT EXISTS web_sessions (
      id TEXT PRIMARY KEY,
      audience TEXT NOT NULL DEFAULT 'organizer',
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar TEXT,
      guild_ids TEXT NOT NULL DEFAULT '[]',
      selected_guild_id TEXT,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );

CREATE TABLE IF NOT EXISTS audit_log (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      ts BIGINT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      details TEXT,
      guild_id TEXT
    );

CREATE TABLE IF NOT EXISTS team_role_revocations (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      guild_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','complete','superseded')),
      attempt_count BIGINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at BIGINT NOT NULL DEFAULT 0,
      lease_until BIGINT NOT NULL DEFAULT 0,
      last_error_code TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
CREATE INDEX IF NOT EXISTS idx_team_role_revocations_due ON team_role_revocations(guild_id, status, next_attempt_at, id);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON events;
CREATE POLICY tenant_isolation ON events USING (guild_id = NULLIF(current_setting('app.guild_id', true), '')) WITH CHECK (guild_id = NULLIF(current_setting('app.guild_id', true), ''));

ALTER TABLE event_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON event_templates;
DROP POLICY IF EXISTS tenant_select ON event_templates;
DROP POLICY IF EXISTS tenant_modify ON event_templates;
CREATE POLICY tenant_select ON event_templates FOR SELECT USING (guild_id IS NULL OR guild_id = NULLIF(current_setting('app.guild_id', true), ''));
CREATE POLICY tenant_modify ON event_templates FOR ALL USING (guild_id = NULLIF(current_setting('app.guild_id', true), '')) WITH CHECK (guild_id = NULLIF(current_setting('app.guild_id', true), ''));

ALTER TABLE form_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON form_config;
CREATE POLICY tenant_isolation ON form_config USING (guild_id = NULLIF(current_setting('app.guild_id', true), '')) WITH CHECK (guild_id = NULLIF(current_setting('app.guild_id', true), ''));

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON teams;
CREATE POLICY tenant_isolation ON teams USING (guild_id = NULLIF(current_setting('app.guild_id', true), '')) WITH CHECK (guild_id = NULLIF(current_setting('app.guild_id', true), '') AND (event_id IS NULL OR EXISTS (SELECT 1 FROM events WHERE events.id = teams.event_id AND events.guild_id = teams.guild_id)));

ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON participants;
CREATE POLICY tenant_isolation ON participants USING (guild_id = NULLIF(current_setting('app.guild_id', true), '')) WITH CHECK (guild_id = NULLIF(current_setting('app.guild_id', true), '') AND EXISTS (SELECT 1 FROM events WHERE events.id = participants.event_id AND events.guild_id = participants.guild_id) AND (team_id IS NULL OR EXISTS (SELECT 1 FROM teams WHERE teams.id = participants.team_id AND teams.event_id = participants.event_id AND teams.guild_id = participants.guild_id)));

ALTER TABLE team_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON team_requests;
CREATE POLICY tenant_isolation ON team_requests USING (guild_id = NULLIF(current_setting('app.guild_id', true), '')) WITH CHECK (guild_id = NULLIF(current_setting('app.guild_id', true), '') AND EXISTS (SELECT 1 FROM teams WHERE teams.id = team_requests.team_id AND teams.guild_id = team_requests.guild_id AND teams.event_id IS NOT DISTINCT FROM team_requests.event_id));

ALTER TABLE guild_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON guild_settings;
CREATE POLICY tenant_isolation ON guild_settings USING (guild_id = NULLIF(current_setting('app.guild_id', true), '')) WITH CHECK (guild_id = NULLIF(current_setting('app.guild_id', true), ''));

ALTER TABLE member_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_deletions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON member_deletions;
CREATE POLICY tenant_isolation ON member_deletions USING (guild_id = NULLIF(current_setting('app.guild_id', true), '')) WITH CHECK (guild_id = NULLIF(current_setting('app.guild_id', true), ''));

ALTER TABLE private_answer_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_answer_deletions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON private_answer_deletions;
CREATE POLICY tenant_isolation ON private_answer_deletions USING (guild_id = NULLIF(current_setting('app.guild_id', true), '')) WITH CHECK (guild_id = NULLIF(current_setting('app.guild_id', true), ''));

ALTER TABLE registration_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_answers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON registration_answers;
CREATE POLICY tenant_isolation ON registration_answers USING (EXISTS (SELECT 1 FROM events WHERE events.id = registration_answers.event_id)) WITH CHECK (EXISTS (SELECT 1 FROM events WHERE events.id = registration_answers.event_id));

ALTER TABLE registration_form_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_form_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON registration_form_versions;
CREATE POLICY tenant_isolation ON registration_form_versions USING (EXISTS (SELECT 1 FROM events WHERE events.id = registration_form_versions.event_id)) WITH CHECK (EXISTS (SELECT 1 FROM events WHERE events.id = registration_form_versions.event_id));

ALTER TABLE registration_answer_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_answer_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON registration_answer_history;
CREATE POLICY tenant_isolation ON registration_answer_history USING (EXISTS (SELECT 1 FROM events WHERE events.id = registration_answer_history.event_id)) WITH CHECK (EXISTS (SELECT 1 FROM events WHERE events.id = registration_answer_history.event_id));

ALTER TABLE submission_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_forms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON submission_forms;
CREATE POLICY tenant_isolation ON submission_forms USING (EXISTS (SELECT 1 FROM events WHERE events.id = submission_forms.event_id)) WITH CHECK (EXISTS (SELECT 1 FROM events WHERE events.id = submission_forms.event_id));

ALTER TABLE submission_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_answers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON submission_answers;
CREATE POLICY tenant_isolation ON submission_answers USING (EXISTS (SELECT 1 FROM events WHERE events.id = submission_answers.event_id)) WITH CHECK (EXISTS (SELECT 1 FROM events WHERE events.id = submission_answers.event_id));

ALTER TABLE imported_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE imported_signups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON imported_signups;
CREATE POLICY tenant_isolation ON imported_signups USING (guild_id = NULLIF(current_setting('app.guild_id', true), '') AND EXISTS (SELECT 1 FROM events WHERE events.id = imported_signups.event_id AND events.guild_id = imported_signups.guild_id)) WITH CHECK (guild_id = NULLIF(current_setting('app.guild_id', true), '') AND EXISTS (SELECT 1 FROM events WHERE events.id = imported_signups.event_id AND events.guild_id = imported_signups.guild_id));

ALTER TABLE imported_signup_answer_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE imported_signup_answer_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON imported_signup_answer_history;
CREATE POLICY tenant_isolation ON imported_signup_answer_history USING (EXISTS (SELECT 1 FROM events WHERE events.id = imported_signup_answer_history.event_id AND events.guild_id = NULLIF(current_setting('app.guild_id', true), ''))) WITH CHECK (EXISTS (SELECT 1 FROM events WHERE events.id = imported_signup_answer_history.event_id AND events.guild_id = NULLIF(current_setting('app.guild_id', true), '')));

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_log;
CREATE POLICY tenant_isolation ON audit_log USING (guild_id IS NOT NULL AND guild_id = NULLIF(current_setting('app.guild_id', true), '')) WITH CHECK (guild_id IS NOT NULL AND guild_id = NULLIF(current_setting('app.guild_id', true), ''));
DROP POLICY IF EXISTS host_auth_append ON audit_log;
CREATE POLICY host_auth_append ON audit_log FOR INSERT WITH CHECK (guild_id IS NULL AND ((actor = 'web' AND action = 'web.oauth_start') OR (actor = 'discord' AND action IN ('web.login', 'web.logout'))));

ALTER TABLE team_role_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_role_revocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON team_role_revocations;
CREATE POLICY tenant_isolation ON team_role_revocations USING (guild_id = NULLIF(current_setting('app.guild_id', true), '')) WITH CHECK (guild_id = NULLIF(current_setting('app.guild_id', true), ''));
`;
