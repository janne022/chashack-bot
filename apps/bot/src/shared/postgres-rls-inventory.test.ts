import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './test-db.js';

const inventory: Record<string, string[]> = {
  teams: ['id','event_id','guild_id','name','kind','owner_id','join_code','role_id','text_channel_id','voice_channel_id','color','created_at'],
  meta: ['key','value'],
  rate_limit_buckets: ['bucket','window_start','count'],
  events: ['id','guild_id','name','description','starts_at','ends_at','signup_starts_at','signup_ends_at','status','form_json','panel_channel_id','category_id','cleanup_delay_hours','cleanup_done','cleanup_warned_72h','cleanup_warned_24h','reminded_24h','match_at','match_locked','discord_event_ids','announcement_channel_id','schedule_channel_id','schedule_json','announcements_json','assignments_json','announced_schedule_ids','created_at','updated_at'],
  event_templates: ['id','guild_id','name','kind','json','created_at'],
  form_config: ['guild_id','json','updated_at'],
  participants: ['event_id','user_id','guild_id','display_name','experience','role_track','skills','team_pref','teammates','team_id','status','block_reason','imported_signup_id','created_at','updated_at'],
  registration_answers: ['event_id','user_id','form_version','answers_json','updated_at'],
  submission_forms: ['event_id','version','enabled','allow_edits','questions_json','updated_at'],
  submission_answers: ['event_id','user_id','form_version','answers_json','created_at','updated_at'],
  imported_signups: ['id','event_id','guild_id','source_row','source_timestamp','form_version','values_json','answers_json','discord_username','discord_user_id','created_at','updated_at'],
  team_requests: ['id','event_id','guild_id','team_id','requester_id','target_id','kind','status','created_at','decided_at'],
  member_deletions: ['guild_id','user_id','deleted_at'],
  private_answer_deletions: ['guild_id','event_id','user_id','deleted_at'],
  guild_settings: ['guild_id','team_category_id','default_announcement_channel_id','default_panel_channel_id','default_category_id','default_cleanup_delay_hours','default_form_template_id','default_schedule_channel_id','mod_role_ids','updated_at'],
  web_sessions: ['id','audience','user_id','username','avatar','guild_ids','selected_guild_id','created_at','expires_at'],
  audit_log: ['id','ts','actor','action','target','details','guild_id'],
  team_role_revocations: ['id','guild_id','event_id','user_id','team_id','role_id','status','attempt_count','next_attempt_at','lease_until','last_error_code','created_at','updated_at'],
};

const policies: Record<string, string> = {
  teams: 'guild_id', events: 'guild_id', event_templates: 'guild_id (global NULL rows read-only)',
  form_config: 'guild_id', participants: 'guild_id', team_requests: 'guild_id', guild_settings: 'guild_id',
  member_deletions: 'guild_id', private_answer_deletions: 'guild_id',
  registration_answers: 'EXISTS parent events row, itself RLS-filtered', imported_signups: 'guild_id plus owned parent event',
  submission_forms: 'EXISTS parent events row, itself RLS-filtered', submission_answers: 'EXISTS parent events row, itself RLS-filtered',
  audit_log: 'non-NULL guild_id only; host NULL rows invisible',
  team_role_revocations: 'guild_id; bounded operational retry data is tenant-scoped',
};

test('RLS inventory exactly matches the live schema, with only documented global tables exempt', async () => {
  const db = await openTestDb();
  try {
    const actual = await db.all<{table_name: string; column_name: string}>("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name,ordinal_position");
    const grouped = actual.reduce<Record<string, string[]>>((result, row) => {
      (result[row.table_name] ??= []).push(row.column_name);
      return result;
    }, {});
    assert.deepEqual(grouped, inventory);
    const states = await db.all<{tablename: string; rowsecurity: boolean; forcerowsecurity: boolean}>("SELECT c.relname AS tablename,c.relrowsecurity AS rowsecurity,c.relforcerowsecurity AS forcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relkind='r' ORDER BY c.relname");
    // The quota table stores only hashed bucket keys and counters; source-address
    // quotas are intentionally shared across guilds, without tenant content.
    const exempt = ['meta','rate_limit_buckets','web_sessions'];
    assert.deepEqual(states.filter((table) => table.rowsecurity && table.forcerowsecurity).map((table) => table.tablename), Object.keys(policies).sort());
    assert.deepEqual(states.filter((table) => !table.rowsecurity).map((table) => table.tablename), exempt);
    assert.ok(states.every((table) => table.rowsecurity === !exempt.includes(table.tablename)));
  } finally { await db.close(); }
});
