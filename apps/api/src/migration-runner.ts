import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client, PoolClient } from 'pg';

// Each migration and its registry entry commit together on the same connection.
export async function applyMigrations(client:Client|PoolClient,dir=join(__dirname,'../sql')) {
  await client.query('SELECT pg_advisory_lock(7410586)');
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS migracion (
      idmigracion BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      nombre TEXT NOT NULL UNIQUE,
      fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(),
      creado_por TEXT NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT TRUE
    )`);
    for(const file of readdirSync(dir).filter(file=>/^\d+_.*\.sql$/.test(file)).sort()) {
      if((await client.query('SELECT 1 FROM migracion WHERE nombre=$1',[file])).rowCount)continue;
      const sql=readFileSync(join(dir,file),'utf8').replace(/^\s*BEGIN;\s*/i,'').replace(/\s*COMMIT;\s*$/i,'');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query("INSERT INTO migracion(nombre,creado_por) VALUES($1,'Migración')",[file]);
        await client.query('COMMIT');
      } catch(error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally { await client.query('SELECT pg_advisory_unlock(7410586)'); }
}
