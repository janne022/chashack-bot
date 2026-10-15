import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activateEvent, createEvent, updateEventForm } from './data.js';
import { DEFAULT_FORM } from '../form/domain.js';
import { openTestDb } from '../../shared/test-db.js';

test('structural form changes conflict on populated published events', async () => {
  const db = await openTestDb();
  try {
    const created = await createEvent(db, 'test', 'guild-a', { name: 'Versioned' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await activateEvent(db, 'test', created.value.id);
    await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',1,1)",
      created.value.id, 'participant-a', 'guild-a', 'A', '', '', '[]', '', '[]');
    const result = await updateEventForm(db, 'test', created.value.id, {
      customQuestions: [{ id: 'new-required', kind: 'text', label: { en: 'New' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' }],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'form_version_conflict');
  } finally { await db.close(); }
});
