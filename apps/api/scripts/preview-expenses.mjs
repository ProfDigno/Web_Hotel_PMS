import { config } from 'dotenv';
import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
config({path:resolve('.env'),quiet:true});
const source=new URL(process.env.DATABASE_URL),adminUrl=new URL(source);adminUrl.pathname='/postgres';
const name='bdhotel_expense_preview_'+Date.now(),admin=new Client({connectionString:adminUrl.toString()});await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);
source.pathname='/'+name;process.env.DATABASE_URL=source.toString();process.env.API_PORT='3016';process.env.PORT='3016';process.env.PMS_DEV='false';process.env.JWT_SECRET=randomUUID()+randomUUID();
const require=createRequire(import.meta.url),{applyMigrations}=require('../dist/migration-runner.js');const db=new Client({connectionString:source.toString()});await db.connect();await applyMigrations(db);
const bcrypt=require('bcryptjs');const u=(await db.query("INSERT INTO usuario(nombre,email,clave_hash,rol,creado_por) VALUES('Revisión de gastos','preview@test.local',$1,'administracion','Prueba') RETURNING *",[await bcrypt.hash('Preview-Gastos-2026',10)])).rows[0];
const cash=(await db.query("INSERT INTO caja(fk_idusuario_apertura,monto_inicial_gs,creado_por) VALUES($1,1000000,'Prueba') RETURNING *",[u.idusuario])).rows[0];
const methods=(await db.query('SELECT * FROM forma_pago ORDER BY idforma_pago')).rows;
for(const [index,nombre] of ['Servicios','Insumos de limpieza','Mantenimiento'].entries()){
  const t=(await db.query("INSERT INTO gasto_tipo(nombre,creado_por) VALUES($1,'Prueba') RETURNING *",[nombre])).rows[0];
  for(let i=0;i<3;i++)await db.query("INSERT INTO gasto(fk_idgasto_tipo,fecha_gasto,descripcion,monto_gs,fk_idforma_pago,fk_idcaja,creado_por) VALUES($1,(now() AT TIME ZONE 'America/Asuncion')::date-$2::int,$3,$4,$5,$6,'Prueba')",[t.idgasto_tipo,i,`${nombre} del hotel`,(index+1)*25000+i*5000,methods[index%methods.length].idforma_pago,cash.idcaja]);
}
await db.end();console.log('PREVIEW_DATABASE='+name);
const child=spawn(process.execPath,['apps/api/dist/main.js'],{stdio:'inherit',env:process.env});
let cleaning=false;async function cleanup(){if(cleaning)return;cleaning=true;child.kill();await new Promise(r=>child.once('exit',r));await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',[name]);await admin.query(`DROP DATABASE "${name}"`);await admin.end();process.exit(0)}
process.on('SIGINT',cleanup);process.on('SIGTERM',cleanup);process.stdin.on('data',cleanup);
