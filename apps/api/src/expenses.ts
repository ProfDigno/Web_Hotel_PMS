import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth';
import { query, transaction } from './db';
import { allowed, dbError, hotelDate, one, positiveInt, required } from './common';
import { paginateList } from './pagination';

const audit=async(tx:any,u:any,action:string,entity:string,id:unknown,detail?:unknown)=>tx.query('INSERT INTO auditoria(fk_idusuario,accion,entidad,identificador,detalle,creado_por) VALUES($1,$2,$3,$4,$5,$6)',[u.idusuario,action,entity,String(id),JSON.stringify(detail??{}),u.nombre]);
function date(value:unknown):string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||value<'0001-01-01')throw new BadRequestException('Fecha inválida');
  return value;
}
function active(value:unknown){if(typeof value!=='boolean')throw new BadRequestException('Activo debe ser booleano');return value;}
const select=`SELECT g.*,g.fecha_gasto::text AS fecha_gasto,t.nombre AS tipo_nombre,f.nombre AS forma_pago_nombre,f.es_efectivo FROM gasto g JOIN gasto_tipo t ON t.idgasto_tipo=g.fk_idgasto_tipo JOIN forma_pago f ON f.idforma_pago=g.fk_idforma_pago`;
function filters(q:any,analysis=false){
  const desde=q.desde?date(q.desde):analysis?hotelDate().slice(0,7)+'-01':null,hasta=q.hasta?date(q.hasta):analysis?hotelDate():null;
  if(desde&&hasta&&desde>hasta)throw new BadRequestException('La fecha hasta debe ser igual o posterior a la fecha desde');
  const values:unknown[]=[desde,hasta,q.tipo?positiveInt(q.tipo,'tipo'):null,q.forma_pago?positiveInt(q.forma_pago,'forma de pago'):null];
  let where=' WHERE g.activo AND ($1::date IS NULL OR g.fecha_gasto >= $1) AND ($2::date IS NULL OR g.fecha_gasto <= $2) AND ($3::bigint IS NULL OR g.fk_idgasto_tipo=$3) AND ($4::bigint IS NULL OR g.fk_idforma_pago=$4)';
  if(!analysis){values.push(q.estado?allowed(q.estado,['vigente','anulado','todos'],'estado'):'todos',q.q?required(q.q,'búsqueda'):null);where+=" AND ($5='todos' OR g.anulado=($5='anulado')) AND ($6::text IS NULL OR g.descripcion ILIKE '%'||$6||'%')";}
  return {desde,hasta,values,where};
}
@Controller('api') @UseGuards(AuthGuard)
export class ExpensesController {
  @Get('gastos-tipos') async types(@Query('todos') all?:string){return (await query(`SELECT * FROM gasto_tipo ${all==='1'?'':'WHERE activo'} ORDER BY nombre`)).rows;}
  @Post('gastos-tipos') async createType(@Body() b:any,@Req() req:any){
    try{return await transaction(async tx=>{const row=(await tx.query('INSERT INTO gasto_tipo(nombre,activo,creado_por) VALUES($1,$2,$3) RETURNING *',[required(b.nombre,'Nombre'),b.activo===undefined?true:active(b.activo),req.user.nombre])).rows[0];await audit(tx,req.user,'crear','gasto_tipo',row.idgasto_tipo);return row;});}catch(e){dbError(e);}
  }
  @Patch('gastos-tipos/:id') async updateType(@Param('id') id:string,@Body() b:any,@Req() req:any){
    try{return await transaction(async tx=>{const old=one((await tx.query('SELECT * FROM gasto_tipo WHERE idgasto_tipo=$1 FOR UPDATE',[positiveInt(id,'tipo')])).rows,'Tipo de gasto');const row=(await tx.query('UPDATE gasto_tipo SET nombre=$1,activo=$2 WHERE idgasto_tipo=$3 RETURNING *',[b.nombre===undefined?old.nombre:required(b.nombre,'Nombre'),b.activo===undefined?old.activo:active(b.activo),id])).rows[0];await audit(tx,req.user,'editar','gasto_tipo',id,{antes:old,despues:row});return row;});}catch(e){dbError(e);}
  }
  @Get('gastos/opciones') async options(){return {tipos:await this.types('1'),formas_pago:(await query('SELECT idforma_pago,nombre,activo FROM forma_pago ORDER BY nombre')).rows};}
  @Get('gastos/analisis') async analysis(@Query() q:any){
    const f=filters(q,true);
    const days=Math.round((Date.parse(f.hasta!)-Date.parse(f.desde!))/86400000)+1;
    if(days>3660)throw new BadRequestException('Seleccioná un período de hasta 10 años');
    return transaction(async tx=>{
      const rows=(await tx.query(select+f.where,f.values)).rows;
      const valid=rows.filter(r=>!r.anulado),cancelled=rows.filter(r=>r.anulado);
      const sum=(items:any[])=>items.reduce((n,r)=>n+BigInt(r.monto_gs),0n);
      const total=sum(valid);
      const group=(key:string,name:string)=>{const groups=new Map<string,any>();for(const r of valid){const id=String(r[key]);const item=groups.get(id)||{id,nombre:r[name],total:0n,cantidad:0};item.total+=BigInt(r.monto_gs);item.cantidad++;groups.set(id,item);}return [...groups.values()].sort((a,b)=>a.total>b.total?-1:a.total<b.total?1:a.id.localeCompare(b.id)).map(({total:amount,...r})=>({...r,total_gs:amount.toString(),porcentaje:total?Number(amount*10000n/total)/100:0}));};
      const byDay=new Map<string,{total:bigint;cantidad:number}>();for(const r of valid){const d=byDay.get(r.fecha_gasto)||{total:0n,cantidad:0};d.total+=BigInt(r.monto_gs);d.cantidad++;byDay.set(r.fecha_gasto,d);}
      return {desde:f.desde,hasta:f.hasta,resumen:{total_gs:total.toString(),cantidad:valid.length,promedio_gs:(valid.length?total/BigInt(valid.length):0n).toString(),promedio_diario_gs:(total/BigInt(days)).toString(),efectivo_gs:sum(valid.filter(r=>r.es_efectivo)).toString(),no_efectivo_gs:sum(valid.filter(r=>!r.es_efectivo)).toString(),anulados:cancelled.length,anulados_gs:sum(cancelled).toString()},dias:Array.from({length:days},(_,i)=>{const fecha=new Date(Date.parse(f.desde!)+i*86400000).toISOString().slice(0,10);const d=byDay.get(fecha);return {fecha,total_gs:(d?.total??0n).toString(),cantidad:d?.cantidad??0};}),tipos:group('fk_idgasto_tipo','tipo_nombre'),formas_pago:group('fk_idforma_pago','forma_pago_nombre'),mayores:valid.sort((a,b)=>BigInt(a.monto_gs)>BigInt(b.monto_gs)?-1:BigInt(a.monto_gs)<BigInt(b.monto_gs)?1:0).slice(0,10)};
    });
  }
  @Get('gastos') async list(@Query() q:any){const f=filters(q);return paginateList(select+f.where,f.values,q.pagina??'1','idgasto');}
  @Get('gastos/:id') async detail(@Param('id') id:string){return one((await query(select+' WHERE g.idgasto=$1 AND g.activo',[positiveInt(id,'gasto')])).rows,'Gasto');}
  @Post('gastos') async create(@Body() b:any,@Req() req:any){
    const fecha=date(b.fecha_gasto),description=required(b.descripcion,'Descripción');
    if(fecha>hotelDate())throw new BadRequestException('La fecha del gasto no puede ser futura');
    const amount=String(b.monto_gs??'');if(!/^\d+$/.test(amount)||BigInt(amount)<=0n||BigInt(amount)>9223372036854775807n)throw new BadRequestException('El monto debe ser un entero positivo en guaraníes');
    const type=positiveInt(b.fk_idgasto_tipo,'tipo'),method=positiveInt(b.fk_idforma_pago,'forma de pago');
    return transaction(async tx=>{
      const cash=(await tx.query('SELECT idcaja FROM caja WHERE activo AND cerrada_en IS NULL FOR UPDATE')).rows[0];if(!cash)throw new BadRequestException('Abrí una caja antes de registrar el gasto');
      if(!(await tx.query('SELECT 1 FROM gasto_tipo WHERE idgasto_tipo=$1 AND activo FOR SHARE',[type])).rowCount)throw new BadRequestException('El tipo de gasto no existe o está inactivo');
      if(!(await tx.query('SELECT 1 FROM forma_pago WHERE idforma_pago=$1 AND activo FOR SHARE',[method])).rowCount)throw new BadRequestException('La forma de pago no existe o está inactiva');
      const row=(await tx.query('INSERT INTO gasto(fk_idgasto_tipo,fecha_gasto,descripcion,monto_gs,fk_idforma_pago,fk_idcaja,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *,fecha_gasto::text AS fecha_gasto',[type,fecha,description,amount,method,cash.idcaja,req.user.nombre])).rows[0];await audit(tx,req.user,'crear','gasto',row.idgasto,row);return row;
    });
  }
  @Post('gastos/:id/anular') async annul(@Param('id') id:string,@Body() b:any,@Req() req:any){
    const motive=required(b.motivo,'Motivo de anulación');
    return transaction(async tx=>{
      const original=await this.detail(id);await tx.query('SELECT idcaja FROM caja WHERE idcaja=$1 FOR UPDATE',[original.fk_idcaja]);
      const current=one((await tx.query('SELECT * FROM gasto WHERE idgasto=$1 FOR UPDATE',[id])).rows,'Gasto');if(current.anulado)return current;
      const row=(await tx.query('UPDATE gasto SET anulado=TRUE,fecha_anulado=now(),anulado_por=$2,motivo_anulacion=$3 WHERE idgasto=$1 RETURNING *',[id,req.user.nombre,motive])).rows[0];
      await audit(tx,req.user,'anular','gasto',id,{motivo:motive,fk_idcaja:current.fk_idcaja});
      const detail=(await tx.query('SELECT idcaja_detalle FROM caja_detalle WHERE fk_idgasto=$1',[id])).rows[0];await audit(tx,req.user,'anular','caja_detalle',detail.idcaja_detalle,{motivo:motive,fk_idgasto:id});return row;
    });
  }
}
