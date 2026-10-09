import { config } from 'dotenv';
import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const apiRoot=fileURLToPath(new URL('../',import.meta.url));
config({path:resolve(apiRoot,'../../.env'),quiet:true});
const source=new URL(process.env.DATABASE_URL);
const adminUrl=new URL(source);adminUrl.pathname='/postgres';
const testName=`bdhotel_test_${Date.now()}`;
const client=new Client({connectionString:adminUrl.toString()});
await client.connect();let created=false;
try{
  await client.query(`CREATE DATABASE "${testName}"`);created=true;
  const testUrl=new URL(source);testUrl.pathname=`/${testName}`;
  const tests=process.argv.slice(2);
  const files=tests.length?tests:['src/sifen.test.ts','src/database.test.ts','src/cash.test.ts','src/cash-gate.test.ts','src/rooms.test.ts','src/guests.test.ts','src/sales.test.ts','src/room-analysis.test.ts','src/idempotency.test.ts','src/expenses.test.ts','src/purchases.test.ts','src/permissions.test.ts'];
  const code=await new Promise((ok,fail)=>{
    const child=spawn(process.execPath,['--import','tsx','--test','--test-concurrency=1',...files],{cwd:apiRoot,stdio:'inherit',env:{...process.env,TEST_DATABASE_URL:testUrl.toString()}});
    child.on('error',fail);child.on('exit',ok);
  });
  process.exitCode=code??1;
}finally{
  if(created){await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[testName]);await client.query(`DROP DATABASE "${testName}"`);}
  await client.end();
}
