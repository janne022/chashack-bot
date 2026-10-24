import { migratePostgres, openPostgres } from './postgres.js';

const databaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl) throw new Error('MIGRATION_DATABASE_URL is required for the one-shot migration command');

const db = await openPostgres(databaseUrl);
try {
  const role = await db.get<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean }>(`
    SELECT rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb
    FROM pg_roles WHERE rolname=current_user`);
  if (!role || role.rolname !== 'chashack_migrate' || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb) {
    throw new Error('Migration connection must use the restricted chashack_migrate role');
  }
  await migratePostgres(db);
  console.log('PostgreSQL schema migration completed');
} finally {
  await db.close();
}
