#!/usr/bin/env node
/**
 * Long-running admin server with seeded demo data for visual inspection.
 * BOOT_ADMIN=1 node scripts/smoke-admin.mjs
 */
process.env.RUN_DRY = '1';
process.env.ADMIN_PASSWORD = 'smoke-test-pass';
process.env.ADMIN_PORT = '8491';
process.env.ADMIN_SESSION_SECRET = 'smoke-secret';

const { startAdminServer } = await import('../dist/adminweb/server.js');
const { openDb, newId } = await import('../dist/shared/db.js');
const { env } = await import('../dist/shared/env.js');
const { upsertParticipant } = await import('../dist/features/signup/store.js');
const { createTeam, joinTeam } = await import('../dist/features/teams/service.js');
const { validateSignupInput, DEFAULT_FORM } = await import('../dist/features/form/domain.js');
const { updateForm } = await import('../dist/features/form/service.js');

const db = openDb(':memory:');
const G = 'demo-guild';

function seedUser(id, name, experience, roleTrack, skills, teamPref) {
  const v = validateSignupInput(DEFAULT_FORM, {
    displayName: name,
    experience,
    roleTrack,
    skills,
    teamPref,
  });
  if (!v.ok) throw new Error(v.errors.join('; '));
  upsertParticipant(db, 'seed', G, id, v.value);
}

if (process.env.BOOT_ADMIN === '1') {
  updateForm(db, 'seed', { title: 'ChasHack 2026 Signup', teamSize: 4 });

  seedUser('101', 'Alice Nova', 'veteran', 'frontend', ['frontend_react', 'ui_design'], 'private_team');
  seedUser('102', 'Bob Kettle', 'some_experience', 'backend', ['backend_node', 'devops'], 'private_team');
  seedUser('103', 'Carla Pix', 'first_timer', 'design', ['ui_design', 'pm_pitch'], 'private_team');
  seedUser('104', 'Deepak Ops', 'veteran', 'devops', ['devops', 'ai_integrations'], 'private_team');
  seedUser('105', 'Elin SWE', 'some_experience', 'backend', ['backend_csharp', 'backend_node'], 'private_team');
  seedUser('106', 'Fred Full', 'first_timer', 'fullstack', ['frontend_react', 'backend_python'], 'private_team');
  seedUser('107', 'Greta Data', 'some_experience', 'flex', ['data_ml', 'backend_python'], 'with_friends');
  seedUser('108', 'Hugo Zed', 'veteran', 'frontend', ['frontend_vue', 'frontend_mobile'], 'public_team');

  const t = createTeam(db, 'seed', G, 'Compiler Crashers', 'public', '108');
  if (t.ok) {
    joinTeam(db, 'seed', G, '103', t.value.id, 4);
  }
  createTeam(db, 'seed', G, 'Null Pointers', 'private', '101');

  const server = await startAdminServer({ db, config: env(), announce: async () => {} });
  console.log('Seeded admin running on http://localhost:8491 (password: smoke-test-pass)');
  process.on('SIGINT', () => {
    void server.stop().then(() => process.exit(0));
  });
} else {
  // smoke mode (existing checks) — reuse by importing the smoke module inline
  await import('./smoke-run.mjs');
}
