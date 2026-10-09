import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import 'reflect-metadata';
import { applyMigrations } from './migration-runner';

test('caja cerrada: apertura para todos los roles y bloqueo de escrituras', {skip:!process.env.TEST_DATABASE_URL&&'Requiere TEST_DATABASE_URL'}, async()=>{
  const client=new Client({connectionString:process.env.TEST_DATABASE_URL});
  await client.connect();
  const schema=`cash_gate_test_${Date.now()}`;
  let db:typeof import('./db')|undefined;
  try{
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema},public`);
    await applyMigrations(client);
    const roles=['administracion','recepcion','caja','limpieza'] as const;
    const users=[];
    for(const rol of roles){
      users.push((await client.query('INSERT INTO usuario(nombre,email,clave_hash,rol,creado_por) VALUES($1,$2,$3,$4,$5) RETURNING *',[rol,`${rol}@cash-gate.test`,'hash',rol,'Prueba'])).rows[0]);
    }
    await client.query("UPDATE rol_evento SET habilitado=false WHERE evento='cash.open'");
    const url=new URL(process.env.TEST_DATABASE_URL!);
    url.searchParams.set('options',`-c search_path=${schema},public`);
    process.env.DATABASE_URL=url.toString();
    db=await import('./db');
    const {AuthGuard,AuthController}=await import('./auth');
    const {PmsController}=await import('./pms');
    const {PermissionsController}=await import('./permissions');
    const jwt=new JwtService({secret:'cash-gate-test-secret'});
    const guard=new AuthGuard(jwt,new Reflector());
    const pms=new PmsController();
    const permissions=new PermissionsController();
    const auth=new AuthController(jwt);
    const context=(token:string,method:string,controller:any,handler:any)=>({
      switchToHttp:()=>({getRequest:()=>({method,headers:{authorization:`Bearer ${token}`}})}),
      getHandler:()=>handler,getClass:()=>controller,
    }) as any;
    assert.deepEqual(await pms.cashStatus(),{abierta:false});
    for(const user of users){
      const token=await jwt.signAsync({sub:user.idusuario});
      assert.equal(await guard.canActivate(context(token,'GET',PmsController,pms.cashStatus)),true);
      assert.equal(await guard.canActivate(context(token,'POST',PmsController,pms.openCash)),true);
      for(const [method,handler] of [['POST',pms.createReservation],['PATCH',pms.updateTask],['DELETE',pms.deleteRoomType]] as const){
        await assert.rejects(()=>guard.canActivate(context(token,method,PmsController,handler)),(error:any)=>error.status===409&&error.response?.code==='CAJA_CERRADA');
      }
      await assert.rejects(()=>guard.canActivate(context(token,'PATCH',PermissionsController,permissions.setEvent)),(error:any)=>error.status===409);
      await assert.rejects(()=>guard.canActivate(context(token,'PATCH',AuthController,auth.password)),(error:any)=>error.status===409);
      await pms.openCash({monto_inicial_gs:'0'},{user});
      assert.deepEqual(await pms.cashStatus(),{abierta:true});
      assert.equal(await guard.canActivate(context(token,'GET',PmsController,pms.cashStatus)),true);
      const permitted={administracion:pms.createReservation,recepcion:pms.createReservation,caja:pms.closeCash,limpieza:pms.createTask}[user.rol as typeof roles[number]];
      assert.equal(await guard.canActivate(context(token,'POST',PmsController,permitted)),true);
      await client.query('UPDATE caja SET cerrada_en=now() WHERE cerrada_en IS NULL');
      assert.deepEqual(await pms.cashStatus(),{abierta:false});
    }
    const attempts=await Promise.allSettled(users.slice(0,2).map(user=>pms.openCash({monto_inicial_gs:'0'},{user})));
    assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(attempts.filter(result=>result.status==='rejected').length,1);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM caja WHERE cerrada_en IS NULL')).rows[0].count,1);
  }finally{
    if(db)await db.pool.end();
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
