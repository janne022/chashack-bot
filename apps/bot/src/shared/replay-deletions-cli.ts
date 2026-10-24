import { replayPrivateAnswerDeletions } from '../features/registration/retention.js';
import { replayMemberDeletions } from '../features/signup/departures.js';
import { parseDatabaseUrl } from './db-config.js';
import { openPostgres } from './postgres.js';

// Use only against an isolated restored database before it accepts traffic.
const databaseUrl = process.env.DELETION_REPLAY_DATABASE_URL;
if (!databaseUrl) throw new Error('DELETION_REPLAY_DATABASE_URL is required for deletion replay');
const target = parseDatabaseUrl(databaseUrl);
if (!/^restore_[a-z0-9_]{1,40}$/.test(target.database) || process.env.DELETION_REPLAY_CONFIRM !== target.database) {
  throw new Error('Deletion replay requires a restore_<id> database and a matching DELETION_REPLAY_CONFIRM value');
}
const db = await openPostgres(databaseUrl);
try {
  const role = await db.get<{ rolname: string; rolsuper: boolean }>(`SELECT rolname,rolsuper FROM pg_roles WHERE rolname=current_user`);
  if (!role || role.rolname !== 'chashack_bootstrap' || !role.rolsuper) throw new Error('Deletion replay requires the isolated recovery bootstrap role');
  const members = await db.all<{ guild_id: string; user_id: string; deleted_at: number | string }>(
    'SELECT guild_id,user_id,deleted_at FROM member_deletions ORDER BY guild_id,user_id',
  );
  const answers = await db.all<{ guild_id: string; event_id: string; user_id: string; deleted_at: number | string }>(
    'SELECT guild_id,event_id,user_id,deleted_at FROM private_answer_deletions ORDER BY guild_id,event_id,user_id',
  );
  await replayMemberDeletions(db, members.map((row) => ({ guildId: row.guild_id, userId: row.user_id, deletedAt: Number(row.deleted_at) })));
  await replayPrivateAnswerDeletions(db, answers.map((row) => ({ guildId: row.guild_id, eventId: row.event_id, userId: row.user_id, deletedAt: Number(row.deleted_at) })));
  console.log(`Deletion ledger replay completed: ${members.length} member records, ${answers.length} private-answer records`);
} finally {
  await db.close();
}

