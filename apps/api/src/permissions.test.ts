import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { Reflector } from '@nestjs/core';
import 'reflect-metadata';
import { applyMigrations } from './migration-runner';
import { EVENTS, ROUTE_EVENTS } from './permission-catalog';

test('cada ruta protegida tiene evento y cada evento está en la matriz',()=>{
  const names=new Set(EVENTS.map(event=>event.key));
  for(const [controller,routes] of Object.entries(ROUTE_EVENTS)){
    assert.ok(Object.keys(routes).length>0,controller);
    const file={PmsController:'pms',SalesController:'sales',PurchasesController:'purchases',ExpensesController:'expenses',FiscalController:'fiscal'}[controller];
    assert.ok(file,controller);
    const source=readFileSync(join(__dirname,`${file}.ts`),'utf8');
    const handlers=[...source.matchAll(/@(?:Get|Post|Put|Patch|Delete)\([^)]*\)\s+async\s+(\w+)\s*\(/g)].map(match=>match[1]);
    assert.ok(handlers.length>0,controller);
    for(const handler of handlers)assert.ok(routes[handler],`${controller}.${handler} sin evento`);
    for(const handler of Object.keys(routes))assert.ok(handlers.includes(handler),`${controller}.${handler} sin ruta`);
    for(const [route,events] of Object.entries(routes)){
      assert.ok(events.length>0,`${controller}.${route}`);
      for(const event of events)assert.ok(names.has(event),`${controller}.${route}: ${event}`);
    }
  }
  assert.equal(names.size,EVENTS.length);
  const migration=readFileSync(join(__dirname,'../sql/018_permisos_eventos.sql'),'utf8');
  for(const event of EVENTS){
    const match=migration.match(new RegExp(`\\('${event.key.replaceAll('.','\\.')}',ARRAY\\[([^\\]]*)\\]::text\\[\\]\\)`));
    assert.ok(match,`${event.key} ausente de la migración`);
    const roles=[...match[1].matchAll(/'([^']+)'/g)].map(item=>item[1]);
    assert.deepEqual(roles.sort(),['administracion',...event.defaults].sort(),`${event.key}: permisos iniciales`);
  }
});

test('migración, revocación 403, ruta compartida y cambio de rol', {skip:!process.env.TEST_DATABASE_URL&&'Requiere TEST_DATABASE_URL'},async()=>{
  const client=new Client({connectionString:process.env.TEST_DATABASE_URL});await client.connect();
  const schema=`permission_test_${Date.now()}`;
  let db:typeof import('./db')|undefined;
  try{
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema},public`);
    await applyMigrations(client);
    const roleCount=(await client.query('SELECT count(*)::int AS count FROM rol_app')).rows[0].count;
    const eventCount=(await client.query('SELECT count(*)::int AS count FROM evento_permiso')).rows[0].count;
    const matrixCount=(await client.query('SELECT count(*)::int AS count FROM rol_evento')).rows[0].count;
    assert.equal(roleCount,4);assert.equal(eventCount,EVENTS.length);assert.equal(matrixCount,4*EVENTS.length);
    assert.equal((await client.query("SELECT habilitado FROM rol_evento WHERE rol='recepcion' AND evento='reservations.create'")).rows[0].habilitado,true);
    assert.equal((await client.query("SELECT habilitado FROM rol_evento WHERE rol='limpieza' AND evento='reservations.create'")).rows[0].habilitado,false);
    const admin=(await client.query("INSERT INTO usuario(nombre,email,clave_hash,rol,creado_por) VALUES('Admin','permission-admin@test.local','hash','administracion','Prueba') RETURNING *")).rows[0];
    const user=(await client.query("INSERT INTO usuario(nombre,email,clave_hash,rol,creado_por) VALUES('Recepción','permission-user@test.local','hash','recepcion','Prueba') RETURNING *")).rows[0];
    const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${schema},public`);process.env.DATABASE_URL=url.toString();
    db=await import('./db');
    const { AuthGuard }=await import('./auth');const { PmsController }=await import('./pms');const { PermissionsController }=await import('./permissions');
    const jwt=new JwtService({secret:'permission-test-secret'}),guard=new AuthGuard(jwt,new Reflector()),pms=new PmsController(),permissions=new PermissionsController();
    const request:any={headers:{authorization:`Bearer ${await jwt.signAsync({sub:user.idusuario})}`}};
    const context=(handler:any)=>({switchToHttp:()=>({getRequest:()=>request}),getHandler:()=>handler,getClass:()=>PmsController}) as any;
    assert.equal(await guard.canActivate(context(pms.createReservation)),true);
    assert.equal(await guard.canActivate(context(pms.rooms)),true);
    const adminRequest={user:admin};
    await permissions.setEvent('recepcion','reservations.create',{habilitado:false},adminRequest);
    await assert.rejects(()=>guard.canActivate(context(pms.createReservation)),(error:any)=>error.status===403);
    assert.equal(await guard.canActivate(context(pms.rooms)),true);
    await pms.userState(String(user.idusuario),{rol:'limpieza'},adminRequest);
    await assert.rejects(()=>guard.canActivate(context(pms.roomsAnalysis)),(error:any)=>error.status===403);
    assert.equal(await guard.canActivate(context(pms.rooms)),true);
    const updated=await pms.userState(String(user.idusuario),{nombre:'Usuario editado',email:'editado@test.local',password:'clave-nueva-segura',activo:true},adminRequest);
    assert.equal(updated.nombre,'Usuario editado');assert.equal(updated.email,'editado@test.local');assert.equal(updated.rol,'limpieza');
    const hash=(await client.query('SELECT clave_hash FROM usuario WHERE idusuario=$1',[user.idusuario])).rows[0].clave_hash;
    assert.equal(await bcrypt.compare('clave-nueva-segura',hash),true);
    await pms.userState(String(user.idusuario),{nombre:'Usuario sin cambio de clave'},adminRequest);
    assert.equal((await client.query('SELECT clave_hash FROM usuario WHERE idusuario=$1',[user.idusuario])).rows[0].clave_hash,hash);
    await assert.rejects(()=>pms.userState(String(user.idusuario),{email:'permission-admin@test.local'},adminRequest),(error:any)=>error.status===409);
    assert.equal((await client.query('SELECT email FROM usuario WHERE idusuario=$1',[user.idusuario])).rows[0].email,'editado@test.local');
    assert.equal((await permissions.mine({user:{rol:'limpieza'}})).eventos.includes('housekeeping.list'),true);
    await assert.rejects(()=>permissions.setEvent('administracion','settings.permissions',{habilitado:false},adminRequest));
    assert.ok((await client.query("SELECT count(*)::int AS count FROM auditoria WHERE entidad IN ('rol_evento','usuario')")).rows[0].count>=2);
  } finally {
    if(db)await db.pool.end();
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
