import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

config({ path: resolve(__dirname, '../../../.env') });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no configurada');
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
const activeTransaction = new AsyncLocalStorage<PoolClient>();
export async function query<T extends QueryResultRow = any>(sql: string, values: unknown[] = []) {
  const client=activeTransaction.getStore();
  return client ? client.query<T>(sql, values) : pool.query<T>(sql, values);
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const existing=activeTransaction.getStore();
  if(existing) return fn(existing);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await activeTransaction.run(client,()=>fn(client));
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
