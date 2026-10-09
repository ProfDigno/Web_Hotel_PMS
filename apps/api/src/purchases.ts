import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query as Q, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth';
import { query, transaction } from './db';
import { allowed, dbError, hotelDate, isoDate, nonNegativeGs, one, positiveInt, required } from './common';
import { paginateList } from './pagination';

const MAX=9223372036854775807n;
const amount=(value:unknown,name:string,zero=false)=>{const s=nonNegativeGs(value,name),n=BigInt(s);if(n>MAX||(!zero&&n===0n))throw new BadRequestException(`${name} debe ser un importe válido`);return n;};
const audit=(tx:any,u:any,action:string,entity:string,id:unknown,detail:unknown={})=>tx.query('INSERT INTO auditoria(fk_idusuario,accion,entidad,identificador,detalle,creado_por) VALUES($1,$2,$3,$4,$5,$6)',[u.idusuario,action,entity,String(id),JSON.stringify(detail),u.nombre]);
const active=(value:unknown)=>{if(typeof value!=='boolean')throw new BadRequestException('Activo debe ser booleano');return value;};
const supplierSelect='SELECT * FROM proveedor';
const purchaseSelect=`SELECT c.*,p.razon_social AS proveedor_nombre,p.ruc AS proveedor_ruc,
  COALESCE((SELECT SUM(cp.monto_gs) FROM compra_pago cp WHERE cp.fk_idcompra=c.idcompra AND cp.activo AND NOT cp.anulado),0)::text AS pagado_gs,
  (c.total_gs-COALESCE((SELECT SUM(cp.monto_gs) FROM compra_pago cp WHERE cp.fk_idcompra=c.idcompra AND cp.activo AND NOT cp.anulado),0))::text AS saldo_gs
  FROM compra c JOIN proveedor p ON p.idproveedor=c.fk_idproveedor`;

@Controller('api') @UseGuards(AuthGuard)
export class PurchasesController {
  @Get('proveedores') async suppliers(@Q('todos') todos?:string){return (await query(`${supplierSelect} ${todos==='1'?'':'WHERE activo'} ORDER BY razon_social,idproveedor`)).rows;}
  @Post('proveedores') async createSupplier(@Body() b:any,@Req() req:any){
    try{return await transaction(async tx=>{const row=(await tx.query('INSERT INTO proveedor(razon_social,ruc,direccion,telefono,creado_por) VALUES($1,$2,$3,$4,$5) RETURNING *',[required(b.razon_social,'Razón social'),required(b.ruc,'RUC'),required(b.direccion,'Dirección'),required(b.telefono,'Teléfono'),req.user.nombre])).rows[0];await audit(tx,req.user,'crear','proveedor',row.idproveedor);return row;});}catch(e){dbError(e);}
  }
  @Patch('proveedores/:id') async updateSupplier(@Param('id') id:string,@Body() b:any,@Req() req:any){
    try{return await transaction(async tx=>{const old=one((await tx.query('SELECT * FROM proveedor WHERE idproveedor=$1 FOR UPDATE',[positiveInt(id,'proveedor')])).rows,'Proveedor');const row=(await tx.query('UPDATE proveedor SET razon_social=$1,ruc=$2,direccion=$3,telefono=$4,activo=$5 WHERE idproveedor=$6 RETURNING *',[b.razon_social===undefined?old.razon_social:required(b.razon_social,'Razón social'),b.ruc===undefined?old.ruc:required(b.ruc,'RUC'),b.direccion===undefined?old.direccion:required(b.direccion,'Dirección'),b.telefono===undefined?old.telefono:required(b.telefono,'Teléfono'),b.activo===undefined?old.activo:active(b.activo),id])).rows[0];await audit(tx,req.user,'editar','proveedor',id);return row;});}catch(e){dbError(e);}
  }
  @Get('compras/opciones') async options(){const [suppliers,products,methods]=await Promise.all([this.suppliers('1'),query('SELECT idproducto,nombre,precio_compra,stock_actual,activo,es_comprar FROM producto ORDER BY nombre'),query('SELECT idforma_pago,nombre,activo FROM forma_pago ORDER BY nombre')]);return {proveedores:suppliers,productos:products.rows,formas_pago:methods.rows};}
  @Get('compras') async list(@Q() q:any){
    const start=q.desde?isoDate(q.desde,'desde'):null,end=q.hasta?isoDate(q.hasta,'hasta'):null;if(start&&end&&end<start)throw new BadRequestException('La fecha hasta debe ser igual o posterior a la fecha desde');
    const supplier=q.proveedor?positiveInt(q.proveedor,'proveedor'):null,state=q.estado?allowed(q.estado,['todos','vigente','anulado'] as const,'estado'):'todos';
    const sql=purchaseSelect+` WHERE c.activo AND ($1::date IS NULL OR c.fecha_creado >= ($1::date::timestamp AT TIME ZONE 'America/Asuncion')) AND ($2::date IS NULL OR c.fecha_creado < (($2::date+1)::timestamp AT TIME ZONE 'America/Asuncion')) AND ($3::bigint IS NULL OR c.fk_idproveedor=$3) AND ($4='todos' OR c.anulado=($4='anulado'))`;
    return paginateList(sql,[start,end,supplier,state],q.pagina??'1','idcompra');
  }
  @Get('compras/analisis') async analysis(@Q() q:any){
    const start=isoDate(q.desde||hotelDate().slice(0,7)+'-01','desde'),end=isoDate(q.hasta||hotelDate(),'hasta');if(end<start)throw new BadRequestException('La fecha hasta debe ser igual o posterior a la fecha desde');
    const days=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;if(days>3660)throw new BadRequestException('Seleccioná un período de hasta 10 años');
    const supplier=q.proveedor?positiveInt(q.proveedor,'proveedor'):null,product=q.producto?positiveInt(q.producto,'producto'):null,method=q.forma_pago?positiveInt(q.forma_pago,'forma de pago'):null;
    const params=[start,end,supplier,product,method];
    const where=`c.activo AND c.fecha_creado >= ($1::date::timestamp AT TIME ZONE 'America/Asuncion') AND c.fecha_creado < (($2::date+1)::timestamp AT TIME ZONE 'America/Asuncion') AND ($3::bigint IS NULL OR c.fk_idproveedor=$3) AND ($4::bigint IS NULL OR EXISTS(SELECT 1 FROM compra_item ci WHERE ci.fk_idcompra=c.idcompra AND ci.fk_idproducto=$4)) AND ($5::bigint IS NULL OR EXISTS(SELECT 1 FROM compra_pago cp WHERE cp.fk_idcompra=c.idcompra AND cp.fk_idforma_pago=$5 AND cp.activo AND NOT cp.anulado))`;
    const [purchases,items,payments]=await Promise.all([
      query(`SELECT c.idcompra,c.total_gs,c.anulado,c.fecha_creado,p.idproveedor,p.razon_social,COALESCE((SELECT SUM(cp.monto_gs) FROM compra_pago cp WHERE cp.fk_idcompra=c.idcompra AND cp.activo AND NOT cp.anulado),0)::text AS pagado_gs FROM compra c JOIN proveedor p ON p.idproveedor=c.fk_idproveedor WHERE ${where}`,params),
      query(`SELECT ci.fk_idcompra,ci.fk_idproducto,ci.nombre_producto,ci.cantidad,ci.precio_unitario_gs FROM compra_item ci JOIN compra c ON c.idcompra=ci.fk_idcompra WHERE ${where} AND NOT c.anulado`,params),
      query(`SELECT cp.fk_idcompra,cp.monto_gs,f.idforma_pago,f.nombre FROM compra_pago cp JOIN forma_pago f ON f.idforma_pago=cp.fk_idforma_pago JOIN compra c ON c.idcompra=cp.fk_idcompra WHERE ${where} AND NOT c.anulado AND cp.activo AND NOT cp.anulado`,params)
    ]);
    const valid=purchases.rows.filter(r=>!r.anulado),cancelled=purchases.rows.filter(r=>r.anulado),sum=(rows:any[],key:string)=>rows.reduce((n,r)=>n+BigInt(r[key]),0n);
    const total=sum(valid,'total_gs'),paid=sum(valid,'pagado_gs'),units=items.rows.reduce((n,r)=>n+Number(r.cantidad),0);
    const group=(rows:any[],idKey:string,nameKey:string,value:(r:any)=>bigint)=>{const map=new Map<string,{id:string;nombre:string;total:bigint;cantidad:number}>();for(const r of rows){const id=String(r[idKey]),g=map.get(id)||{id,nombre:r[nameKey],total:0n,cantidad:0};g.total+=value(r);g.cantidad++;map.set(id,g);}return [...map.values()].sort((a,b)=>a.total>b.total?-1:a.total<b.total?1:0).map(g=>({id:g.id,nombre:g.nombre,total_gs:g.total.toString(),cantidad:g.cantidad}));};
    const daily=new Map<string,{total:bigint;cantidad:number}>();for(const r of valid){const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.fecha_creado));const d=daily.get(date)||{total:0n,cantidad:0};d.total+=BigInt(r.total_gs);d.cantidad++;daily.set(date,d);}
    return {desde:start,hasta:end,resumen:{total_gs:total.toString(),unidades:units,cantidad:valid.length,promedio_gs:(valid.length?total/BigInt(valid.length):0n).toString(),pagado_gs:paid.toString(),saldo_gs:(total-paid).toString(),anuladas:cancelled.length,anuladas_gs:sum(cancelled,'total_gs').toString()},dias:Array.from({length:days},(_,i)=>{const date=new Date(Date.parse(start)+i*86400000).toISOString().slice(0,10),d=daily.get(date);return {fecha:date,total_gs:(d?.total??0n).toString(),cantidad:d?.cantidad??0};}),proveedores:group(valid,'idproveedor','razon_social',r=>BigInt(r.total_gs)),productos:group(items.rows,'fk_idproducto','nombre_producto',r=>BigInt(r.cantidad)*BigInt(r.precio_unitario_gs)),formas_pago:group(payments.rows,'idforma_pago','nombre',r=>BigInt(r.monto_gs))};
  }
  @Get('compras/:id') async detail(@Param('id') id:string){const purchase=one((await query(purchaseSelect+' WHERE c.idcompra=$1 AND c.activo',[positiveInt(id,'compra')])).rows,'Compra');const [items,payments]=await Promise.all([query('SELECT * FROM compra_item WHERE fk_idcompra=$1 ORDER BY idcompra_item',[id]),query('SELECT cp.*,f.nombre AS forma_pago_nombre FROM compra_pago cp JOIN forma_pago f ON f.idforma_pago=cp.fk_idforma_pago WHERE cp.fk_idcompra=$1 ORDER BY cp.idcompra_pago',[id])]);return {...purchase,items:items.rows,pagos:payments.rows};}
  @Post('compras') async create(@Body() b:any,@Req() req:any){
    const supplier=positiveInt(b.fk_idproveedor,'proveedor');if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)throw new BadRequestException('Agregá entre 1 y 100 productos');
    const items=b.items.map((x:any)=>({id:positiveInt(x.fk_idproducto,'producto'),quantity:positiveInt(x.cantidad,'cantidad'),price:amount(x.precio_unitario_gs,'precio unitario',true)}));
    if(items.some((x:any)=>x.quantity>2147483647)||new Set(items.map((x:any)=>x.id)).size!==items.length)throw new BadRequestException('La cantidad o los productos repetidos no son válidos');
    const initial=amount(b.pago_inicial_gs??'0','pago inicial',true),method=initial>0n?positiveInt(b.fk_idforma_pago,'forma de pago'):null;
    try{return await transaction(async tx=>{
      one((await tx.query('SELECT idproveedor FROM proveedor WHERE idproveedor=$1 AND activo FOR SHARE',[supplier])).rows,'Proveedor activo');
      const cash=initial>0n?(await tx.query('SELECT idcaja FROM caja WHERE activo AND cerrada_en IS NULL FOR UPDATE')).rows[0]:null;
      if(initial>0n&&!cash)throw new BadRequestException('Abrí una caja antes de registrar el anticipo');
      const ids=items.map((x:any)=>x.id),products=(await tx.query('SELECT * FROM producto WHERE idproducto=ANY($1::bigint[]) ORDER BY idproducto FOR UPDATE',[ids])).rows;
      if(products.length!==ids.length||products.some(p=>!p.activo||!p.es_comprar))throw new BadRequestException('Hay productos no disponibles para comprar');
      const byId=new Map(products.map(p=>[Number(p.idproducto),p]));let total=0n;
      for(const item of items)total+=BigInt(item.quantity)*item.price;
      if(total===0n||total>MAX||initial>total)throw new BadRequestException('El total o el anticipo no es válido');
      const purchase=(await tx.query('INSERT INTO compra(fk_idproveedor,total_gs,creado_por) VALUES($1,$2,$3) RETURNING *',[supplier,total.toString(),req.user.nombre])).rows[0];
      for(const item of items){const product=byId.get(item.id),before=Number(product.stock_actual),after=before+item.quantity;if(!Number.isSafeInteger(after)||after>2147483647)throw new BadRequestException('El stock excede el rango permitido');
        const line=(await tx.query('INSERT INTO compra_item(fk_idcompra,fk_idproducto,nombre_producto,cantidad,precio_unitario_gs,creado_por) VALUES($1,$2,$3,$4,$5,$6) RETURNING idcompra_item',[purchase.idcompra,item.id,product.nombre,item.quantity,item.price.toString(),req.user.nombre])).rows[0];
        await tx.query('UPDATE producto SET stock_actual=$1,precio_compra=$2,precio_compra_base_gs=COALESCE(precio_compra_base_gs,precio_compra) WHERE idproducto=$3',[after,item.price.toString(),item.id]);
        await tx.query("INSERT INTO inventario_movimiento(fk_idproducto,fk_idcompra_item,tipo,cantidad_anterior,delta,cantidad_nueva,motivo,creado_por) VALUES($1,$2,'compra',$3,$4,$5,$6,$7)",[item.id,line.idcompra_item,before,item.quantity,after,`Compra #${purchase.idcompra}`,req.user.nombre]);
      }
      if(initial>0n)await tx.query('INSERT INTO compra_pago(fk_idcompra,fk_idcaja,fk_idforma_pago,monto_gs,creado_por) VALUES($1,$2,$3,$4,$5)',[purchase.idcompra,cash.idcaja,method,initial.toString(),req.user.nombre]);
      await audit(tx,req.user,'crear','compra',purchase.idcompra);return purchase;
    });}catch(e){dbError(e);}
  }
  @Post('compras/:id/pagos') async pay(@Param('id') id:string,@Body() b:any,@Req() req:any){
    const purchaseId=positiveInt(id,'compra'),value=amount(b.monto_gs,'monto'),method=positiveInt(b.fk_idforma_pago,'forma de pago');
    try{return await transaction(async tx=>{one((await tx.query('SELECT idcompra FROM compra WHERE idcompra=$1 FOR UPDATE',[purchaseId])).rows,'Compra');const cash=(await tx.query('SELECT idcaja FROM caja WHERE activo AND cerrada_en IS NULL FOR UPDATE')).rows[0];if(!cash)throw new BadRequestException('Abrí una caja antes de pagar');const row=(await tx.query('INSERT INTO compra_pago(fk_idcompra,fk_idcaja,fk_idforma_pago,monto_gs,creado_por) VALUES($1,$2,$3,$4,$5) RETURNING *',[purchaseId,cash.idcaja,method,value.toString(),req.user.nombre])).rows[0];await audit(tx,req.user,'pagar','compra',purchaseId,{idcompra_pago:row.idcompra_pago,monto_gs:row.monto_gs});return row;});}catch(e){dbError(e);}
  }
  @Post('compras/:id/anular') async annul(@Param('id') id:string,@Body() b:any,@Req() req:any){
    const purchaseId=positiveInt(id,'compra'),motive=required(b.motivo,'Motivo de anulación');
    return transaction(async tx=>{const purchase=one((await tx.query('SELECT * FROM compra WHERE idcompra=$1 FOR UPDATE',[purchaseId])).rows,'Compra');if(purchase.anulado)return purchase;
      const payments=(await tx.query('SELECT fk_idcaja FROM compra_pago WHERE fk_idcompra=$1 AND activo AND NOT anulado ORDER BY fk_idcaja FOR UPDATE',[purchaseId])).rows;
      for(const cashId of [...new Set(payments.map(p=>String(p.fk_idcaja)))])await tx.query('SELECT idcaja FROM caja WHERE idcaja=$1 FOR UPDATE',[cashId]);
      const items=(await tx.query('SELECT * FROM compra_item WHERE fk_idcompra=$1 ORDER BY fk_idproducto FOR UPDATE',[purchaseId])).rows;
      for(const item of items){const product=one((await tx.query('SELECT * FROM producto WHERE idproducto=$1 FOR UPDATE',[item.fk_idproducto])).rows,'Producto');const before=Number(product.stock_actual),after=before-Number(item.cantidad);if(after<-2147483648)throw new BadRequestException('El stock excede el rango permitido');
        const latest=(await tx.query(`SELECT ci.precio_unitario_gs FROM compra_item ci JOIN compra c ON c.idcompra=ci.fk_idcompra WHERE ci.fk_idproducto=$1 AND c.idcompra<>$2 AND c.activo AND NOT c.anulado ORDER BY c.idcompra DESC LIMIT 1`,[item.fk_idproducto,purchaseId])).rows[0];
        const currentLatest=(await tx.query(`SELECT ci.fk_idcompra FROM compra_item ci JOIN compra c ON c.idcompra=ci.fk_idcompra WHERE ci.fk_idproducto=$1 AND c.activo AND NOT c.anulado ORDER BY c.idcompra DESC LIMIT 1`,[item.fk_idproducto])).rows[0];
        await tx.query('UPDATE producto SET stock_actual=$1,precio_compra=CASE WHEN $2 THEN COALESCE($3,precio_compra_base_gs,precio_compra) ELSE precio_compra END WHERE idproducto=$4',[after,String(currentLatest?.fk_idcompra)===String(purchaseId),latest?.precio_unitario_gs??null,item.fk_idproducto]);
        await tx.query("INSERT INTO inventario_movimiento(fk_idproducto,fk_idcompra_item,tipo,cantidad_anterior,delta,cantidad_nueva,motivo,creado_por) VALUES($1,$2,'anulacion_compra',$3,$4,$5,$6,$7)",[item.fk_idproducto,item.idcompra_item,before,-Number(item.cantidad),after,`Anulación de compra #${purchaseId}: ${motive}`,req.user.nombre]);
      }
      const cancelled=(await tx.query('UPDATE compra_pago SET anulado=TRUE,fecha_anulado=now(),anulado_por=$2,motivo_anulacion=$3 WHERE fk_idcompra=$1 AND activo AND NOT anulado RETURNING idcompra_pago',[purchaseId,req.user.nombre,motive])).rows;
      for(const payment of cancelled){const movement=(await tx.query('SELECT idcaja_detalle FROM caja_detalle WHERE fk_idcompra_pago=$1',[payment.idcompra_pago])).rows[0];if(movement)await audit(tx,req.user,'anular','caja_detalle',movement.idcaja_detalle,{motivo:motive,fk_idcompra:purchaseId});}
      const row=(await tx.query('UPDATE compra SET anulado=TRUE,fecha_anulado=now(),anulado_por=$2,motivo_anulacion=$3 WHERE idcompra=$1 RETURNING *',[purchaseId,req.user.nombre,motive])).rows[0];await audit(tx,req.user,'anular','compra',purchaseId,{motivo:motive});return row;
    });
  }
}
