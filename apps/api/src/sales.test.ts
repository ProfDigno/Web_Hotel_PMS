import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { Client } from 'pg';
import 'reflect-metadata';
import { applyMigrations } from './migration-runner';

test('ventas: catálogo, caja, stock, cuenta y anulación', {skip:!process.env.TEST_DATABASE_URL&&'Requiere TEST_DATABASE_URL'}, async()=>{
  const client=new Client({connectionString:process.env.TEST_DATABASE_URL});await client.connect();
  const schema=`sales_test_${Date.now()}`;let db:typeof import('./db')|undefined;
  try{
    await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema},public`);await applyMigrations(client);
    const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${schema},public`);process.env.DATABASE_URL=url.toString();
    db=await import('./db');const {SalesController}=await import('./sales');const {PmsController}=await import('./pms');const sales=new SalesController(),pms=new PmsController();
    const user=(await client.query("INSERT INTO usuario(nombre,email,clave_hash,rol,creado_por) VALUES('Prueba','sales@test.local','hash','administracion','Prueba') RETURNING *")).rows[0],req={user};
    const {AuthGuard}=await import('./auth');const {JwtService}=await import('@nestjs/jwt');const {Reflector}=await import('@nestjs/core');
    const jwt=new JwtService({secret:'sales-test-secret'}),guard=new AuthGuard(jwt,new Reflector());
    for(const role of ['administracion','recepcion','caja','limpieza']){
      const staff=(await client.query("INSERT INTO usuario(nombre,email,clave_hash,rol,creado_por) VALUES($1,$2,'hash',$1,'Prueba') RETURNING *",[role,`${role}@sales.test.local`])).rows[0];
      const request={headers:{authorization:`Bearer ${await jwt.signAsync({sub:staff.idusuario})}`}};
      for(const handler of [sales.createSale,sales.createProduct,sales.adjust,sales.annul,sales.analysis]){
        const ctx={switchToHttp:()=>({getRequest:()=>request}),getHandler:()=>handler,getClass:()=>SalesController} as any;
        const permitted=role!=='limpieza'&&(handler!==sales.annul||role!=='recepcion');
        if(permitted)assert.equal(await guard.canActivate(ctx),true);else await assert.rejects(()=>guard.canActivate(ctx));
      }
    }
    const cash=await pms.openCash({monto_inicial_gs:'0'},req);
    const method=(await client.query("SELECT idforma_pago FROM forma_pago WHERE nombre='Efectivo'")).rows[0].idforma_pago;
    const first=await sales.createCategory({nombre:'Bebidas'},req),second=await sales.createCategory({nombre:'Comidas'},req);
    await sales.moveCategory(second.idcategoria_producto,{direccion:'subir'},req);
    assert.deepEqual((await sales.categories('1')).map(x=>x.nombre),['Comidas','Bebidas']);
    const product=await sales.createProduct({fk_idcategoria_producto:first.idcategoria_producto,nombre:'Agua',precio_venta:'10000',precio_compra:'3000',stock_actual:1,stock_minimo:2,descontar_stock:true,es_vender:true,es_comprar:true,es_cocina:false},req);
    await assert.rejects(()=>sales.createSale({destino:'restaurante',items:[{fk_idproducto:product.idproducto,cantidad:1,pago_inicial:'pendiente'}]},req),/requieren una habitación/);
    const direct=await sales.createSale({destino:'restaurante',fk_idforma_pago:method,items:[{fk_idproducto:product.idproducto,cantidad:2,pago_inicial:'pagado'}]},req);
    assert.equal(direct.total_gs,'20000');
    assert.equal((await client.query('SELECT precio_compra_unitario_gs FROM venta_item WHERE fk_idventa=$1',[direct.idventa])).rows[0].precio_compra_unitario_gs,'3000');
    const directDetail=await sales.detail(String(direct.idventa));
    assert.equal(directDetail.habitacion_numero,null);
    assert.equal(directDetail.pagos[0].forma_pago_nombre,'Efectivo');
    assert.equal(directDetail.pagos[0].fk_idcaja,cash.idcaja);
    assert.equal(directDetail.items[0].precio_compra_unitario_gs,undefined);
    const ticketSize=async(id:string)=>{
      const output=new PassThrough() as PassThrough&{setHeader:(name:string,value:string)=>void};
      const chunks:Buffer[]=[],headers:Record<string,string>={};
      output.setHeader=(name,value)=>{headers[name]=value};
      output.on('data',(chunk:Buffer)=>chunks.push(chunk));
      const done=once(output,'end');
      await sales.ticket(id,output);await done;
      assert.equal(headers['Content-Type'],'application/pdf');
      const pdf=Buffer.concat(chunks).toString('latin1');
      assert.match(pdf,/^%PDF-/);
      const box=pdf.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
      assert.ok(box,'El PDF debe incluir el tamaño de página');
      assert.ok(Math.abs(Number(box[1])-80/25.4*72)<.01);
      return Number(box[2]);
    };
    const shortTicketHeight=await ticketSize(String(direct.idventa));
    assert.equal((await client.query('SELECT stock_actual FROM producto WHERE idproducto=$1',[product.idproducto])).rows[0].stock_actual,-1);
    assert.equal((await pms.cashDetails(cash.idcaja)).resumen.neto_gs,'20000');
    await sales.annul(direct.idventa,{motivo:'Error de carga'},req);
    assert.equal((await client.query('SELECT stock_actual FROM producto WHERE idproducto=$1',[product.idproducto])).rows[0].stock_actual,1);
    assert.equal((await pms.cashDetails(cash.idcaja)).resumen.neto_gs,'0');
    await sales.adjust({fk_idproducto:product.idproducto,stock_nuevo:-3,motivo:'Recuento'},req);
    assert.equal((await client.query('SELECT stock_actual FROM producto WHERE idproducto=$1',[product.idproducto])).rows[0].stock_actual,-3);
    const customer=(await client.query("INSERT INTO cliente(nombre,creado_por) VALUES('Ana','Prueba') RETURNING *")).rows[0];
    const floor=(await client.query("INSERT INTO piso(numero,nombre,creado_por) VALUES(1,'Primero','Prueba') RETURNING *")).rows[0];
    const type=(await client.query("INSERT INTO tipo_habitacion(nombre,capacidad,creado_por) VALUES('Doble',2,'Prueba') RETURNING *")).rows[0];
    const room=(await client.query("INSERT INTO habitacion(numero,fk_idpiso,fk_idtipo_habitacion,creado_por) VALUES('101',$1,$2,'Prueba') RETURNING *",[floor.idpiso,type.idtipo_habitacion])).rows[0];
    const reservation=(await client.query("INSERT INTO reserva(fk_idcliente,fecha_entrada,fecha_salida,estado,creado_por) VALUES($1,current_date,current_date+2,'en_casa','Prueba') RETURNING *",[customer.idcliente])).rows[0];
    await client.query("INSERT INTO reserva_habitacion(fk_idreserva,fk_idhabitacion,fecha_entrada,fecha_salida,tarifa_noche_gs,estado,creado_por) VALUES($1,$2,current_date,current_date+2,0,'en_casa','Prueba')",[reservation.idreserva,room.idhabitacion]);
    const mixed=await sales.createSale({destino:'habitacion',fk_idhabitacion:room.idhabitacion,fk_idforma_pago:method,items:[{fk_idproducto:product.idproducto,cantidad:1,pago_inicial:'pagado'},{fk_idproducto:product.idproducto,cantidad:1,pago_inicial:'pendiente'}]},req);
    assert.equal(mixed.total_gs,'20000');assert.equal(mixed.pagado_inicial_gs,'10000');
    const mixedDetail=await sales.detail(String(mixed.idventa));
    assert.equal(mixedDetail.cliente_nombre,'Ana');
    assert.equal(mixedDetail.habitacion_numero,'101');
    assert.equal(mixedDetail.items[1].pago_inicial,'pendiente');
    assert.ok(await ticketSize(String(mixed.idventa))>shortTicketHeight);
    const card=(await client.query("SELECT idforma_pago FROM forma_pago WHERE nombre='Tarjeta'")).rows[0].idforma_pago;
    const juice=await sales.createProduct({fk_idcategoria_producto:first.idcategoria_producto,nombre:'Jugo',precio_venta:'5000',precio_compra:'1000',stock_actual:10,stock_minimo:0,descontar_stock:true},req);
    const another=await sales.createSale({destino:'restaurante',fk_idforma_pago:card,items:[
      {fk_idproducto:product.idproducto,cantidad:1,pago_inicial:'pagado'},
      {fk_idproducto:juice.idproducto,cantidad:2,pago_inicial:'pagado'}]},req);
    const outside=await sales.createSale({destino:'restaurante',fk_idforma_pago:method,items:[{fk_idproducto:juice.idproducto,cantidad:1,pago_inicial:'pagado'}]},req);
    await client.query("UPDATE venta SET fecha_creado=('2026-07-15'::date::timestamp AT TIME ZONE 'America/Asuncion') + interval '1 second' WHERE idventa=$1",[mixed.idventa]);
    await client.query("UPDATE venta SET fecha_creado=('2026-07-15'::date::timestamp AT TIME ZONE 'America/Asuncion') + interval '13 hours' WHERE idventa=$1",[another.idventa]);
    await client.query("UPDATE venta SET fecha_creado=('2026-07-15'::date::timestamp AT TIME ZONE 'America/Asuncion') - interval '1 second' WHERE idventa=$1",[outside.idventa]);
    const analysis=await sales.analysis('2026-07-15','2026-07-15');
    assert.deepEqual(analysis.resumen,{cantidad_ventas:2,total_gs:'40000',cobrado_inicial_gs:'30000',pendiente_inicial_gs:'10000',unidades:5,ticket_promedio_gs:'20000'});
    assert.equal(analysis.dias.length,1);assert.equal(analysis.dias[0].total_gs,'40000');
    assert.deepEqual(analysis.productos.map((x:any)=>[x.nombre,x.unidades,x.total_gs]),[['Agua',3,'30000'],['Jugo',2,'10000']]);
    assert.deepEqual(analysis.formas_pago.map((x:any)=>[x.nombre,x.total_gs]),[['Tarjeta','20000'],['Efectivo','10000']]);
    assert.deepEqual(analysis.destinos.map((x:any)=>[x.destino,x.total_gs]),[['habitacion','20000'],['restaurante','20000']]);
    assert.equal(analysis.horas.find((x:any)=>x.hora===0).cantidad_ventas,1);
    assert.equal(analysis.horas.find((x:any)=>x.hora===13).cantidad_ventas,1);
    const threeDays=await sales.analysis('2026-07-14','2026-07-16');
    assert.deepEqual(threeDays.dias.map((x:any)=>x.cantidad_ventas),[1,2,0]);
    const empty=await sales.analysis('2026-07-16','2026-07-16');
    assert.equal(empty.resumen.total_gs,'0');assert.equal(empty.resumen.ticket_promedio_gs,'0');
    assert.equal(empty.dias[0].cantidad_ventas,0);assert.equal(empty.horas.length,24);
    await sales.updateProduct(product.idproducto,{precio_venta:'99999'},req);
    assert.equal((await sales.analysis('2026-07-15','2026-07-15')).resumen.total_gs,'40000');
    await assert.rejects(()=>sales.analysis('2026-07-16','2026-07-15'));
    await assert.rejects(()=>sales.analysis('2026-7-15','2026-07-15'));
    await assert.rejects(()=>pms.checkout(reservation.idreserva,req),/saldo cero/);
    await pms.payment(reservation.idreserva,{fk_idforma_pago:method,monto_gs:'10000',monto_alojamiento_gs:'0',monto_otros_gs:'10000'},req);
    assert.equal((await sales.sales()).find((x:any)=>String(x.idventa)===String(mixed.idventa)).saldo_reserva_gs,'0');
    await assert.rejects(()=>sales.annul(mixed.idventa,{motivo:'Error'},req),/cobros posteriores/);
    await pms.checkout(reservation.idreserva,req);
  }finally{if(db)await db.pool.end();await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await client.end();}
});
