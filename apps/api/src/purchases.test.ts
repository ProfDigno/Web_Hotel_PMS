import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import 'reflect-metadata';
import { applyMigrations } from './migration-runner';

test('compras: proveedor, stock, pagos parciales, caja cerrada, anulación y análisis',{skip:!process.env.TEST_DATABASE_URL&&'Requiere TEST_DATABASE_URL'},async()=>{
  const client=new Client({connectionString:process.env.TEST_DATABASE_URL});await client.connect();
  const schema=`purchase_test_${Date.now()}`;let db:typeof import('./db')|undefined;
  try{
    await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema},public`);await applyMigrations(client);
    const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${schema},public`);process.env.DATABASE_URL=url.toString();
    db=await import('./db');const {PurchasesController}=await import('./purchases');const {SalesController}=await import('./sales');const {PmsController}=await import('./pms');
    const purchases=new PurchasesController(),sales=new SalesController(),pms=new PmsController();
    const user=(await client.query("INSERT INTO usuario(nombre,email,clave_hash,rol,creado_por) VALUES('Prueba','purchases@test.local','hash','administracion','Prueba') RETURNING *")).rows[0],req={user};
    const supplier=await purchases.createSupplier({razon_social:'Proveedor Uno',ruc:'80012345-6',direccion:'Centro',telefono:'123456'},req);
    await assert.rejects(()=>purchases.createSupplier({razon_social:'Duplicado',ruc:'80012345-6',direccion:'Otra',telefono:'999'},req));
    const category=await sales.createCategory({nombre:'Insumos'},req);
    const product=await sales.createProduct({fk_idcategoria_producto:category.idcategoria_producto,nombre:'Jabón',precio_venta:'2000',precio_compra:'300',stock_actual:0,stock_minimo:0,es_comprar:true},req);
    const method=(await client.query("SELECT idforma_pago FROM forma_pago WHERE nombre='Efectivo'")).rows[0].idforma_pago;
    const cash=await pms.openCash({monto_inicial_gs:'0'},req);
    const base={fk_idproveedor:supplier.idproveedor,items:[{fk_idproducto:product.idproducto,cantidad:5,precio_unitario_gs:'1000'}]};
    await assert.rejects(()=>purchases.create({...base,fk_idproveedor:'999999'},req));
    await assert.rejects(()=>purchases.create({...base,items:[...base.items,...base.items]},req));
    const first=await purchases.create({...base,pago_inicial_gs:'1000',fk_idforma_pago:method},req);
    assert.equal(first.total_gs,'5000');assert.equal((await client.query('SELECT stock_actual,precio_compra FROM producto WHERE idproducto=$1',[product.idproducto])).rows[0].precio_compra,'1000');
    let detail=await purchases.detail(first.idcompra);assert.equal(detail.pagado_gs,'1000');assert.equal(detail.saldo_gs,'4000');
    await assert.rejects(()=>purchases.pay(first.idcompra,{monto_gs:'5000',fk_idforma_pago:method},req));
    await purchases.pay(first.idcompra,{monto_gs:'2000',fk_idforma_pago:method},req);
    detail=await purchases.detail(first.idcompra);assert.equal(detail.pagos.length,2);assert.equal(detail.saldo_gs,'2000');
    assert.equal((await pms.cash()).resumen.egresos_gs,'3000');
    assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM caja_detalle WHERE fk_idcompra=$1 AND tipo=$2',[first.idcompra,'egreso'])).rows[0].n,2);
    assert.equal((await purchases.list({pagina:'1'})).total,1);
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    let analysis=await purchases.analysis({desde:date,hasta:date});assert.equal(analysis.resumen.total_gs,'5000');assert.equal(analysis.resumen.pagado_gs,'3000');assert.equal(analysis.resumen.unidades,5);
    await pms.closeCash({billetes:{100000:'0',50000:'0',20000:'0',10000:'0',5000:'0',1000:'0'}},req);
    await sales.adjust({fk_idproducto:product.idproducto,stock_nuevo:-1,motivo:'Consumo de prueba'},req);
    await purchases.annul(first.idcompra,{motivo:'Compra duplicada'},req);
    assert.equal((await client.query('SELECT stock_actual,precio_compra FROM producto WHERE idproducto=$1',[product.idproducto])).rows[0].stock_actual,-6);
    assert.equal((await client.query('SELECT precio_compra FROM producto WHERE idproducto=$1',[product.idproducto])).rows[0].precio_compra,'300');
    assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM caja_detalle WHERE fk_idcompra=$1 AND anulado',[first.idcompra])).rows[0].n,2);
    const cashDetail=await pms.cashDetails(cash.idcaja);assert.equal(cashDetail.resumen.egresos_gs,'0');assert.equal(cashDetail.cierre_totales.egresos_gs,'3000');assert.equal(cashDetail.ajuste_posterior_gs,'3000');
    const purchaseMovements=cashDetail.movimientos.filter((m:any)=>m.fk_idcompra===first.idcompra);assert.equal(purchaseMovements.length,2);assert.ok(purchaseMovements.every((m:any)=>m.proveedor_nombre==='Proveedor Uno'&&m.anulado));
    analysis=await purchases.analysis({desde:date,hasta:date});assert.equal(analysis.resumen.total_gs,'0');assert.equal(analysis.resumen.anuladas,1);
    await assert.rejects(()=>purchases.pay(first.idcompra,{monto_gs:'1',fk_idforma_pago:method},req));
    const nextCash=await pms.openCash({monto_inicial_gs:'0'},req);
    const second=await purchases.create({...base,pago_inicial_gs:'0'},req);
    const third=await purchases.create({...base,items:[{fk_idproducto:product.idproducto,cantidad:1,precio_unitario_gs:'1500'}]},req);
    await purchases.annul(second.idcompra,{motivo:'Anterior'},req);assert.equal((await client.query('SELECT precio_compra FROM producto WHERE idproducto=$1',[product.idproducto])).rows[0].precio_compra,'1500');
    await purchases.annul(third.idcompra,{motivo:'Última'},req);assert.equal((await client.query('SELECT precio_compra FROM producto WHERE idproducto=$1',[product.idproducto])).rows[0].precio_compra,'300');
    assert.equal((await pms.cashDetails(nextCash.idcaja)).resumen.egresos_gs,'0');
    const {AuthGuard}=await import('./auth');const {JwtService}=await import('@nestjs/jwt');const {Reflector}=await import('@nestjs/core');const jwt=new JwtService({secret:'purchase-test-secret'}),guard=new AuthGuard(jwt,new Reflector());
    for(const role of ['administracion','caja','recepcion','limpieza']){await client.query('UPDATE usuario SET rol=$1 WHERE idusuario=$2',[role,user.idusuario]);const token=await jwt.signAsync({sub:user.idusuario});for(const methodName of ['create','pay','annul','createSupplier','updateSupplier','analysis'] as const){const context={switchToHttp:()=>({getRequest:()=>({headers:{authorization:'Bearer '+token}})}),getHandler:()=>PurchasesController.prototype[methodName],getClass:()=>PurchasesController} as any;const permitted=role==='administracion'||role==='caja'&&!['createSupplier','updateSupplier','analysis'].includes(methodName);if(permitted)assert.equal(await guard.canActivate(context),true);else await assert.rejects(()=>guard.canActivate(context));}}
  }finally{if(db)await db.pool.end();await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await client.end();}
});
