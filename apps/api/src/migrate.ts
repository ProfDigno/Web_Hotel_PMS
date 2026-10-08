import { applyMigrations } from './migration-runner';
import { pool } from './db';

async function main() {
  const client=await pool.connect();
  try { await applyMigrations(client); } finally { client.release(); }
  console.log('Esquema aplicado');
  await pool.end();
}
main().catch(async error => { console.error(error); await pool.end(); process.exit(1); });
