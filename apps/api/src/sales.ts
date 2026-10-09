import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query as Q, Req, Res, UseGuards } from '@nestjs/common';
import { query, transaction } from './db';
import { Actor, AuthGuard } from './auth';
import { allowed, dbError, hotelDate, isoDate, nonNegativeGs, one, positiveInt, required } from './common';
import { paginateList } from './pagination';
import { createSaleTicket } from './sales-ticket';

const actor=(req:any)=>req.user as Actor;
const signedInt=(value:unknown,name:string)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<-2147483648||n>2147483647)throw new BadRequestException(`${name} debe ser un entero válido`);return n;};
const boolean=(value:unknown,name:string)=>{if(typeof value!=='boolean')throw new BadRequestException(`${name} debe ser verdadero o falso`);return value;};
const audit=async(tx:any,u:Actor,action:string,entity:string,id:unknown,detail?:unknown)=>tx.query('INSERT INTO auditoria(fk_idusuario,accion,entidad,identificador,detalle,creado_por) VALUES($1,$2,$3,$4,$5,$6)',[u.idusuario,action,entity,String(id),detail?JSON.stringify(detail):null,u.nombre]);
const stockChange=async(tx:any,product:any,delta:number,type:string,motive:string,user:Actor,itemId?:unknown)=>{
  const before=Number(product.stock_actual),after=before+delta;
  if(!Number.isSafeInteger(after)||after<-2147483648||after>2147483647||delta<-2147483648||delta>2147483647)throw new BadRequestException('El stock excede el rango permitido');
  await tx.query('UPDATE producto SET stock_actual=$1 WHERE idproducto=$2',[after,product.idproducto]);
  await tx.query('INSERT INTO inventario_movimiento(fk_idproducto,fk_idventa_item,tipo,cantidad_anterior,delta,cantidad_nueva,motivo,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[product.idproducto,itemId||null,type,before,delta,after,motive,user.nombre]);
  product.stock_actual=after;
};

@Controller('api/ventas') @UseGuards(AuthGuard)
export class SalesController {
  @Get('categorias') async categories(@Q('admin') admin?:string) {
    return (await query(`SELECT * FROM categoria_producto ${admin==='1'?'':'WHERE activo'} ORDER BY orden,idcategoria_producto`)).rows;
  }
  @Post('categorias') async createCategory(@Body() b:any,@Req() req:any) {
    const u=actor(req),name=required(b.nombre,'nombre');
    try{return await transaction(async tx=>{
      await tx.query('SELECT idcategoria_producto FROM categoria_producto ORDER BY idcategoria_producto FOR UPDATE');
      const order=(await tx.query('SELECT COALESCE(MAX(orden),0)+1 AS orden FROM categoria_producto')).rows[0].orden;
      const row=(await tx.query('INSERT INTO categoria_producto(nombre,orden,creado_por) VALUES($1,$2,$3) RETURNING *',[name,order,u.nombre])).rows[0];
      await audit(tx,u,'crear','categoria_producto',row.idcategoria_producto);return row;
    });}catch(e){dbError(e);}
  }
  @Patch('categorias/:id') async updateCategory(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req);try{return await transaction(async tx=>{
      const row=one((await tx.query('SELECT * FROM categoria_producto WHERE idcategoria_producto=$1 FOR UPDATE',[positiveInt(id,'categoría')])).rows,'Categoría');
      const name=b.nombre===undefined?row.nombre:required(b.nombre,'nombre'),active=b.activo===undefined?row.activo:boolean(b.activo,'activo');
      const updated=(await tx.query('UPDATE categoria_producto SET nombre=$1,activo=$2 WHERE idcategoria_producto=$3 RETURNING *',[name,active,id])).rows[0];
      await audit(tx,u,'editar','categoria_producto',id);return updated;
    });}catch(e){dbError(e);}
  }
  @Post('categorias/:id/mover') async moveCategory(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req),direction=allowed(b.direccion,['subir','bajar'] as const,'dirección');
    return transaction(async tx=>{
      const rows=(await tx.query('SELECT idcategoria_producto,orden FROM categoria_producto ORDER BY orden,idcategoria_producto FOR UPDATE')).rows;
      const index=rows.findIndex(x=>String(x.idcategoria_producto)===String(positiveInt(id,'categoría')));
      if(index<0)throw new BadRequestException('Categoría no encontrada');
      const adjacent=rows[index+(direction==='subir'?-1:1)];if(!adjacent)return rows[index];
      await tx.query('UPDATE categoria_producto SET orden=$1 WHERE idcategoria_producto=$2',[-Number(rows[index].idcategoria_producto),id]);
      await tx.query('UPDATE categoria_producto SET orden=$1 WHERE idcategoria_producto=$2',[rows[index].orden,adjacent.idcategoria_producto]);
      const moved=(await tx.query('UPDATE categoria_producto SET orden=$1 WHERE idcategoria_producto=$2 RETURNING *',[adjacent.orden,id])).rows[0];
      await audit(tx,u,'mover','categoria_producto',id,{direccion:direction});return moved;
    });
  }
  @Get('productos') async products(@Q('admin') admin?:string) {
    return (await query(`SELECT p.*,c.nombre AS categoria_nombre,c.activo AS categoria_activa FROM producto p JOIN categoria_producto c ON c.idcategoria_producto=p.fk_idcategoria_producto ${admin==='1'?'':'WHERE p.activo AND p.es_vender AND c.activo'} ORDER BY c.orden,p.nombre,p.idproducto`)).rows;
  }
  @Post('productos') async createProduct(@Body() b:any,@Req() req:any) {
    const u=actor(req),name=required(b.nombre,'nombre'),category=positiveInt(b.fk_idcategoria_producto,'categoría');
    const fields:[string,string,number,number]=[nonNegativeGs(b.precio_venta,'precio de venta'),nonNegativeGs(b.precio_compra,'precio de compra'),signedInt(b.stock_actual??0,'stock actual'),signedInt(b.stock_minimo??0,'stock mínimo')];
    if(fields[3]<0)throw new BadRequestException('El stock mínimo no puede ser negativo');
    const flags=['descontar_stock','es_vender','es_comprar','es_cocina'].map((key,i)=>b[key]===undefined?[true,true,false,false][i]:boolean(b[key],key));
    try{return await transaction(async tx=>{
      one((await tx.query('SELECT idcategoria_producto FROM categoria_producto WHERE idcategoria_producto=$1',[category])).rows,'Categoría');
      const row=(await tx.query('INSERT INTO producto(fk_idcategoria_producto,nombre,precio_venta,precio_compra,stock_actual,stock_minimo,descontar_stock,es_vender,es_comprar,es_cocina,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[category,name,...fields,...flags,u.nombre])).rows[0];
      await tx.query("INSERT INTO inventario_movimiento(fk_idproducto,tipo,cantidad_anterior,delta,cantidad_nueva,motivo,creado_por) VALUES($1,'inicial',0,$2,$2,'Stock inicial',$3)",[row.idproducto,fields[2],u.nombre]);
      await audit(tx,u,'crear','producto',row.idproducto);return row;
    });}catch(e){dbError(e);}
  }
  @Patch('productos/:id') async updateProduct(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req);try{return await transaction(async tx=>{
      const old=one((await tx.query('SELECT * FROM producto WHERE idproducto=$1 FOR UPDATE',[positiveInt(id,'producto')])).rows,'Producto');
      const category=b.fk_idcategoria_producto===undefined?old.fk_idcategoria_producto:positiveInt(b.fk_idcategoria_producto,'categoría');
      one((await tx.query('SELECT idcategoria_producto FROM categoria_producto WHERE idcategoria_producto=$1',[category])).rows,'Categoría');
      const min=b.stock_minimo===undefined?old.stock_minimo:signedInt(b.stock_minimo,'stock mínimo');if(min<0)throw new BadRequestException('El stock mínimo no puede ser negativo');
      const vals=[category,b.nombre===undefined?old.nombre:required(b.nombre,'nombre'),b.precio_venta===undefined?old.precio_venta:nonNegativeGs(b.precio_venta,'precio de venta'),b.precio_compra===undefined?old.precio_compra:nonNegativeGs(b.precio_compra,'precio de compra'),min,...['descontar_stock','es_vender','es_comprar','es_cocina','activo'].map(key=>b[key]===undefined?old[key]:boolean(b[key],key)),id];
      if(b.stock_actual!==undefined)throw new BadRequestException('Actualizá el stock desde Inventario');
      const row=(await tx.query('UPDATE producto SET fk_idcategoria_producto=$1,nombre=$2,precio_venta=$3,precio_compra=$4,stock_minimo=$5,descontar_stock=$6,es_vender=$7,es_comprar=$8,es_cocina=$9,activo=$10 WHERE idproducto=$11 RETURNING *',vals)).rows[0];
      await audit(tx,u,'editar','producto',id);return row;
    });}catch(e){dbError(e);}
  }
  @Get('inventario') async inventory() {
    const [products,moves]=await Promise.all([query('SELECT p.*,c.nombre AS categoria_nombre FROM producto p JOIN categoria_producto c ON c.idcategoria_producto=p.fk_idcategoria_producto ORDER BY c.orden,p.nombre'),query('SELECT m.*,p.nombre AS producto_nombre FROM inventario_movimiento m JOIN producto p ON p.idproducto=m.fk_idproducto ORDER BY m.idinventario_movimiento DESC LIMIT 100')]);
    return {productos:products.rows,movimientos:moves.rows};
  }
  @Post('inventario/ajustes') async adjust(@Body() b:any,@Req() req:any) {
    const u=actor(req),id=positiveInt(b.fk_idproducto,'producto'),newStock=signedInt(b.stock_nuevo,'stock nuevo'),motive=required(b.motivo,'motivo');
    return transaction(async tx=>{
      const p=one((await tx.query('SELECT * FROM producto WHERE idproducto=$1 FOR UPDATE',[id])).rows,'Producto');
      if(Number(p.stock_actual)===newStock)throw new BadRequestException('El stock nuevo debe ser diferente');
      await stockChange(tx,p,newStock-Number(p.stock_actual),'ajuste',motive,u);await audit(tx,u,'ajustar','producto',id,{stock_nuevo:newStock,motivo:motive});return p;
    });
  }
  @Get('habitaciones-en-casa') async occupiedRooms() {
    return (await query("SELECT h.idhabitacion,h.numero,r.idreserva,c.nombre AS cliente_nombre,c.apellido AS cliente_apellido FROM reserva_habitacion rh JOIN habitacion h ON h.idhabitacion=rh.fk_idhabitacion JOIN reserva r ON r.idreserva=rh.fk_idreserva JOIN cliente c ON c.idcliente=r.fk_idcliente WHERE rh.activo AND rh.estado='en_casa' AND r.activo AND r.estado='en_casa' ORDER BY h.numero")).rows;
  }
  @Get('analisis') async analysis(@Q('desde') desde:string,@Q('hasta') hasta:string) {
    const start=isoDate(desde,'desde'),end=isoDate(hasta,'hasta');
    if(end<start)throw new BadRequestException('La fecha hasta debe ser posterior o igual a la fecha desde');
    const params=[start,end];
    const sales=`SELECT v.idventa,v.fecha_creado,v.destino,v.total_gs,v.pagado_inicial_gs
      FROM venta v WHERE v.activo AND NOT v.anulado
      AND v.fecha_creado >= ($1::date::timestamp AT TIME ZONE 'America/Asuncion')
      AND v.fecha_creado < (($2::date + 1)::timestamp AT TIME ZONE 'America/Asuncion')`;
    const [totals,days,products,methods,destinations,hours]=await Promise.all([
      query(`WITH ventas AS (${sales}) SELECT COUNT(*)::int AS cantidad_ventas,
        COALESCE(SUM(total_gs),0)::text AS total_gs,
        COALESCE(SUM(pagado_inicial_gs),0)::text AS cobrado_inicial_gs,
        COALESCE(SUM(total_gs-pagado_inicial_gs),0)::text AS pendiente_inicial_gs,
        (SELECT COALESCE(SUM(vi.cantidad),0)::int FROM venta_item vi JOIN ventas v ON v.idventa=vi.fk_idventa WHERE vi.activo) AS unidades
        FROM ventas`,params),
      query(`WITH ventas AS (${sales}), diario AS (
        SELECT (fecha_creado AT TIME ZONE 'America/Asuncion')::date AS fecha,
          COUNT(*)::int AS cantidad_ventas,SUM(total_gs) AS total_gs
        FROM ventas GROUP BY 1)
        SELECT d::date::text AS fecha,COALESCE(diario.cantidad_ventas,0) AS cantidad_ventas,
          COALESCE(diario.total_gs,0)::text AS total_gs
        FROM generate_series($1::date::timestamp,$2::date::timestamp,interval '1 day') d
        LEFT JOIN diario ON diario.fecha=d::date ORDER BY d`,params),
      query(`WITH ventas AS (${sales}) SELECT vi.fk_idproducto AS idproducto,
        COALESCE(MAX(p.nombre),MAX(vi.nombre_producto)) AS nombre,
        SUM(vi.cantidad)::int AS unidades,
        SUM(vi.cantidad*vi.precio_unitario_gs)::text AS total_gs
        FROM venta_item vi JOIN ventas v ON v.idventa=vi.fk_idventa
        LEFT JOIN producto p ON p.idproducto=vi.fk_idproducto
        WHERE vi.activo GROUP BY vi.fk_idproducto ORDER BY SUM(vi.cantidad) DESC,SUM(vi.cantidad*vi.precio_unitario_gs) DESC LIMIT 10`,params),
      query(`WITH ventas AS (${sales}) SELECT f.idforma_pago,f.nombre,
        SUM(CASE WHEN p.clase='devolucion' THEN -p.monto_gs ELSE p.monto_gs END)::text AS total_gs
        FROM pago p JOIN ventas v ON v.idventa=p.fk_idventa
        JOIN forma_pago f ON f.idforma_pago=p.fk_idforma_pago
        WHERE p.activo AND NOT p.anulado GROUP BY f.idforma_pago,f.nombre ORDER BY SUM(CASE WHEN p.clase='devolucion' THEN -p.monto_gs ELSE p.monto_gs END) DESC`,params),
      query(`WITH ventas AS (${sales}), por_destino AS (
        SELECT destino,COUNT(*)::int AS cantidad_ventas,SUM(total_gs) AS total_gs FROM ventas GROUP BY destino)
        SELECT d.destino,COALESCE(p.cantidad_ventas,0) AS cantidad_ventas,COALESCE(p.total_gs,0)::text AS total_gs
        FROM (VALUES ('restaurante'),('habitacion')) d(destino)
        LEFT JOIN por_destino p ON p.destino=d.destino ORDER BY d.destino`,params),
      query(`WITH ventas AS (${sales}), por_hora AS (
        SELECT EXTRACT(HOUR FROM fecha_creado AT TIME ZONE 'America/Asuncion')::int AS hora,
          COUNT(*)::int AS cantidad_ventas,SUM(total_gs) AS total_gs FROM ventas GROUP BY 1)
        SELECT h.hora,COALESCE(p.cantidad_ventas,0) AS cantidad_ventas,COALESCE(p.total_gs,0)::text AS total_gs
        FROM generate_series(0,23) h(hora) LEFT JOIN por_hora p ON p.hora=h.hora ORDER BY h.hora`,params)
    ]);
    const summary=totals.rows[0];
    return {desde:start,hasta:end,resumen:{...summary,ticket_promedio_gs:summary.cantidad_ventas?(BigInt(summary.total_gs)/BigInt(summary.cantidad_ventas)).toString():'0'},
      dias:days.rows,productos:products.rows,formas_pago:methods.rows,destinos:destinations.rows,horas:hours.rows};
  }
  @Get() async sales(@Q('pagina') pagina?:string,@Q('desde') desde?:string,@Q('hasta') hasta?:string,@Q('q') q?:string):Promise<any> {
    const start=desde?isoDate(desde,'desde'):null,end=hasta?isoDate(hasta,'hasta'):null;
    if(start&&end&&end<start)throw new BadRequestException('La fecha hasta debe ser posterior o igual a la fecha desde');
    const search=q?.trim()||null;
    const sql=`SELECT v.*,h.numero AS habitacion_numero,c.nombre AS cliente_nombre,c.apellido AS cliente_apellido,
      COALESCE((SELECT SUM(CASE WHEN m.tipo='descuento' THEN -m.cantidad*m.monto_unitario_gs ELSE m.cantidad*m.monto_unitario_gs END) FROM movimiento m WHERE m.fk_idreserva=v.fk_idreserva AND m.activo AND NOT m.anulado),0)
      - COALESCE((SELECT SUM(CASE WHEN p.clase='devolucion' THEN -p.monto_gs ELSE p.monto_gs END) FROM pago p WHERE p.fk_idreserva=v.fk_idreserva AND p.activo AND NOT p.anulado),0) AS saldo_reserva_gs
      FROM venta v LEFT JOIN habitacion h ON h.idhabitacion=v.fk_idhabitacion LEFT JOIN reserva r ON r.idreserva=v.fk_idreserva LEFT JOIN cliente c ON c.idcliente=r.fk_idcliente
      WHERE v.activo AND ($1::date IS NULL OR v.fecha_creado >= $1::date)
        AND ($2::date IS NULL OR v.fecha_creado < ($2::date + interval '1 day'))
        AND ($3::text IS NULL OR concat_ws(' ',c.nombre,c.apellido) ILIKE '%' || $3 || '%')`;
    const params=[start,end,search];
    if(pagina!==undefined)return paginateList(sql,params,pagina,'idventa');
    return (await query(sql+' ORDER BY v.idventa DESC LIMIT 200',params)).rows;
  }
  @Get(':id/ticket') async ticket(@Param('id') id:string,@Res() res:any) {
    const sale=await this.detail(id);
    const hotel=(await query('SELECT nombre,direccion,telefono FROM hotel WHERE activo ORDER BY idhotel LIMIT 1')).rows[0]||null;
    const pdf=createSaleTicket(sale,hotel);
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`inline; filename="venta-${sale.idventa}-ticket.pdf"`);
    pdf.pipe(res);
  }
  @Get(':id') async detail(@Param('id') id:string) {
    const saleId=positiveInt(id,'venta');
    const sale=one((await query(`SELECT v.idventa,v.fk_idreserva,v.fk_idhabitacion,v.destino,v.total_gs,v.pagado_inicial_gs,
      v.anulado,v.fecha_anulado,v.anulado_por,v.motivo_anulacion,v.fecha_creado,v.creado_por,
      h.numero AS habitacion_numero,c.nombre AS cliente_nombre,c.apellido AS cliente_apellido,
      r.fecha_entrada AS reserva_entrada,r.fecha_salida AS reserva_salida,
      CASE WHEN v.fk_idreserva IS NULL THEN NULL ELSE
        COALESCE((SELECT SUM(CASE WHEN m.tipo='descuento' THEN -m.cantidad*m.monto_unitario_gs ELSE m.cantidad*m.monto_unitario_gs END)
          FROM movimiento m WHERE m.fk_idreserva=v.fk_idreserva AND m.activo AND NOT m.anulado),0)
        - COALESCE((SELECT SUM(CASE WHEN p.clase='devolucion' THEN -p.monto_gs ELSE p.monto_gs END)
          FROM pago p WHERE p.fk_idreserva=v.fk_idreserva AND p.activo AND NOT p.anulado),0)
      END AS saldo_reserva_gs
      FROM venta v LEFT JOIN habitacion h ON h.idhabitacion=v.fk_idhabitacion
      LEFT JOIN reserva r ON r.idreserva=v.fk_idreserva
      LEFT JOIN cliente c ON c.idcliente=r.fk_idcliente WHERE v.idventa=$1`,[saleId])).rows,'Venta');
    const [items,payments]=await Promise.all([
      query('SELECT idventa_item,nombre_producto,cantidad,precio_unitario_gs,pago_inicial FROM venta_item WHERE fk_idventa=$1 ORDER BY idventa_item',[saleId]),
      query(`SELECT p.idpago,p.clase,p.monto_gs,p.fecha_creado,p.anulado,p.fk_idcaja,f.nombre AS forma_pago_nombre
        FROM pago p JOIN forma_pago f ON f.idforma_pago=p.fk_idforma_pago
        WHERE p.fk_idventa=$1 AND p.activo ORDER BY p.idpago`,[saleId])
    ]);
    return {...sale,items:items.rows,pagos:payments.rows};
  }
  @Post() async createSale(@Body() b:any,@Req() req:any) {
    const u=actor(req),destination=allowed(b.destino,['restaurante','habitacion'] as const,'destino');
    if(!Array.isArray(b.items)||!b.items.length)throw new BadRequestException('Agregá al menos un producto');
    if(b.items.length>100)throw new BadRequestException('Demasiados artículos');
    const parsed=b.items.map((x:any)=>({id:positiveInt(x.fk_idproducto,'producto'),quantity:positiveInt(x.cantidad,'cantidad'),payment:allowed(x.pago_inicial,['pagado','pendiente'] as const,'estado de pago')}));
    const roomId=b.fk_idhabitacion?positiveInt(b.fk_idhabitacion,'habitación'):null;
    if(destination==='habitacion'&&!roomId)throw new BadRequestException('Elegí una habitación en casa');
    if(!roomId&&parsed.some((x:any)=>x.payment==='pendiente'))throw new BadRequestException('Los artículos pendientes requieren una habitación');
    const form=b.fk_idforma_pago?positiveInt(b.fk_idforma_pago,'forma de pago'):null;
    try{return await transaction(async tx=>{
      const caja=(await tx.query('SELECT idcaja FROM caja WHERE cerrada_en IS NULL AND activo FOR UPDATE')).rows[0];
      let reservation:any=null;
      if(roomId){reservation=one((await tx.query("SELECT r.idreserva FROM reserva_habitacion rh JOIN reserva r ON r.idreserva=rh.fk_idreserva WHERE rh.fk_idhabitacion=$1 AND rh.activo AND rh.estado='en_casa' AND r.activo AND r.estado='en_casa' FOR UPDATE OF r",[roomId])).rows,'Habitación en casa');
        if((await tx.query('SELECT 1 FROM documento_electronico WHERE fk_idreserva=$1 AND activo LIMIT 1',[reservation.idreserva])).rowCount)throw new BadRequestException('La cuenta ya tiene un documento fiscal preparado');}
      const ids=[...new Set<number>(parsed.map((x:any)=>x.id))].sort((a,b)=>a-b);
      const products=(await tx.query('SELECT p.*,c.activo AS categoria_activa FROM producto p JOIN categoria_producto c ON c.idcategoria_producto=p.fk_idcategoria_producto WHERE p.idproducto=ANY($1::bigint[]) ORDER BY p.idproducto FOR UPDATE OF p',[ids])).rows;
      if(products.length!==ids.length||products.some(p=>!p.activo||!p.es_vender||!p.categoria_activa))throw new BadRequestException('Hay productos no disponibles para vender');
      const byId=new Map(products.map(p=>[Number(p.idproducto),p]));
      let total=0n,paid=0n;
      for(const item of parsed){const amount=BigInt(byId.get(item.id).precio_venta)*BigInt(item.quantity);total+=amount;if(item.payment==='pagado')paid+=amount;}
      if(paid>0n){if(!caja)throw new BadRequestException('Abrí una caja antes de cobrar');if(!form)throw new BadRequestException('Elegí una forma de pago');one((await tx.query('SELECT idforma_pago FROM forma_pago WHERE idforma_pago=$1 AND activo FOR SHARE',[form])).rows,'Forma de pago activa');}
      const sale=(await tx.query('INSERT INTO venta(fk_idreserva,fk_idhabitacion,destino,total_gs,pagado_inicial_gs,creado_por) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[reservation?.idreserva||null,roomId,destination,total.toString(),paid.toString(),u.nombre])).rows[0];
      for(const item of parsed){const p=byId.get(item.id),price=String(p.precio_venta);let movementId=null;
        if(reservation){const movement=(await tx.query("INSERT INTO movimiento(fk_idreserva,tipo,descripcion,cantidad,monto_unitario_gs,iva_tasa,fecha_servicio,creado_por) VALUES($1,'extra',$2,$3,$4,10,$5,$6) RETURNING idmovimiento",[reservation.idreserva,p.nombre,item.quantity,price,hotelDate(),u.nombre])).rows[0];movementId=movement.idmovimiento;}
        const purchasePrice=String(p.precio_compra);
        const line=(await tx.query('INSERT INTO venta_item(fk_idventa,fk_idproducto,fk_idmovimiento,nombre_producto,cantidad,precio_unitario_gs,precio_compra_unitario_gs,pago_inicial,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING idventa_item',[sale.idventa,p.idproducto,movementId,p.nombre,item.quantity,price,purchasePrice,item.payment,u.nombre])).rows[0];
        if(p.descontar_stock)await stockChange(tx,p,-item.quantity,'venta',`Venta #${sale.idventa}`,u,line.idventa_item);
      }
      if(paid>0n)await tx.query("INSERT INTO pago(fk_idreserva,fk_idventa,fk_idcaja,fk_idforma_pago,monto_gs,monto_alojamiento_gs,creado_por) VALUES($1,$2,$3,$4,$5,0,$6)",[reservation?.idreserva||null,sale.idventa,caja.idcaja,form,paid.toString(),u.nombre]);
      await audit(tx,u,'crear','venta',sale.idventa);return sale;
    });}catch(e){dbError(e);}
  }
  @Post(':id/anular') async annul(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req),motive=required(b.motivo,'motivo de anulación');
    return transaction(async tx=>{
      one((await tx.query('SELECT idventa FROM venta WHERE idventa=$1',[positiveInt(id,'venta')])).rows,'Venta');
      const caja=(await tx.query('SELECT idcaja FROM caja WHERE cerrada_en IS NULL AND activo FOR UPDATE')).rows[0];
      const sale=one((await tx.query('SELECT * FROM venta WHERE idventa=$1 FOR UPDATE',[id])).rows,'Venta');
      if(sale.anulado)return sale;
      if(BigInt(sale.pagado_inicial_gs)>0n&&!caja)throw new BadRequestException('Abrí una caja antes de registrar la devolución');
      if(sale.fk_idreserva){await tx.query('SELECT idreserva FROM reserva WHERE idreserva=$1 FOR UPDATE',[sale.fk_idreserva]);
        if((await tx.query('SELECT 1 FROM documento_electronico WHERE fk_idreserva=$1 AND activo LIMIT 1',[sale.fk_idreserva])).rowCount)throw new BadRequestException('La reserva ya tiene una factura preparada');
        if(BigInt(sale.total_gs)>BigInt(sale.pagado_inicial_gs)){
          const later=(await tx.query('SELECT 1 FROM pago WHERE fk_idreserva=$1 AND fk_idventa IS DISTINCT FROM $2 AND fecha_creado>$3 AND activo AND NOT anulado AND clase=\'pago\' LIMIT 1',[sale.fk_idreserva,id,sale.fecha_creado])).rowCount;
          if(later){const balance=(await tx.query(`SELECT COALESCE((SELECT SUM(CASE WHEN tipo='descuento' THEN -cantidad*monto_unitario_gs ELSE cantidad*monto_unitario_gs END) FROM movimiento WHERE fk_idreserva=$1 AND activo AND NOT anulado),0)-COALESCE((SELECT SUM(CASE WHEN clase='devolucion' THEN -monto_gs ELSE monto_gs END) FROM pago WHERE fk_idreserva=$1 AND activo AND NOT anulado),0) AS saldo`,[sale.fk_idreserva])).rows[0].saldo;
            if(BigInt(balance)<=0n||BigInt(balance)-BigInt(sale.total_gs)+BigInt(sale.pagado_inicial_gs)<0n)throw new BadRequestException('Corregí primero los cobros posteriores de la reserva');}
        }
      }
      const items=(await tx.query('SELECT * FROM venta_item WHERE fk_idventa=$1 ORDER BY fk_idproducto,idventa_item',[id])).rows;
      for(const item of items){if(item.fk_idmovimiento)await tx.query('UPDATE movimiento SET anulado=TRUE WHERE idmovimiento=$1',[item.fk_idmovimiento]);
        const prior=(await tx.query("SELECT 1 FROM inventario_movimiento WHERE fk_idventa_item=$1 AND tipo='venta'",[item.idventa_item])).rowCount;
        if(prior){const p=one((await tx.query('SELECT * FROM producto WHERE idproducto=$1 FOR UPDATE',[item.fk_idproducto])).rows,'Producto');await stockChange(tx,p,item.cantidad,'anulacion',`Anulación de venta #${id}: ${motive}`,u,item.idventa_item);}
      }
      const original=(await tx.query("SELECT * FROM pago WHERE fk_idventa=$1 AND clase='pago' AND activo AND NOT anulado ORDER BY idpago LIMIT 1",[id])).rows[0];
      if(original)await tx.query("INSERT INTO pago(fk_idreserva,fk_idventa,fk_idcaja,fk_idforma_pago,clase,monto_gs,monto_alojamiento_gs,referencia,creado_por) VALUES($1,$2,$3,$4,'devolucion',$5,0,$6,$7)",[sale.fk_idreserva,id,caja.idcaja,original.fk_idforma_pago,original.monto_gs,motive,u.nombre]);
      const row=(await tx.query('UPDATE venta SET anulado=TRUE,fecha_anulado=now(),anulado_por=$2,motivo_anulacion=$3 WHERE idventa=$1 RETURNING *',[id,u.nombre,motive])).rows[0];
      await audit(tx,u,'anular','venta',id,{motivo:motive});return row;
    });
  }
}
