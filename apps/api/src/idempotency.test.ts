import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { defer, from, lastValueFrom } from 'rxjs';
import 'reflect-metadata';
import { applyMigrations } from './migration-runner';

test('una clave repetida devuelve el resultado original sin duplicar registro ni auditoría', {skip:!process.env.TEST_DATABASE_URL&&'Requiere TEST_DATABASE_URL'},async()=>{
  const client=new Client({connectionString:process.env.TEST_DATABASE_URL});
  await client.connect();
  const schema=`idempotency_test_${Date.now()}`;
  let db:typeof import('./db')|undefined;
  try{
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema},public`);
    await applyMigrations(client);
    const url=new URL(process.env.TEST_DATABASE_URL!);
    url.searchParams.set('options',`-c search_path=${schema},public`);
    process.env.DATABASE_URL=url.toString();
    db=await import('./db');
    const {SalesController}=await import('./sales');
    const {PmsController}=await import('./pms');
    const {IdempotencyInterceptor}=await import('./idempotency');
    const sales=new SalesController(),interceptor=new IdempotencyInterceptor();
    const user=(await client.query("INSERT INTO usuario(nombre,email,clave_hash,rol,creado_por) VALUES('Prueba','idempotency@test.local','hash','administracion','Prueba') RETURNING *")).rows[0];
    const key=randomUUID();
    const run=(body:any,requestKey=key)=>{
      const request={method:'POST',path:'/api/ventas/categorias',headers:{'idempotency-key':requestKey},body,user};
      const context={switchToHttp:()=>({getRequest:()=>request})} as any;
      const next={handle:()=>defer(()=>from(sales.createCategory(body,{user})))} as any;
      return lastValueFrom(interceptor.intercept(context,next)) as Promise<any>;
    };
    const [first,replayed]=await Promise.all([run({nombre:'Bebidas'}),run({nombre:'Bebidas'})]);
    assert.deepEqual(replayed,first);
    assert.deepEqual(await run({nombre:'Bebidas'}),first);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM categoria_producto WHERE nombre='Bebidas'")).rows[0].n,1);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM auditoria WHERE entidad='categoria_producto'")).rows[0].n,1);
    await assert.rejects(()=>run({nombre:'Otra categoría'}),/otra operación/);
    const invalidKey=randomUUID();
    await assert.rejects(()=>run({nombre:''},invalidKey));
    assert.equal((await client.query('SELECT count(*)::int AS n FROM solicitud_idempotente WHERE solicitud_id=$1',[invalidKey])).rows[0].n,0);

    const pms=new PmsController();
    await pms.openCash({monto_inicial_gs:'0'},{user});
    const product=await sales.createProduct({fk_idcategoria_producto:first.idcategoria_producto,nombre:'Agua',precio_venta:'10000',precio_compra:'3000',stock_actual:5,stock_minimo:1,descontar_stock:true,es_vender:true,es_comprar:true,es_cocina:false},{user});
    const method=(await client.query("SELECT idforma_pago FROM forma_pago WHERE nombre='Efectivo'")).rows[0].idforma_pago;
    const saleBody={destino:'restaurante',fk_idforma_pago:method,items:[{fk_idproducto:product.idproducto,cantidad:1,pago_inicial:'pagado'}]};
    const saleKey=randomUUID();
    const runSale=()=>{
      const request={method:'POST',path:'/api/ventas',headers:{'idempotency-key':saleKey},body:saleBody,user};
      const context={switchToHttp:()=>({getRequest:()=>request})} as any;
      const next={handle:()=>defer(()=>from(sales.createSale(saleBody,{user})))} as any;
      return lastValueFrom(interceptor.intercept(context,next)) as Promise<any>;
    };
    const sale=await runSale();
    assert.deepEqual(await runSale(),sale);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM venta')).rows[0].n,1);
    assert.equal((await client.query('SELECT stock_actual FROM producto WHERE idproducto=$1',[product.idproducto])).rows[0].stock_actual,4);

    const guest=(await client.query("INSERT INTO cliente(nombre,creado_por) VALUES('Ana','Prueba') RETURNING idcliente")).rows[0];
    const type=(await client.query("INSERT INTO tipo_habitacion(nombre,capacidad,creado_por) VALUES('Simple',2,'Prueba') RETURNING idtipo_habitacion")).rows[0];
    const floor=(await client.query("INSERT INTO piso(numero,nombre,creado_por) VALUES(1,'Piso 1','Prueba') RETURNING idpiso")).rows[0];
    const room=(await client.query("INSERT INTO habitacion(numero,fk_idpiso,fk_idtipo_habitacion,creado_por) VALUES('101',$1,$2,'Prueba') RETURNING idhabitacion",[floor.idpiso,type.idtipo_habitacion])).rows[0];
    const reservationBody={fk_idcliente:guest.idcliente,fecha_entrada:'2026-12-01',fecha_salida:'2026-12-02',adultos:1,ninos:0,habitaciones:[{fk_idhabitacion:room.idhabitacion,tarifa_noche_gs:'120000'}]};
    const reservationKey=randomUUID();
    const runReservation=()=>{
      const request={method:'POST',path:'/api/reservas',headers:{'idempotency-key':reservationKey},body:reservationBody,user};
      const context={switchToHttp:()=>({getRequest:()=>request})} as any;
      const next={handle:()=>defer(()=>from(pms.createReservation(reservationBody,{user})))} as any;
      return lastValueFrom(interceptor.intercept(context,next)) as Promise<any>;
    };
    const reservation=await runReservation();
    assert.deepEqual(await runReservation(),reservation);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM reserva')).rows[0].n,1);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM movimiento WHERE fk_idreserva=$1',[reservation.idreserva])).rows[0].n,1);

    const paymentKey=randomUUID();
    const paymentBody={fk_idforma_pago:method,monto_gs:'40000',solicitud_id:paymentKey};
    const paymentPath=`/api/reservas/${reservation.idreserva}/pagos`;
    const runPayment=()=>{
      const request={method:'POST',path:paymentPath,headers:{'idempotency-key':paymentKey},body:paymentBody,user};
      const context={switchToHttp:()=>({getRequest:()=>request})} as any;
      const next={handle:()=>defer(()=>from(pms.payment(String(reservation.idreserva),paymentBody,{user})))} as any;
      return lastValueFrom(interceptor.intercept(context,next)) as Promise<any>;
    };
    const payment=await runPayment();
    assert.deepEqual(await runPayment(),payment);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pago WHERE fk_idreserva=$1',[reservation.idreserva])).rows[0].n,1);
  }finally{
    if(db)await db.pool.end();
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
