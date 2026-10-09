import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import 'reflect-metadata';
import { applyMigrations } from './migration-runner';
import { countCash, createCashCloseTicket } from './cash-close';

const zeroBills=()=>({100000:'0',50000:'0',20000:'0',10000:'0',5000:'0',1000:'0'});

test('conteo de billetes: total, cero y datos inválidos',()=>{
  assert.equal(countCash({100000:'1',50000:'1',20000:'1',10000:'1',5000:'1',1000:'1'}).total,'186000');
  assert.equal(countCash(zeroBills()).total,'0');
  for(const invalid of ['', '-1', '1.5', 'abc'])assert.throws(()=>countCash({...zeroBills(),100000:invalid}));
  assert.throws(()=>countCash({...zeroBills(),100000:undefined}));
  assert.throws(()=>countCash({100000:'1'}));
  assert.throws(()=>countCash({...zeroBills(),otro:'1'}));
});

test('caja detalle: migración, transacciones, anulación y cierre concurrente', {skip:!process.env.TEST_DATABASE_URL&&'Requiere TEST_DATABASE_URL'}, async()=>{
  const client=new Client({connectionString:process.env.TEST_DATABASE_URL}); await client.connect();
  const schema=`cash_test_${Date.now()}`;
  let db:typeof import('./db')|undefined;
  let parallel:Client|undefined;
  try{
    await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET search_path TO ${schema},public`);
    await client.query(readFileSync(join(__dirname,'../sql/001_init.sql'),'utf8'));
    const user=(await client.query("INSERT INTO usuario(nombre,email,clave_hash,rol,creado_por) VALUES('Prueba','cash@test.local','hash','administracion','Prueba') RETURNING *")).rows[0];
    const customer=(await client.query("INSERT INTO cliente(nombre,apellido,creado_por) VALUES('Ana','Pérez','Prueba') RETURNING *")).rows[0];
    const reservation=(await client.query("INSERT INTO reserva(fk_idcliente,fecha_entrada,fecha_salida,creado_por) VALUES($1,'2026-10-10','2026-10-13','Prueba') RETURNING *",[customer.idcliente])).rows[0];
    await client.query("INSERT INTO movimiento(fk_idreserva,tipo,descripcion,cantidad,monto_unitario_gs,fecha_servicio,creado_por) VALUES($1,'alojamiento','Estadía',1,1000000,'2026-10-10','Prueba')",[reservation.idreserva]);
    const type=(await client.query("INSERT INTO tipo_habitacion(nombre,capacidad,creado_por) VALUES('Doble',2,'Prueba') RETURNING *")).rows[0];
    for(const number of ['101','102']){
      const room=(await client.query("INSERT INTO habitacion(numero,fk_idtipo_habitacion,creado_por) VALUES($1,$2,'Prueba') RETURNING *",[number,type.idtipo_habitacion])).rows[0];
      await client.query("INSERT INTO reserva_habitacion(fk_idreserva,fk_idhabitacion,fecha_entrada,fecha_salida,tarifa_noche_gs,creado_por) VALUES($1,$2,'2026-10-10','2026-10-13',200000,'Prueba')",[reservation.idreserva,room.idhabitacion]);
    }
    const cash=(await client.query("INSERT INTO caja(fk_idusuario_apertura,monto_inicial_gs,creado_por) VALUES($1,10000,'Prueba') RETURNING *",[user.idusuario])).rows[0];
    const old=(await client.query("INSERT INTO pago(fk_idreserva,fk_idcaja,metodo,monto_gs,creado_por) VALUES($1,$2,'efectivo',200000,'Prueba') RETURNING *",[reservation.idreserva,cash.idcaja])).rows[0];
    const legacy=(await client.query("INSERT INTO caja(fk_idusuario_apertura,monto_inicial_gs,cerrada_en,monto_cierre_gs,creado_por) VALUES($1,500,now(),1700,'Prueba') RETURNING *",[user.idusuario])).rows[0];
    await client.query("INSERT INTO pago(fk_idreserva,fk_idcaja,metodo,monto_gs,creado_por) VALUES($1,$2,'efectivo',1200,'Prueba')",[reservation.idreserva,legacy.idcaja]);
    const legacyAnnulled=(await client.query("INSERT INTO pago(fk_idreserva,fk_idcaja,metodo,monto_gs,anulado,creado_por) VALUES($1,$2,'efectivo',300,TRUE,'Prueba') RETURNING *",[reservation.idreserva,legacy.idcaja])).rows[0];
    const withoutCash=(await client.query("INSERT INTO pago(fk_idreserva,metodo,monto_gs,creado_por) VALUES($1,'efectivo',900,'Prueba') RETURNING *",[reservation.idreserva])).rows[0];
    const migration=readFileSync(join(__dirname,'../sql/004_caja_detalle.sql'),'utf8');
    await client.query(migration); await client.query(migration);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM caja_detalle')).rows[0].n,3);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM caja_detalle WHERE fk_idpago=$1',[withoutCash.idpago])).rows[0].n,0);
    assert.equal((await client.query('SELECT anulado FROM caja_detalle WHERE fk_idpago=$1',[legacyAnnulled.idpago])).rows[0].anulado,true);
    const legacyClosed=(await client.query('SELECT * FROM caja WHERE idcaja=$1',[legacy.idcaja])).rows[0];assert.equal(legacyClosed.cierre_reconstruido,true);assert.equal(legacyClosed.cierre_totales.neto_gs,'1200');assert.equal(legacyClosed.monto_cierre_gs,'1700');
    await applyMigrations(client);
    await client.query(readFileSync(join(__dirname,'../sql/005_formas_pago.sql'),'utf8'));
    await applyMigrations(client);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM migracion')).rows[0].n,readdirSync(join(__dirname,'../sql')).filter(file=>/^\d+_.*\.sql$/.test(file)).length);
    const methods=(await client.query('SELECT * FROM forma_pago')).rows;
    assert.equal(methods.length,3);
    const efectivo=methods.find(f=>f.nombre==='Efectivo').idforma_pago,tarjeta=methods.find(f=>f.nombre==='Tarjeta').idforma_pago;
    assert.equal((await client.query('SELECT fk_idforma_pago FROM pago WHERE idpago=$1',[withoutCash.idpago])).rows[0].fk_idforma_pago,efectivo);
    assert.equal((await client.query('SELECT fk_idforma_pago FROM caja_detalle WHERE fk_idpago=$1',[legacyAnnulled.idpago])).rows[0].fk_idforma_pago,efectivo);
    assert.deepEqual((await client.query('SELECT cierre_totales FROM caja WHERE idcaja=$1',[legacy.idcaja])).rows[0].cierre_totales,legacyClosed.cierre_totales);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name IN ('pago','caja_detalle') AND column_name='metodo'",[schema])).rows[0].n,0);
    for(const table of ['forma_pago','migracion']){
      const columns=(await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[schema,table])).rows.map(x=>x.column_name);
      for(const column of ['id'+table,'fecha_creado','creado_por','activo'])assert.ok(columns.includes(column));
    }
    const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${schema},public`);process.env.DATABASE_URL=url.toString();
    db=await import('./db');const {PmsController}=await import('./pms');const controller=new PmsController();const req={user:{idusuario:user.idusuario,nombre:user.nombre,rol:'administracion'},events:new Set(['reservations.financial_detail'])};
    const {AuthGuard}=await import('./auth');const {JwtService}=await import('@nestjs/jwt');const {Reflector}=await import('@nestjs/core');
    const jwt=new JwtService({secret:'cash-test-secret'}),guard=new AuthGuard(jwt,new Reflector());
    for(const role of ['administracion','caja','recepcion','limpieza']){
      const roleUser=(await client.query("INSERT INTO usuario(nombre,email,clave_hash,rol,creado_por) VALUES($1,$2,'hash',$1,'Prueba') RETURNING *",[role,`${role}@test.local`])).rows[0];
      const request={headers:{authorization:`Bearer ${await jwt.signAsync({sub:roleUser.idusuario})}`}};
      const ctx={switchToHttp:()=>({getRequest:()=>request}),getHandler:()=>controller.annulPayment,getClass:()=>PmsController} as any;
      if(['administracion','caja'].includes(role))assert.equal(await guard.canActivate(ctx),true);else await assert.rejects(()=>guard.canActivate(ctx));
    }
    assert.deepEqual((await controller.cashHistory('abierta')).map(c=>c.idcaja),[cash.idcaja]);
    assert.deepEqual((await controller.cashHistory('cerrada')).map(c=>c.idcaja),[legacy.idcaja]);
    assert.equal((await controller.cashHistory()).length,2);
    for(const invalid of ['','todos','CERRADA']) await assert.rejects(()=>controller.cashHistory(invalid),(e:any)=>e.getStatus()===400);
    for(const role of ['administracion','caja','recepcion','limpieza']){
      const roleUser=(await client.query('SELECT idusuario FROM usuario WHERE rol=$1 ORDER BY idusuario LIMIT 1',[role])).rows[0];
      const request={headers:{authorization:`Bearer ${await jwt.signAsync({sub:roleUser.idusuario})}`}};
      for(const handler of [controller.cashHistory,controller.cashDetails,controller.cash,controller.cashTicket]){
        const ctx={switchToHttp:()=>({getRequest:()=>request}),getHandler:()=>handler,getClass:()=>PmsController} as any;
        if(['administracion','caja'].includes(role))assert.equal(await guard.canActivate(ctx),true);else await assert.rejects(()=>guard.canActivate(ctx));
      }
    }
    await assert.rejects(()=>controller.createPaymentMethod({nombre:' '},req));
    await assert.rejects(()=>controller.createPaymentMethod({nombre:'Efectivo'},req),(e:any)=>e.getStatus()===409);
    await assert.rejects(()=>controller.createPaymentMethod({nombre:' efectivo '},req),(e:any)=>e.getStatus()===409);
    for(const body of [{nombre:'Inválida',es_efectivo:'true'},{nombre:'Inválida',activo:1},{nombre:'Inválida',descripcion:123}])await assert.rejects(()=>controller.createPaymentMethod(body,req),(e:any)=>e.getStatus()===400);
    await assert.rejects(()=>controller.updatePaymentMethod('999999',{nombre:'Nada'},req),(e:any)=>e.getStatus()===404);
    await assert.rejects(()=>controller.updatePaymentMethod(efectivo,{es_efectivo:false},req),(e:any)=>e.getStatus()===400);
    await assert.rejects(()=>client.query('UPDATE forma_pago SET es_efectivo=FALSE WHERE idforma_pago=$1',[efectivo]),(e:any)=>e.code==='23514');
    const custom=await controller.createPaymentMethod({nombre:'Billetera',descripcion:'Pago digital',es_efectivo:false},req);
    await controller.updatePaymentMethod(custom.idforma_pago,{nombre:'Billetera móvil',descripcion:'Sin efectivo',activo:false},req);
    assert.ok(!(await controller.paymentMethods()).some(f=>f.idforma_pago===custom.idforma_pago));
    assert.ok((await controller.paymentMethodsAdmin()).some(f=>f.idforma_pago===custom.idforma_pago&&!f.activo));
    await assert.rejects(()=>controller.payment(reservation.idreserva,{fk_idforma_pago:custom.idforma_pago,monto_gs:'1'},req));
    await assert.rejects(()=>controller.payment(reservation.idreserva,{fk_idforma_pago:'999999',monto_gs:'1'},req));
    await assert.rejects(()=>controller.payment(reservation.idreserva,{monto_gs:'1'},req));
    await controller.updatePaymentMethod(custom.idforma_pago,{activo:true},req);
    const customCash=await controller.createPaymentMethod({nombre:'Efectivo mostrador',es_efectivo:false},req);
    await controller.updatePaymentMethod(customCash.idforma_pago,{es_efectivo:true},req);
    for(const role of ['administracion','caja','recepcion','limpieza']){
      const roleUser=(await client.query('SELECT idusuario FROM usuario WHERE rol=$1 ORDER BY idusuario LIMIT 1',[role])).rows[0];
      const request={headers:{authorization:'Bearer '+await jwt.signAsync({sub:roleUser.idusuario})}};
      for(const handler of [controller.paymentMethods,controller.paymentMethodsAdmin,controller.createPaymentMethod,controller.updatePaymentMethod]){
        const ctx={switchToHttp:()=>({getRequest:()=>request}),getHandler:()=>handler,getClass:()=>PmsController} as any;
        const permitted=handler===controller.paymentMethods?['administracion','caja','recepcion'].includes(role):role==='administracion';
        if(permitted)assert.equal(await guard.canActivate(ctx),true);else await assert.rejects(()=>guard.canActivate(ctx));
      }
    }
    const beforeFailure=(await client.query('SELECT count(*)::int AS n FROM pago')).rows[0].n;
    await assert.rejects(()=>controller.payment(reservation.idreserva,{fk_idforma_pago:efectivo,monto_gs:'800'}, {user:{idusuario:'999999',nombre:'Inválido'}}));
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pago')).rows[0].n,beforeFailure);
    const cancelled=(await client.query("INSERT INTO reserva(fk_idcliente,fecha_entrada,fecha_salida,estado,creado_por) VALUES($1,'2026-10-10','2026-10-13','cancelada','Prueba') RETURNING *",[customer.idcliente])).rows[0];
    await assert.rejects(()=>controller.payment(cancelled.idreserva,{fk_idforma_pago:efectivo,monto_gs:'1000',monto_alojamiento_gs:'1000',monto_otros_gs:'0'},req),(e:any)=>e.getStatus()===400&&e.message.includes('cancelada'));
    const {FiscalController}=await import('./fiscal');
    await assert.rejects(()=>new FiscalController().prepare({fk_idreserva:cancelled.idreserva},req));
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pago WHERE fk_idreserva=$1',[cancelled.idreserva])).rows[0].n,0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM documento_electronico WHERE fk_idreserva=$1',[cancelled.idreserva])).rows[0].n,0);
    await assert.rejects(()=>controller.annulPayment(old.idpago,{motivo:' '},req));
    await assert.rejects(()=>controller.annulPayment('999999',{motivo:'Error'},req));
    const payment=await controller.payment(reservation.idreserva,{fk_idforma_pago:tarjeta,monto_gs:'300000',monto_alojamiento_gs:'300000',monto_otros_gs:'0'},req);
    assert.equal(payment.monto_alojamiento_gs,'300000');
    for(const split of [
      {monto_alojamiento_gs:'',monto_otros_gs:'300000'},
      {monto_alojamiento_gs:'-1',monto_otros_gs:'300001'},
      {monto_alojamiento_gs:'0.5',monto_otros_gs:'299999'},
      {monto_alojamiento_gs:'100000',monto_otros_gs:'100000'}
    ]) await assert.rejects(()=>controller.payment(reservation.idreserva,{fk_idforma_pago:tarjeta,monto_gs:'300000',...split},req));
    assert.equal((await client.query('SELECT count(*)::int AS n FROM caja_detalle WHERE fk_idpago=$1',[payment.idpago])).rows[0].n,1);
    await client.query('BEGIN');
    const rolled=(await client.query("INSERT INTO pago(fk_idreserva,fk_idcaja,fk_idforma_pago,monto_gs,creado_por) VALUES($1,$2,(SELECT idforma_pago FROM forma_pago WHERE nombre='Efectivo'),500,'Prueba') RETURNING idpago",[reservation.idreserva,cash.idcaja])).rows[0];
    await client.query('ROLLBACK');assert.equal((await client.query('SELECT count(*)::int AS n FROM caja_detalle WHERE fk_idpago=$1',[rolled.idpago])).rows[0].n,0);
    const refund=(await client.query("INSERT INTO pago(fk_idreserva,fk_idcaja,fk_idforma_pago,clase,monto_gs,creado_por) VALUES($1,$2,(SELECT idforma_pago FROM forma_pago WHERE nombre='Efectivo'),'devolucion',10000,'Prueba') RETURNING *",[reservation.idreserva,cash.idcaja])).rows[0];
    assert.equal((await controller.cashDetails(cash.idcaja)).resumen.neto_gs,'490000');
    const closed=await controller.closeCash({billetes:{...zeroBills(),100000:'1',50000:'1'}},req);assert.equal(closed.cierre_totales.neto_gs,'490000');
    assert.equal(closed.monto_cierre_gs,'150000');
    assert.equal(closed.cierre_comprobante.efectivo_esperado_gs,'200000');
    assert.equal(closed.cierre_comprobante.diferencia_gs,'-50000');
    assert.equal(closed.cierre_comprobante.billetes['100000'],'1');
    await assert.rejects(()=>controller.closeCash({billetes:zeroBills()},req));
    const ticket=createCashCloseTicket(closed.cierre_comprobante);
    const chunks:Buffer[]=[];for await(const chunk of ticket)chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).subarray(0,4).toString(),'%PDF');
    assert.deepEqual((await controller.cashHistory('cerrada')).map(c=>c.idcaja),[cash.idcaja,legacy.idcaja]);
    assert.equal((await controller.cashHistory('abierta')).length,0);
    assert.equal(await controller.cash(),null);
    await controller.annulPayment(payment.idpago,{motivo:'Pago duplicado'},req);
    await controller.annulPayment(payment.idpago,{motivo:'Segundo intento'},req);
    const after=await controller.cashDetails(cash.idcaja);
    assert.equal(after.resumen.neto_gs,'190000');assert.equal(after.cierre_totales.neto_gs,'490000');assert.equal(after.ajuste_posterior_gs,'-300000');assert.equal(after.monto_cierre_gs,'150000');
    assert.deepEqual(after.cierre_comprobante,closed.cierre_comprobante);
    const headers:Record<string,string>={};
    const stream=Object.assign(new PassThrough(),{setHeader:(key:string,value:string)=>{headers[key]=value}});
    const ticketChunks:Buffer[]=[];stream.on('data',(chunk:Buffer)=>ticketChunks.push(chunk));
    const finished=once(stream,'end');
    await controller.cashTicket(String(cash.idcaja),stream);await finished;
    assert.equal(headers['Content-Type'],'application/pdf');
    assert.equal(Buffer.concat(ticketChunks).subarray(0,4).toString(),'%PDF');
    await assert.rejects(()=>controller.cashTicket(String(legacy.idcaja),stream));
    assert.equal((await client.query("SELECT count(*)::int AS n FROM auditoria WHERE entidad='pago' AND accion='anular'")).rows[0].n,1);
    const detail=after.movimientos.find((m:any)=>m.fk_idpago===payment.idpago);assert.equal(detail.anulado,true);assert.equal(detail.motivo_anulacion,'Pago duplicado');assert.equal(detail.cliente_nombre,'Ana');
    assert.equal(detail.habitaciones,'101, 102');assert.equal(after.movimientos.length,3);
    await client.query("UPDATE pago SET anulado=TRUE,motivo_anulacion='Corrección directa',anulado_por='Prueba',fecha_anulado=now() WHERE idpago=$1",[refund.idpago]);
    assert.equal((await client.query('SELECT anulado FROM caja_detalle WHERE fk_idpago=$1',[refund.idpago])).rows[0].anulado,true);
    await assert.rejects(()=>controller.payment(reservation.idreserva,{fk_idforma_pago:efectivo,monto_gs:'500'},req));
    const next=await controller.openCash({monto_inicial_gs:'0'},req);
    parallel=new Client({connectionString:url.toString()});await parallel.connect();
    await parallel.query('BEGIN');await parallel.query('SELECT idcaja FROM caja WHERE idcaja=$1 FOR UPDATE',[next.idcaja]);
    const concurrent=controller.payment(reservation.idreserva,{fk_idforma_pago:efectivo,monto_gs:'700',monto_alojamiento_gs:'700',monto_otros_gs:'0'},req).then(()=>null,e=>e);
    await parallel.query('UPDATE caja SET cerrada_en=now(),cierre_totales=caja_totales(idcaja) WHERE idcaja=$1',[next.idcaja]);await parallel.query('COMMIT');
    assert.ok(await concurrent);assert.equal((await client.query('SELECT count(*)::int AS n FROM caja_detalle WHERE fk_idcaja=$1',[next.idcaja])).rows[0].n,0);
    const last=await controller.openCash({monto_inicial_gs:'5000'},req);
    const newCashPayment=await controller.payment(reservation.idreserva,{fk_idforma_pago:customCash.idforma_pago,monto_gs:'1000',monto_alojamiento_gs:'1000',monto_otros_gs:'0'},req);
    await controller.payment(reservation.idreserva,{fk_idforma_pago:custom.idforma_pago,monto_gs:'2000',monto_alojamiento_gs:'2000',monto_otros_gs:'0'},req);
    const currentDetail=await controller.cashDetails(last.idcaja);
    assert.equal(currentDetail.resumen.efectivo_gs,'1000');assert.equal(currentDetail.resumen.no_efectivo_gs,'2000');assert.equal(currentDetail.efectivo_esperado_gs,'6000');
    assert.equal(currentDetail.movimientos.find((m:any)=>m.fk_idpago===newCashPayment.idpago).fk_idforma_pago,customCash.idforma_pago);
    const adminMethods=await controller.paymentMethodsAdmin();assert.equal(adminMethods.find(f=>f.idforma_pago===customCash.idforma_pago).utilizada,true);
    await assert.rejects(()=>controller.updatePaymentMethod(customCash.idforma_pago,{es_efectivo:false},req));
    await controller.updatePaymentMethod(customCash.idforma_pago,{nombre:'Efectivo recepción',activo:false},req);
    const inactiveHistory=await controller.cashDetails(last.idcaja);assert.equal(inactiveHistory.efectivo_esperado_gs,'6000');
    assert.equal(inactiveHistory.movimientos.find((m:any)=>m.fk_idpago===newCashPayment.idpago).forma_pago_nombre,'Efectivo recepción');
    await controller.annulPayment(newCashPayment.idpago,{motivo:'Corrección del turno'},req);
    assert.equal((await controller.cashDetails(last.idcaja)).efectivo_esperado_gs,'5000');
    assert.equal((await controller.cash()).totales.length,1);
    assert.ok((await client.query("SELECT count(*)::int AS n FROM auditoria WHERE entidad='forma_pago'")).rows[0].n>=5);
    const attempts=await Promise.allSettled([controller.closeCash({billetes:zeroBills()},req),controller.closeCash({billetes:zeroBills()},req)]);
    assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(attempts.filter(x=>x.status==='rejected').length,1);
    const zeroClose=(await client.query('SELECT * FROM caja WHERE idcaja=$1',[last.idcaja])).rows[0];
    assert.equal(zeroClose.monto_cierre_gs,'0');
    assert.equal(zeroClose.cierre_comprobante.diferencia_gs,'-5000');
    await controller.openCash({monto_inicial_gs:'0'},req);
    const limited=(await client.query("INSERT INTO reserva(fk_idcliente,fecha_entrada,fecha_salida,creado_por) VALUES($1,'2026-10-10','2026-10-13','Prueba') RETURNING *",[customer.idcliente])).rows[0];
    await client.query("INSERT INTO movimiento(fk_idreserva,tipo,descripcion,cantidad,monto_unitario_gs,fecha_servicio,creado_por) VALUES($1,'alojamiento','Estadía limitada',1,100000,'2026-10-10','Prueba')",[limited.idreserva]);
    await client.query("INSERT INTO movimiento(fk_idreserva,tipo,descripcion,cantidad,monto_unitario_gs,fecha_servicio,creado_por) VALUES($1,'extra','Cargo adicional',1,20000,'2026-10-10','Prueba')",[limited.idreserva]);
    const sameRequest='cbe3f69a-997b-4a44-913c-f0e6f727667b';
    const firstPartial=await controller.payment(limited.idreserva,{fk_idforma_pago:efectivo,monto_gs:'40000',solicitud_id:sameRequest},req);
    assert.equal(firstPartial.solicitud_id,sameRequest);
    assert.equal(firstPartial.monto_alojamiento_gs,'40000');
    await assert.rejects(()=>controller.payment(limited.idreserva,{fk_idforma_pago:efectivo,monto_gs:'40000',solicitud_id:sameRequest},req),(e:any)=>e.getStatus()===400&&e.message.includes('ya fue registrado'));
    await assert.rejects(()=>controller.payment(limited.idreserva,{fk_idforma_pago:efectivo,monto_gs:'80001'},req),(e:any)=>e.getStatus()===400&&e.message.includes('saldo pendiente'));
    const simultaneous=await Promise.allSettled([1,2].map(()=>controller.payment(limited.idreserva,{fk_idforma_pago:efectivo,monto_gs:'80000'},req)));
    assert.equal(simultaneous.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(simultaneous.filter(result=>result.status==='rejected').length,1);
    assert.equal((simultaneous.find(result=>result.status==='fulfilled') as PromiseFulfilledResult<any>).value.monto_alojamiento_gs,'60000');
    assert.equal((await controller.reservation(String(limited.idreserva),req)).saldo_gs,'0');
    await assert.rejects(()=>controller.payment(limited.idreserva,{fk_idforma_pago:efectivo,monto_gs:'1'},req),(e:any)=>e.getStatus()===400&&e.message.includes('no tiene saldo'));
  }finally{if(parallel)await parallel.end();if(db)await db.pool.end();await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await client.end();}
});
