import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { defer, from, lastValueFrom } from 'rxjs';
import 'reflect-metadata';
import { applyMigrations } from './migration-runner';

test('gastos: egresos, historial, análisis, permisos, reintentos y cierres concurrentes',{skip:!process.env.TEST_DATABASE_URL&&'Requiere TEST_DATABASE_URL'},async()=>{
  const client=new Client({connectionString:process.env.TEST_DATABASE_URL});await client.connect();
  const schema=`expense_test_${Date.now()}`;let db:typeof import('./db')|undefined;let parallel:Client|undefined;
  try{
    await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema},public`);await applyMigrations(client);await applyMigrations(client);
    const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${schema},public`);process.env.DATABASE_URL=url.toString();
    db=await import('./db');const {ExpensesController}=await import('./expenses');const {PmsController}=await import('./pms');const {IdempotencyInterceptor}=await import('./idempotency');
    const expenses=new ExpensesController(),pms=new PmsController(),interceptor=new IdempotencyInterceptor();
    const user=(await client.query("INSERT INTO usuario(nombre,email,clave_hash,rol,creado_por) VALUES('Prueba','expenses@test.local','hash','administracion','Prueba') RETURNING *")).rows[0],req={user};
    const t=await expenses.createType({nombre:' Servicios '},req);assert.equal(t.nombre,'Servicios');
    await assert.rejects(()=>expenses.createType({nombre:'SERVICIOS'},req));await assert.rejects(()=>expenses.createType({nombre:' '},req));
    const other=await expenses.createType({nombre:'Insumos'},req);
    const methods=(await client.query('SELECT * FROM forma_pago ORDER BY idforma_pago')).rows,ef=methods.find(m=>m.es_efectivo),card=methods.find(m=>!m.es_efectivo);
    const body={fk_idgasto_tipo:t.idgasto_tipo,fecha_gasto:'2020-02-28',descripcion:'Energía eléctrica',monto_gs:'120000',fk_idforma_pago:ef.idforma_pago};
    await assert.rejects(()=>expenses.create(body,req),/Abrí una caja/);
    const cash=await pms.openCash({monto_inicial_gs:'500000'},req);
    for(const value of ['0','-1','1.5','abc','9223372036854775808'])await assert.rejects(()=>expenses.create({...body,monto_gs:value},req));
    for(const value of ['2025-02-29','2020-02-30','9999-01-01','invalid'])await assert.rejects(()=>expenses.create({...body,fecha_gasto:value},req));
    await assert.rejects(()=>expenses.create({...body,descripcion:' '},req));
    await assert.rejects(()=>expenses.create({...body,fk_idgasto_tipo:'99999'},req));
    await assert.rejects(()=>expenses.create({...body,fk_idforma_pago:'99999'},req));
    const key=randomUUID();const run=()=>lastValueFrom(interceptor.intercept({switchToHttp:()=>({getRequest:()=>({method:'POST',path:'/api/gastos',headers:{'idempotency-key':key},body,user})})} as any,{handle:()=>defer(()=>from(expenses.create(body,req)))}));
    const [first,replay]=await Promise.all([run(),run()]) as any[];assert.deepEqual(first,replay);assert.deepEqual(await run(),first);
    const second=await expenses.create({...body,fk_idgasto_tipo:other.idgasto_tipo,fk_idforma_pago:card.idforma_pago,fecha_gasto:'2020-03-01',monto_gs:'80000'},req);
    let detail=await pms.cashDetails(cash.idcaja);assert.equal(detail.resumen.egresos_gs,'200000');assert.equal(detail.efectivo_esperado_gs,'380000');assert.equal(detail.resumen.no_efectivo_gs,'-80000');assert.equal(detail.movimientos.length,2);assert.equal(detail.movimientos[0].fk_idpago,null);assert.equal(detail.movimientos[0].habitaciones,'—');
    const movement=detail.movimientos.find((m:any)=>m.fk_idgasto===first.idgasto);assert.equal(movement.tipo,'egreso');assert.equal(movement.monto_gs,'120000');assert.equal(movement.fecha_movimiento.toISOString(),first.fecha_creado);
    assert.equal((await client.query('SELECT count(*)::int n FROM caja_detalle WHERE fk_idgasto=$1',[first.idgasto])).rows[0].n,1);
    await assert.rejects(()=>client.query('UPDATE gasto SET monto_gs=1 WHERE idgasto=$1',[first.idgasto]));
    await assert.rejects(()=>client.query('UPDATE caja_detalle SET fk_idgasto=NULL WHERE fk_idgasto=$1',[first.idgasto]));
    await assert.rejects(()=>pms.updatePaymentMethod(ef.idforma_pago,{es_efectivo:false},req));
    await assert.rejects(()=>client.query('UPDATE forma_pago SET es_efectivo=FALSE WHERE idforma_pago=$1',[ef.idforma_pago]));
    assert.equal((await pms.paymentMethodsAdmin()).find(m=>m.idforma_pago===ef.idforma_pago).utilizada,true);
    let analysis=await expenses.analysis({desde:'2020-02-28',hasta:'2020-03-01'});assert.equal(analysis.resumen.total_gs,'200000');assert.equal(analysis.resumen.promedio_gs,'100000');assert.equal(analysis.resumen.promedio_diario_gs,'66666');assert.equal(analysis.dias.length,3);assert.equal(analysis.dias[1].total_gs,'0');assert.equal(analysis.tipos[0].porcentaje,60);assert.equal(analysis.formas_pago.length,2);assert.equal(analysis.mayores[0].idgasto,first.idgasto);
    assert.equal((await expenses.analysis({desde:'2020-02-28',hasta:'2020-02-28',forma_pago:ef.idforma_pago,tipo:t.idgasto_tipo})).resumen.total_gs,'120000');
    assert.equal((await expenses.analysis({desde:'2019-01-01',hasta:'2019-01-02'})).resumen.total_gs,'0');
    await assert.rejects(()=>expenses.analysis({desde:'2020-03-01',hasta:'2020-02-28'}));
    assert.equal((await expenses.list({q:'eléctrica',tipo:t.idgasto_tipo})).total,1);assert.equal((await expenses.list({pagina:'2'})).registros.length,0);await assert.rejects(()=>expenses.list({pagina:'0'}));
    await expenses.updateType(t.idgasto_tipo,{nombre:'Servicios básicos',activo:false},req);await pms.updatePaymentMethod(card.idforma_pago,{activo:false},req);
    await assert.rejects(()=>expenses.create(body,req));await assert.rejects(()=>expenses.create({...body,fk_idgasto_tipo:other.idgasto_tipo,fk_idforma_pago:card.idforma_pago},req));
    assert.equal((await expenses.detail(first.idgasto)).tipo_nombre,'Servicios básicos');assert.equal((await expenses.options()).tipos.find(x=>x.idgasto_tipo===t.idgasto_tipo).activo,false);
    await assert.rejects(()=>expenses.annul(first.idgasto,{motivo:' '},req));
    await expenses.annul(first.idgasto,{motivo:'Duplicado'},req);await expenses.annul(first.idgasto,{motivo:'Reintento'},req);
    assert.equal((await pms.cash()).resumen.egresos_gs,'80000');assert.equal((await expenses.list({estado:'anulado'})).total,1);
    await assert.rejects(()=>client.query('UPDATE gasto SET anulado=FALSE WHERE idgasto=$1',[first.idgasto]));
    const bills={100000:'5',50000:'0',20000:'0',10000:'0',5000:'0',1000:'0'};
    const closed=await pms.closeCash({billetes:bills},req);await expenses.annul(second.idgasto,{motivo:'Error de carga'},req);
    detail=await pms.cashDetails(cash.idcaja);assert.equal(detail.resumen.egresos_gs,'0');assert.equal(detail.cierre_totales.egresos_gs,'80000');assert.equal(detail.ajuste_posterior_gs,'80000');assert.deepEqual(detail.cierre_comprobante,closed.cierre_comprobante);
    analysis=await expenses.analysis({desde:'2020-02-28',hasta:'2020-03-01'});assert.equal(analysis.resumen.cantidad,0);assert.equal(analysis.resumen.anulados,2);assert.equal(analysis.resumen.anulados_gs,'200000');
    assert.equal((await client.query("SELECT count(*)::int n FROM auditoria WHERE entidad='gasto' AND accion='anular'")).rows[0].n,2);
    await expenses.updateType(t.idgasto_tipo,{activo:true},req);const next=await pms.openCash({monto_inicial_gs:'0'},req);
    parallel=new Client({connectionString:url.toString()});await parallel.connect();await parallel.query('BEGIN');await parallel.query('SELECT idcaja FROM caja WHERE idcaja=$1 FOR UPDATE',[next.idcaja]);
    const concurrent=expenses.create(body,req).then(()=>null,e=>e);await parallel.query('UPDATE caja SET cerrada_en=now(),cierre_totales=caja_totales(idcaja) WHERE idcaja=$1',[next.idcaja]);await parallel.query('COMMIT');assert.ok(await concurrent);assert.equal((await client.query('SELECT count(*)::int n FROM gasto WHERE fk_idcaja=$1',[next.idcaja])).rows[0].n,0);
    const last=await pms.openCash({monto_inicial_gs:'0'},req);const lastExpense=await expenses.create(body,req);
    await Promise.all([pms.closeCash({billetes:{...bills,100000:'0'}},req),expenses.annul(lastExpense.idgasto,{motivo:'Corrección concurrente'},req)]);
    const final=await pms.cashDetails(last.idcaja);assert.equal(final.resumen.egresos_gs,'0');assert.equal(final.movimientos[0].anulado,true);assert.equal(BigInt(final.resumen.neto_gs)-BigInt(final.cierre_totales.neto_gs),BigInt(final.ajuste_posterior_gs));
    const pagingCash=await pms.openCash({monto_inicial_gs:'0'},req);
    await client.query("INSERT INTO gasto(fk_idgasto_tipo,fecha_gasto,descripcion,monto_gs,fk_idforma_pago,fk_idcaja,creado_por) SELECT $1,'2020-01-01','Paginación '||i,1000,$2,$3,'Prueba' FROM generate_series(1,51) i",[t.idgasto_tipo,ef.idforma_pago,pagingCash.idcaja]);
    const page1=await expenses.list({q:'Paginación',pagina:'1'}),page2=await expenses.list({q:'Paginación',pagina:'2'});assert.equal(page1.total,51);assert.equal(page1.registros.length,50);assert.equal(page2.registros.length,1);assert.notEqual(page1.registros[49].idgasto,page2.registros[0].idgasto);
    const {AuthGuard}=await import('./auth');const {JwtService}=await import('@nestjs/jwt');const {Reflector}=await import('@nestjs/core');const jwt=new JwtService({secret:'expense-test-secret'}),guard=new AuthGuard(jwt,new Reflector());
    for(const role of ['administracion','caja','recepcion','limpieza']){
      await client.query('UPDATE usuario SET rol=$1 WHERE idusuario=$2',[role,user.idusuario]);const token=await jwt.signAsync({sub:user.idusuario});
      for(const method of ['create','list','detail','annul','analysis','createType','updateType'] as const){const permitted=role==='administracion'||role==='caja'&&!['analysis','createType','updateType'].includes(method);const context={switchToHttp:()=>({getRequest:()=>({headers:{authorization:'Bearer '+token}})}),getHandler:()=>ExpensesController.prototype[method],getClass:()=>ExpensesController} as any;if(permitted)assert.equal(await guard.canActivate(context),true);else await assert.rejects(()=>guard.canActivate(context));}
    }
  }finally{if(parallel)await parallel.end();if(db)await db.pool.end();await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await client.end();}
});
