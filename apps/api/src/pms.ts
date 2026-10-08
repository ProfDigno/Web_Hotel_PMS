import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query as Q, Req, Res, UseGuards } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { pool, query, transaction } from './db';
import { Actor, AuthGuard, Roles } from './auth';
import { paginateList } from './pagination';
import { allowed, assertDateRange, dbError, hotelDate, isoDate, nonNegativeGs, one, positiveInt, required, timeHHMM } from './common';
import { createCheckoutTicket } from './checkout-ticket';
import { countCash, createCashCloseTicket, type CashCloseSummary } from './cash-close';
import { roomAnalysis } from './room-analysis';

const actor = (req: any) => req.user as Actor;
const nights = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const dateText = (value: unknown) => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
const audit = async (entity: string, id: unknown, action: string, user: Actor, detail?: unknown) => {
  await query('INSERT INTO auditoria(fk_idusuario,accion,entidad,identificador,detalle,creado_por) VALUES($1,$2,$3,$4,$5,$6)', [user.idusuario,action,entity,String(id),detail ? JSON.stringify(detail) : null,user.nombre]);
};

@Controller('api') @UseGuards(AuthGuard)
export class PmsController {
  @Get('hotel') async hotel() { return (await query('SELECT * FROM hotel WHERE activo ORDER BY idhotel LIMIT 1')).rows[0] || null; }
  @Put('hotel') @Roles('administracion') async saveHotel(@Body() b: any, @Req() req: any) {
    const u = actor(req), nombre = required(b.nombre,'nombre');
    const cols = ['nombre','ruc','razon_social','direccion','telefono','establecimiento','punto_expedicion','timbrado','actividad_economica','departamento_codigo','distrito_codigo','ciudad_codigo','email'];
    const vals = cols.map(c => c === 'nombre' ? nombre : (b[c] || null));
    const existing = (await query('SELECT idhotel FROM hotel WHERE activo LIMIT 1')).rows[0];
    const row = existing ? (await query(`UPDATE hotel SET ${cols.map((c,i)=>`${c}=$${i+1}`).join(',')} WHERE idhotel=$14 RETURNING *`, [...vals,existing.idhotel])).rows[0]
      : (await query(`INSERT INTO hotel(${cols.join(',')},creado_por) VALUES(${cols.map((_,i)=>`$${i+1}`).join(',')},$14) RETURNING *`, [...vals,u.nombre])).rows[0];
    await audit('hotel',row.idhotel,'guardar',u); return row;
  }

  @Get('usuarios') @Roles('administracion') async users() { return (await query('SELECT idusuario,nombre,email,rol,activo,fecha_creado,creado_por FROM usuario ORDER BY nombre')).rows; }
  @Post('usuarios') @Roles('administracion') async createUser(@Body() b: any, @Req() req: any) {
    const u=actor(req), rol=allowed(b.rol,['administracion','recepcion','caja','limpieza'] as const,'rol');
    const password=required(b.password,'contraseña'); if(password.length<10) throw new BadRequestException('La contraseña debe tener al menos 10 caracteres');
    const row=(await query('INSERT INTO usuario(nombre,email,clave_hash,rol,creado_por) VALUES($1,$2,$3,$4,$5) RETURNING idusuario,nombre,email,rol,activo', [required(b.nombre,'nombre'),required(b.email,'email').toLowerCase(),await bcrypt.hash(password,12),rol,u.nombre])).rows[0];
    await audit('usuario',row.idusuario,'crear',u); return row;
  }
  @Patch('usuarios/:id') @Roles('administracion') async userState(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req); if(String(id)===String(u.idusuario) && b.activo===false) throw new BadRequestException('No podés desactivar tu propio usuario');
    const row=one((await query('UPDATE usuario SET activo=$1 WHERE idusuario=$2 RETURNING idusuario,nombre,email,rol,activo',[Boolean(b.activo),id])).rows,'Usuario');
    await audit('usuario',id,'cambiar_estado',u,{activo:row.activo}); return row;
  }

  @Get('tipos-habitacion') async roomTypes() { return (await query('SELECT * FROM tipo_habitacion WHERE activo ORDER BY nombre')).rows; }
  @Get('formas-pago') @Roles('administracion','caja') async paymentMethods() {
    return (await query('SELECT * FROM forma_pago WHERE activo ORDER BY nombre')).rows;
  }
  @Get('formas-pago/admin') @Roles('administracion') async paymentMethodsAdmin() {
    return (await query('SELECT f.*,(EXISTS(SELECT 1 FROM pago p WHERE p.fk_idforma_pago=f.idforma_pago) OR EXISTS(SELECT 1 FROM gasto g WHERE g.fk_idforma_pago=f.idforma_pago) OR EXISTS(SELECT 1 FROM compra_pago cp WHERE cp.fk_idforma_pago=f.idforma_pago)) AS utilizada FROM forma_pago f ORDER BY f.nombre')).rows;
  }
  @Post('formas-pago') @Roles('administracion') async createPaymentMethod(@Body() b:any,@Req() req:any) {
    const u=actor(req),nombre=required(b.nombre,'nombre');
    if(b.es_efectivo!==undefined&&typeof b.es_efectivo!=='boolean')throw new BadRequestException('Cuenta como efectivo debe ser booleano');
    if(b.activo!==undefined&&typeof b.activo!=='boolean')throw new BadRequestException('Activo debe ser booleano');
    if(b.descripcion!==undefined&&b.descripcion!==null&&typeof b.descripcion!=='string')throw new BadRequestException('Descripción debe ser texto');
    try { return await transaction(async tx=>{
      const row=(await tx.query('INSERT INTO forma_pago(nombre,descripcion,es_efectivo,activo,creado_por) VALUES($1,$2,$3,$4,$5) RETURNING *',[nombre,b.descripcion?.trim()||null,b.es_efectivo??false,b.activo??true,u.nombre])).rows[0];
      await tx.query('INSERT INTO auditoria(fk_idusuario,accion,entidad,identificador,detalle,creado_por) VALUES($1,$2,$3,$4,$5,$6)',[u.idusuario,'crear','forma_pago',row.idforma_pago,JSON.stringify(row),u.nombre]);
      return row;
    }); } catch(e){dbError(e);}
  }
  @Patch('formas-pago/:id') @Roles('administracion') async updatePaymentMethod(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req),methodId=positiveInt(id,'forma de pago');
    if(b.es_efectivo!==undefined&&typeof b.es_efectivo!=='boolean')throw new BadRequestException('Cuenta como efectivo debe ser booleano');
    if(b.activo!==undefined&&typeof b.activo!=='boolean')throw new BadRequestException('Activo debe ser booleano');
    if(b.descripcion!==undefined&&b.descripcion!==null&&typeof b.descripcion!=='string')throw new BadRequestException('Descripción debe ser texto');
    const name=b.nombre===undefined?undefined:required(b.nombre,'nombre');
    try { return await transaction(async tx=>{
      const previous=one((await tx.query('SELECT * FROM forma_pago WHERE idforma_pago=$1 FOR UPDATE',[methodId])).rows,'Forma de pago');
      const utilizada=Boolean((await tx.query('SELECT 1 FROM pago WHERE fk_idforma_pago=$1 UNION ALL SELECT 1 FROM gasto WHERE fk_idforma_pago=$1 UNION ALL SELECT 1 FROM compra_pago WHERE fk_idforma_pago=$1 LIMIT 1',[methodId])).rowCount);
      if(utilizada&&b.es_efectivo!==undefined&&b.es_efectivo!==previous.es_efectivo)throw new BadRequestException('No se puede cambiar la clasificación de una forma de pago utilizada');
      const row=(await tx.query('UPDATE forma_pago SET nombre=$1,descripcion=$2,es_efectivo=$3,activo=$4 WHERE idforma_pago=$5 RETURNING *',[name??previous.nombre,b.descripcion===undefined?previous.descripcion:(b.descripcion?.trim()||null),b.es_efectivo??previous.es_efectivo,b.activo??previous.activo,methodId])).rows[0];
      await tx.query('INSERT INTO auditoria(fk_idusuario,accion,entidad,identificador,detalle,creado_por) VALUES($1,$2,$3,$4,$5,$6)',[u.idusuario,'editar','forma_pago',id,JSON.stringify({antes:previous,despues:row}),u.nombre]);
      return {...row,utilizada};
    }); } catch(e){dbError(e);}
  }
  @Get('tipos-habitacion/admin') @Roles('administracion') async roomTypesAdmin() { return (await query('SELECT * FROM tipo_habitacion ORDER BY activo DESC,nombre')).rows; }
  @Post('tipos-habitacion') @Roles('administracion') async createRoomType(@Body() b:any,@Req() req:any) {
    const u=actor(req), row=(await query('INSERT INTO tipo_habitacion(nombre,capacidad,descripcion,creado_por) VALUES($1,$2,$3,$4) RETURNING *',[required(b.nombre,'nombre'),positiveInt(b.capacidad,'capacidad'),b.descripcion||null,u.nombre])).rows[0];
    await audit('tipo_habitacion',row.idtipo_habitacion,'crear',u); return row;
  }
  @Patch('tipos-habitacion/:id') @Roles('administracion') async updateRoomType(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req), current=one((await query('SELECT * FROM tipo_habitacion WHERE idtipo_habitacion=$1',[id])).rows,'Tipo de habitación');
    const nombre=required(b.nombre ?? current.nombre,'nombre'), capacidad=positiveInt(b.capacidad ?? current.capacidad,'capacidad');
    if(b.activo !== undefined && typeof b.activo !== 'boolean') throw new BadRequestException('activo debe ser booleano');
    const row=one((await query('UPDATE tipo_habitacion SET nombre=$1,capacidad=$2,descripcion=$3,activo=$4 WHERE idtipo_habitacion=$5 RETURNING *',[nombre,capacidad,b.descripcion===undefined?current.descripcion:(b.descripcion||null),b.activo===undefined?current.activo:b.activo,id])).rows,'Tipo de habitación');
    await audit('tipo_habitacion',id,'editar',u,{activo:row.activo}); return row;
  }
  @Delete('tipos-habitacion/:id') @Roles('administracion') async deleteRoomType(@Param('id') id:string,@Req() req:any) {
    const u=actor(req), row=one((await query('UPDATE tipo_habitacion SET activo=false WHERE idtipo_habitacion=$1 AND activo RETURNING *',[id])).rows,'Tipo de habitación');
    await audit('tipo_habitacion',id,'desactivar',u); return row;
  }
  @Get('pisos') @Roles('administracion','recepcion') async floors() { return (await query('SELECT * FROM piso WHERE activo ORDER BY numero,nombre')).rows; }
  @Get('pisos/admin') @Roles('administracion') async floorsAdmin() { return (await query('SELECT * FROM piso ORDER BY activo DESC,numero,nombre')).rows; }
  @Post('pisos') @Roles('administracion') async createFloor(@Body() b:any,@Req() req:any) {
    const u=actor(req), numero=positiveInt(b.numero,'número'), nombre=required(b.nombre,'nombre');
    const row=one((await query('INSERT INTO piso(numero,nombre,creado_por) VALUES($1,$2,$3) RETURNING *',[numero,nombre,u.nombre])).rows,'Piso');
    await audit('piso',row.idpiso,'crear',u); return row;
  }
  @Patch('pisos/:id') @Roles('administracion') async updateFloor(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req), current=one((await query('SELECT * FROM piso WHERE idpiso=$1',[id])).rows,'Piso');
    const numero=positiveInt(b.numero ?? current.numero,'número'), nombre=required(b.nombre ?? current.nombre,'nombre');
    if(b.activo !== undefined && typeof b.activo !== 'boolean') throw new BadRequestException('activo debe ser booleano');
    const row=one((await query('UPDATE piso SET numero=$1,nombre=$2,activo=$3 WHERE idpiso=$4 RETURNING *',[numero,nombre,b.activo===undefined?current.activo:b.activo,id])).rows,'Piso');
    await audit('piso',id,'editar',u,{activo:row.activo}); return row;
  }
  @Get('habitaciones') async rooms() { return (await query(`SELECT h.*,t.nombre AS tipo,t.capacidad,p.idpiso,p.numero AS piso_numero,p.nombre AS piso_nombre,tar.nombre AS tarifa,tar.monto_gs AS tarifa_monto_gs,
    to_char(tar.hora_checkout,'HH24:MI') AS hora_checkout,
    estadia.idreserva IS NOT NULL AS en_casa,estadia.idreserva AS fk_idreserva_actual,estadia.cliente_nombre,estadia.cliente_apellido,estadia.fecha_salida
    FROM habitacion h JOIN tipo_habitacion t ON t.idtipo_habitacion=h.fk_idtipo_habitacion JOIN piso p ON p.idpiso=h.fk_idpiso
    LEFT JOIN tarifa tar ON tar.idtarifa=h.fk_idtarifa
    LEFT JOIN LATERAL (SELECT r.idreserva,c.nombre AS cliente_nombre,c.apellido AS cliente_apellido,rh.fecha_salida::text AS fecha_salida
      FROM reserva_habitacion rh JOIN reserva r ON r.idreserva=rh.fk_idreserva JOIN cliente c ON c.idcliente=r.fk_idcliente
      WHERE rh.fk_idhabitacion=h.idhabitacion AND rh.activo AND rh.estado='en_casa' AND r.activo AND r.estado='en_casa'
      ORDER BY rh.fecha_creado DESC,rh.idreserva_habitacion DESC LIMIT 1) estadia ON TRUE
    WHERE h.activo ORDER BY h.numero`)).rows; }
  @Get('habitaciones/admin') @Roles('administracion') async roomsAdmin() { return (await query('SELECT h.*,t.nombre AS tipo,t.capacidad,p.idpiso,p.numero AS piso_numero,p.nombre AS piso_nombre,tar.idtarifa,tar.nombre AS tarifa,tar.monto_gs AS tarifa_monto_gs FROM habitacion h JOIN tipo_habitacion t ON t.idtipo_habitacion=h.fk_idtipo_habitacion JOIN piso p ON p.idpiso=h.fk_idpiso LEFT JOIN tarifa tar ON tar.idtarifa=h.fk_idtarifa ORDER BY h.activo DESC,h.numero')).rows; }
  @Get('habitaciones/analisis') @Roles('administracion','recepcion') async roomsAnalysis(@Q('desde') desde:string,@Q('hasta') hasta:string) {
    const start=isoDate(desde,'desde'),end=isoDate(hasta,'hasta');
    if(end<start) throw new BadRequestException('La fecha hasta debe ser posterior o igual a la fecha desde');
    return roomAnalysis(start,end,hotelDate());
  }
  @Post('habitaciones') @Roles('administracion') async createRoom(@Body() b:any,@Req() req:any) {
    const u=actor(req), piso=positiveInt(b.fk_idpiso,'piso'), tipo=positiveInt(b.fk_idtipo_habitacion,'tipo');
    if(b.activo !== undefined && typeof b.activo !== 'boolean') throw new BadRequestException('activo debe ser booleano');
    one((await query('SELECT idpiso FROM piso WHERE idpiso=$1 AND activo',[piso])).rows,'Piso activo');
    one((await query('SELECT idtipo_habitacion FROM tipo_habitacion WHERE idtipo_habitacion=$1 AND activo',[tipo])).rows,'Tipo de habitación activo');
    const tarifa=positiveInt(b.fk_idtarifa,'tarifa');
    one((await query('SELECT idtarifa FROM tarifa WHERE idtarifa=$1 AND activo AND fk_idtipo_habitacion=$2',[tarifa,tipo])).rows,'Tarifa activa compatible');
    const row=(await query('INSERT INTO habitacion(numero,fk_idpiso,fk_idtipo_habitacion,fk_idtarifa,activo,creado_por) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[required(b.numero,'número'),piso,tipo,tarifa,b.activo===undefined?true:Boolean(b.activo),u.nombre])).rows[0];
    await audit('habitacion',row.idhabitacion,'crear',u); return row;
  }
  @Patch('habitaciones/:id') @Roles('administracion','recepcion','limpieza') async updateRoom(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req), current=one((await query('SELECT * FROM habitacion WHERE idhabitacion=$1',[id])).rows,'Habitación');
    if(b.fuera_servicio!==undefined && u.rol!=='administracion') throw new BadRequestException('Solo Administración puede cambiar el estado de servicio');
    if(u.rol==='administracion' && (b.numero!==undefined || b.fk_idpiso!==undefined || b.fk_idtipo_habitacion!==undefined || b.fk_idtarifa!==undefined || b.activo!==undefined || b.fuera_servicio!==undefined)) {
      const numero=required(b.numero ?? current.numero,'número'), piso=positiveInt(b.fk_idpiso ?? current.fk_idpiso,'piso'), tipo=positiveInt(b.fk_idtipo_habitacion ?? current.fk_idtipo_habitacion,'tipo'), tarifa=positiveInt(b.fk_idtarifa ?? current.fk_idtarifa,'tarifa');
      one((await query('SELECT idpiso FROM piso WHERE idpiso=$1 AND activo',[piso])).rows,'Piso activo');
      one((await query('SELECT idtipo_habitacion FROM tipo_habitacion WHERE idtipo_habitacion=$1 AND activo',[tipo])).rows,'Tipo de habitación activo');
      one((await query('SELECT idtarifa FROM tarifa WHERE idtarifa=$1 AND activo AND fk_idtipo_habitacion=$2',[tarifa,tipo])).rows,'Tarifa activa compatible');
      if(b.activo !== undefined && typeof b.activo !== 'boolean') throw new BadRequestException('activo debe ser booleano');
      if(b.fuera_servicio !== undefined && typeof b.fuera_servicio !== 'boolean') throw new BadRequestException('fuera_servicio debe ser booleano');
      const row=one((await query('UPDATE habitacion SET numero=$1,fk_idpiso=$2,fk_idtipo_habitacion=$3,fk_idtarifa=$4,activo=$5,fuera_servicio=$6 WHERE idhabitacion=$7 RETURNING *',[numero,piso,tipo,tarifa,b.activo===undefined?current.activo:b.activo,b.fuera_servicio===undefined?current.fuera_servicio:b.fuera_servicio,id])).rows,'Habitación');
      await audit('habitacion',id,'editar',u,{activo:row.activo,fuera_servicio:row.fuera_servicio}); return row;
    }
    const estado=allowed(b.estado_limpieza,['limpia','sucia','en_limpieza','inspeccion'] as const,'estado');
    const row=one((await query('UPDATE habitacion SET estado_limpieza=$1 WHERE idhabitacion=$2 AND activo RETURNING *',[estado,id])).rows,'Habitación');
    await audit('habitacion',id,'estado_limpieza',u,{estado}); return row;
  }
  @Get('tarifas') @Roles('administracion','recepcion') async rates() { return (await query('SELECT t.*,th.nombre AS tipo FROM tarifa t JOIN tipo_habitacion th ON th.idtipo_habitacion=t.fk_idtipo_habitacion WHERE t.activo AND th.activo ORDER BY t.nombre')).rows; }
  @Get('tarifas/admin') @Roles('administracion') async ratesAdmin() { return (await query('SELECT t.*,th.nombre AS tipo FROM tarifa t JOIN tipo_habitacion th ON th.idtipo_habitacion=t.fk_idtipo_habitacion ORDER BY t.activo DESC,t.nombre')).rows; }
  @Post('tarifas') @Roles('administracion') async createRate(@Body() b:any,@Req() req:any) {
    const u=actor(req), checkin=timeHHMM(b.hora_checkin ?? '14:00','hora_checkin'), checkout=timeHHMM(b.hora_checkout ?? '12:00','hora_checkout');
    one((await query('SELECT idtipo_habitacion FROM tipo_habitacion WHERE idtipo_habitacion=$1 AND activo',[positiveInt(b.fk_idtipo_habitacion,'tipo')])).rows,'Tipo de habitación activo');
    const row=one((await query('INSERT INTO tarifa(nombre,fk_idtipo_habitacion,fecha_inicio,fecha_fin,hora_checkin,hora_checkout,monto_gs,iva_tasa,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[required(b.nombre,'nombre'),positiveInt(b.fk_idtipo_habitacion,'tipo'),'1900-01-01','2999-12-31',checkin,checkout,nonNegativeGs(b.monto_gs),allowed(Number(b.iva_tasa ?? 10),[0,5,10] as const,'IVA'),u.nombre])).rows,'Tarifa');
    await audit('tarifa',row.idtarifa,'crear',u); return row;
  }
  @Patch('tarifas/:id') @Roles('administracion') async updateRate(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req), current=one((await query('SELECT * FROM tarifa WHERE idtarifa=$1',[id])).rows,'Tarifa');
    const nombre=required(b.nombre ?? current.nombre,'nombre');
    const tipo=positiveInt(b.fk_idtipo_habitacion ?? current.fk_idtipo_habitacion,'tipo');
    one((await query('SELECT idtipo_habitacion FROM tipo_habitacion WHERE idtipo_habitacion=$1 AND activo',[tipo])).rows,'Tipo de habitación activo');
    const checkin=timeHHMM(b.hora_checkin ?? String(current.hora_checkin).slice(0,5),'hora_checkin'), checkout=timeHHMM(b.hora_checkout ?? String(current.hora_checkout).slice(0,5),'hora_checkout');
    const monto=nonNegativeGs(b.monto_gs ?? current.monto_gs), iva=allowed(Number(b.iva_tasa ?? current.iva_tasa),[0,5,10] as const,'IVA');
    if(b.activo !== undefined && typeof b.activo !== 'boolean') throw new BadRequestException('activo debe ser booleano');
    const row=one((await query('UPDATE tarifa SET nombre=$1,fk_idtipo_habitacion=$2,hora_checkin=$3,hora_checkout=$4,monto_gs=$5,iva_tasa=$6,activo=$7 WHERE idtarifa=$8 RETURNING *',[nombre,tipo,checkin,checkout,monto,iva,b.activo===undefined?current.activo:b.activo,id])).rows,'Tarifa');
    await audit('tarifa',id,'editar',u,{activo:row.activo}); return row;
  }

  @Get('clientes') @Roles('administracion','recepcion','caja') async clients(@Q('q') q?:string,@Q('pagina') pagina?:string):Promise<any> {
    const sql='SELECT * FROM cliente WHERE activo AND ($1::text IS NULL OR nombre ILIKE $1 OR apellido ILIKE $1 OR documento ILIKE $1 OR ruc ILIKE $1)';
    const params=[q ? `%${q}%` : null];
    if(pagina!==undefined)return paginateList(sql,params,pagina,'idcliente');
    return (await query(sql+' ORDER BY idcliente DESC LIMIT 200',params)).rows;
  }
  @Get('clientes/:id/reservas') @Roles('administracion','recepcion','caja') async clientReservations(@Param('id') id:string,@Q('pagina') pagina?:string) {
    const clientId=positiveInt(id,'huésped'),page=pagina===undefined?1:positiveInt(pagina,'página'),pageSize=20;
    if(pagina!==undefined&&(typeof pagina!=='string'||!/^\d+$/.test(pagina)))throw new BadRequestException('Página debe ser un entero positivo');
    const offset=(page-1)*pageSize;
    if(!Number.isSafeInteger(offset))throw new BadRequestException('Página fuera de rango');
    one((await query('SELECT idcliente FROM cliente WHERE idcliente=$1 AND activo',[clientId])).rows,'Huésped');
    const result=(await query(`WITH historial AS (
      SELECT idreserva,fecha_entrada::text AS fecha_entrada,fecha_salida::text AS fecha_salida,estado
      FROM reserva WHERE fk_idcliente=$1 AND activo
    ), seleccion AS (
      SELECT * FROM historial ORDER BY idreserva DESC LIMIT $2 OFFSET $3
    ), pagina_reservas AS (
      SELECT r.*,COALESCE((SELECT string_agg(DISTINCT h.numero,', ' ORDER BY h.numero)
        FROM reserva_habitacion rh JOIN habitacion h ON h.idhabitacion=rh.fk_idhabitacion
        WHERE rh.fk_idreserva=r.idreserva AND rh.activo),'') AS habitaciones
      FROM seleccion r
    )
    SELECT (SELECT count(*)::int FROM historial) AS total,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('idreserva',p.idreserva::text,'fecha_entrada',p.fecha_entrada,
        'fecha_salida',p.fecha_salida,'estado',p.estado,'habitaciones',p.habitaciones) ORDER BY p.idreserva DESC)
        FROM pagina_reservas p),'[]'::jsonb) AS reservas`,
      [clientId,pageSize,offset])).rows[0];
    return {...result,pagina:page,por_pagina:pageSize};
  }
  @Post('clientes') @Roles('administracion','recepcion') async createClient(@Body() b:any,@Req() req:any) {
    const u=actor(req), row=(await query('INSERT INTO cliente(nombre,apellido,tipo_documento,documento,ruc,email,telefono,direccion,pais,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[required(b.nombre,'nombre'),b.apellido||null,b.tipo_documento||null,b.documento||null,b.ruc||null,b.email||null,b.telefono||null,b.direccion||null,b.pais||'Paraguay',u.nombre])).rows[0];
    await audit('cliente',row.idcliente,'crear',u); return row;
  }
  @Put('clientes/:id') @Roles('administracion','recepcion') async updateClient(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req), row=one((await query('UPDATE cliente SET nombre=$1,apellido=$2,tipo_documento=$3,documento=$4,ruc=$5,email=$6,telefono=$7,direccion=$8,pais=$9 WHERE idcliente=$10 AND activo RETURNING *',[required(b.nombre,'nombre'),b.apellido||null,b.tipo_documento||null,b.documento||null,b.ruc||null,b.email||null,b.telefono||null,b.direccion||null,b.pais||'Paraguay',id])).rows,'Cliente');
    await audit('cliente',id,'editar',u); return row;
  }

  @Get('disponibilidad') @Roles('administracion','recepcion') async availability(@Q('desde') desde:string,@Q('hasta') hasta:string) {
    const start=isoDate(desde,'desde'),end=isoDate(hasta,'hasta'); assertDateRange(start,end);
    return (await query(`SELECT h.*,t.nombre AS tipo,p.numero AS piso_numero,p.nombre AS piso_nombre FROM habitacion h JOIN tipo_habitacion t ON t.idtipo_habitacion=h.fk_idtipo_habitacion JOIN piso p ON p.idpiso=h.fk_idpiso
      WHERE h.activo AND NOT h.fuera_servicio AND NOT EXISTS (SELECT 1 FROM reserva_habitacion rh WHERE rh.fk_idhabitacion=h.idhabitacion AND rh.activo AND rh.estado IN ('confirmada','en_casa') AND daterange(rh.fecha_entrada,rh.fecha_salida,'[)') && daterange($1::date,$2::date,'[)')) ORDER BY h.numero`,[start,end])).rows;
  }
  @Get('calendario') @Roles('administracion','recepcion') async calendar(@Q('desde') desde:string,@Q('hasta') hasta:string) {
    const start=isoDate(desde,'desde'),end=isoDate(hasta,'hasta'); assertDateRange(start,end);
    return (await query(`SELECT rh.idreserva_habitacion,rh.fk_idhabitacion,rh.fk_idreserva,rh.fecha_entrada::text,rh.fecha_salida::text,rh.estado,r.estado AS estado_reserva,c.nombre,c.apellido,h.numero,p.numero AS piso_numero,p.nombre AS piso_nombre
      FROM reserva_habitacion rh JOIN reserva r ON r.idreserva=rh.fk_idreserva JOIN cliente c ON c.idcliente=r.fk_idcliente JOIN habitacion h ON h.idhabitacion=rh.fk_idhabitacion JOIN piso p ON p.idpiso=h.fk_idpiso
      WHERE rh.activo AND rh.estado <> 'cancelada' AND rh.fecha_entrada < $2::date AND rh.fecha_salida > $1::date ORDER BY h.numero,rh.fecha_entrada`,[start,end])).rows;
  }
  @Get('reservas') @Roles('administracion','recepcion','caja') async reservations(@Q('estado') estado?:string,@Q('q') q?:string,@Q('pagina') pagina?:string):Promise<any> {
    const search=q?.trim()||null;
    const sql=`SELECT r.*,r.fecha_entrada::text AS fecha_entrada,r.fecha_salida::text AS fecha_salida,c.nombre AS cliente_nombre,c.apellido AS cliente_apellido,
      COALESCE(string_agg(DISTINCT h.numero,', '),'') AS habitaciones,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('en_casa',true,'fecha_salida',actual.fecha_salida::text,
        'hora_checkout',to_char(tar_actual.hora_checkout,'HH24:MI')))
        FROM reserva_habitacion actual JOIN habitacion hab_actual ON hab_actual.idhabitacion=actual.fk_idhabitacion
        LEFT JOIN tarifa tar_actual ON tar_actual.idtarifa=hab_actual.fk_idtarifa
        WHERE actual.fk_idreserva=r.idreserva AND actual.activo AND actual.estado='en_casa' AND r.estado='en_casa'),'[]'::jsonb) AS checkouts,
      COALESCE((SELECT SUM(CASE WHEN m.tipo='descuento' THEN -m.cantidad*m.monto_unitario_gs ELSE m.cantidad*m.monto_unitario_gs END) FROM movimiento m WHERE m.fk_idreserva=r.idreserva AND m.activo AND NOT m.anulado),0)
      - COALESCE((SELECT SUM(CASE WHEN p.clase='devolucion' THEN -p.monto_gs ELSE p.monto_gs END) FROM pago p WHERE p.fk_idreserva=r.idreserva AND p.activo AND NOT p.anulado),0) AS saldo_gs
      FROM reserva r JOIN cliente c ON c.idcliente=r.fk_idcliente
      LEFT JOIN reserva_habitacion rh ON rh.fk_idreserva=r.idreserva AND rh.activo LEFT JOIN habitacion h ON h.idhabitacion=rh.fk_idhabitacion
      WHERE r.activo AND ($1::text IS NULL OR r.estado=$1)
      AND ($2::text IS NULL OR concat_ws(' ',c.nombre,c.apellido) ILIKE '%' || $2 || '%'
        OR c.documento ILIKE '%' || $2 || '%' OR c.ruc ILIKE '%' || $2 || '%'
        OR r.idreserva::text=regexp_replace($2,'^#','')
        OR EXISTS(SELECT 1 FROM reserva_habitacion busqueda JOIN habitacion hb ON hb.idhabitacion=busqueda.fk_idhabitacion
          WHERE busqueda.fk_idreserva=r.idreserva AND busqueda.activo AND hb.numero ILIKE '%' || $2 || '%'))
      GROUP BY r.idreserva,c.idcliente`;
    const params=[estado||null,search];
    if(pagina!==undefined)return paginateList(sql,params,pagina,'idreserva');
    return (await query(sql+' ORDER BY r.idreserva DESC LIMIT 300',params)).rows;
  }
  @Get('reservas/:id') @Roles('administracion','recepcion','caja','limpieza') async reservation(@Param('id') id:string,@Req() req:any) {
    if(actor(req).rol==='limpieza') {
      const r=one((await query(`SELECT r.idreserva,r.fecha_entrada::text,r.fecha_salida::text,r.estado,c.nombre AS cliente_nombre,c.apellido AS cliente_apellido
        FROM reserva r JOIN cliente c ON c.idcliente=r.fk_idcliente WHERE r.idreserva=$1 AND r.activo`,[id])).rows,'Reserva');
      const rooms=(await query(`SELECT rh.idreserva_habitacion,rh.fk_idhabitacion,rh.fecha_entrada::text,rh.fecha_salida::text,rh.estado,h.numero
        FROM reserva_habitacion rh JOIN habitacion h ON h.idhabitacion=rh.fk_idhabitacion WHERE rh.fk_idreserva=$1 AND rh.activo ORDER BY h.numero`,[id])).rows;
      return {...r,habitaciones:rooms};
    }
    const r=one((await query(`SELECT r.*,r.fecha_entrada::text AS fecha_entrada,r.fecha_salida::text AS fecha_salida,c.nombre AS cliente_nombre,c.apellido AS cliente_apellido FROM reserva r JOIN cliente c ON c.idcliente=r.fk_idcliente WHERE r.idreserva=$1 AND r.activo`,[id])).rows,'Reserva');
    const [rooms,charges,payments,invoices]=await Promise.all([
      query('SELECT rh.*,rh.fecha_entrada::text AS fecha_entrada,rh.fecha_salida::text AS fecha_salida,h.numero FROM reserva_habitacion rh JOIN habitacion h ON h.idhabitacion=rh.fk_idhabitacion WHERE rh.fk_idreserva=$1 AND rh.activo',[id]),
      query('SELECT * FROM movimiento WHERE fk_idreserva=$1 AND activo ORDER BY idmovimiento',[id]),
      query('SELECT p.*,f.nombre AS forma_pago_nombre FROM pago p JOIN forma_pago f ON f.idforma_pago=p.fk_idforma_pago WHERE p.fk_idreserva=$1 AND p.activo ORDER BY p.idpago',[id]),
      query('SELECT iddocumento_electronico,tipo,estado,cdc,numero,total_gs,codigo_respuesta,mensaje_respuesta,fecha_creado FROM documento_electronico WHERE fk_idreserva=$1 AND activo ORDER BY iddocumento_electronico',[id])]);
    const debit=charges.rows.filter(x=>!x.anulado).reduce((a,x)=>a+(x.tipo==='descuento'?-1n:1n)*BigInt(x.cantidad)*BigInt(x.monto_unitario_gs),0n);
    const paid=payments.rows.filter(x=>!x.anulado).reduce((a,x)=>a+(x.clase==='devolucion'?-1n:1n)*BigInt(x.monto_gs),0n);
    return {...r,habitaciones:rooms.rows,cargos:charges.rows,pagos:payments.rows,facturas:invoices.rows,total_gs:debit.toString(),pagado_gs:paid.toString(),saldo_gs:(debit-paid).toString()};
  }
  @Post('reservas') @Roles('administracion','recepcion') async createReservation(@Body() b:any,@Req() req:any) {
    const u=actor(req),start=isoDate(b.fecha_entrada,'fecha_entrada'),end=isoDate(b.fecha_salida,'fecha_salida'); assertDateRange(start,end);
    if(!Array.isArray(b.habitaciones)||!b.habitaciones.length) throw new BadRequestException('Seleccioná al menos una habitación');
    try {
      const row=await transaction(async tx=>{
        const r=(await tx.query('INSERT INTO reserva(fk_idcliente,fecha_entrada,fecha_salida,adultos,ninos,origen,observaciones,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[positiveInt(b.fk_idcliente,'cliente'),start,end,positiveInt(b.adultos||1,'adultos'),Number(b.ninos||0),b.origen||'directa',b.observaciones||null,u.nombre])).rows[0];
        for(const item of b.habitaciones){
          const id=positiveInt(item.fk_idhabitacion,'habitación'), rate=nonNegativeGs(item.tarifa_noche_gs,'tarifa_noche_gs');
          const room=one((await tx.query('SELECT * FROM habitacion WHERE idhabitacion=$1 AND activo AND NOT fuera_servicio',[id])).rows,'Habitación disponible');
          const configuredRate=(await tx.query('SELECT iva_tasa FROM tarifa WHERE fk_idtipo_habitacion=$1 AND activo ORDER BY idtarifa DESC LIMIT 1',[room.fk_idtipo_habitacion])).rows[0];
          await tx.query('INSERT INTO reserva_habitacion(fk_idreserva,fk_idhabitacion,fecha_entrada,fecha_salida,tarifa_noche_gs,creado_por) VALUES($1,$2,$3,$4,$5,$6)',[r.idreserva,id,start,end,rate,u.nombre]);
          await tx.query('INSERT INTO movimiento(fk_idreserva,tipo,descripcion,cantidad,monto_unitario_gs,iva_tasa,fecha_servicio,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[r.idreserva,'alojamiento',`Alojamiento habitación ${room.numero}`,nights(start,end),rate,allowed(Number(item.iva_tasa ?? configuredRate?.iva_tasa ?? 10),[0,5,10] as const,'IVA'),start,u.nombre]);
        }
        return r;
      }); await audit('reserva',row.idreserva,'crear',u); return row;
    } catch(e) { dbError(e); }
  }
  @Post('reservas/:id/check-in') @Roles('administracion','recepcion') async checkin(@Param('id') id:string,@Req() req:any) {
    const u=actor(req);
    const r=await transaction(async tx=>{
      const row=one((await tx.query('SELECT * FROM reserva WHERE idreserva=$1 AND activo FOR UPDATE',[id])).rows,'Reserva');
      if(row.estado!=='confirmada') throw new BadRequestException('La reserva no está confirmada');
      if(hotelDate()<dateText(row.fecha_entrada)||hotelDate()>=dateText(row.fecha_salida)) throw new BadRequestException('El check-in debe realizarse dentro de las fechas de la reserva');
      const rooms=(await tx.query('SELECT h.numero,h.estado_limpieza,h.fuera_servicio FROM reserva_habitacion rh JOIN habitacion h ON h.idhabitacion=rh.fk_idhabitacion WHERE rh.fk_idreserva=$1 AND rh.activo',[id])).rows;
      if(rooms.some(h=>h.estado_limpieza!=='limpia'||h.fuera_servicio)) throw new BadRequestException('Todas las habitaciones deben estar limpias y disponibles');
      await tx.query("UPDATE reserva_habitacion SET estado='en_casa' WHERE fk_idreserva=$1 AND activo",[id]);
      return (await tx.query("UPDATE reserva SET estado='en_casa',fecha_checkin=clock_timestamp() WHERE idreserva=$1 RETURNING *",[id])).rows[0];
    }); await audit('reserva',id,'check_in',u); return r;
  }
  @Post('reservas/:id/check-out') @Roles('administracion','recepcion') async checkout(@Param('id') id:string,@Req() req:any) {
    const u=actor(req);
    const r=await transaction(async tx=>{
      const row=one((await tx.query('SELECT r.*,c.nombre AS cliente_nombre,c.apellido AS cliente_apellido FROM reserva r JOIN cliente c ON c.idcliente=r.fk_idcliente WHERE r.idreserva=$1 AND r.activo FOR UPDATE OF r',[id])).rows,'Reserva');
      if(row.estado!=='en_casa') throw new BadRequestException('La reserva no está en casa');
      const roomsResult=await tx.query("SELECT rh.fk_idhabitacion,rh.fecha_entrada::text AS fecha_entrada,rh.fecha_salida::text AS fecha_salida,rh.tarifa_noche_gs,rh.estado,h.numero FROM reserva_habitacion rh JOIN habitacion h ON h.idhabitacion=rh.fk_idhabitacion WHERE rh.fk_idreserva=$1 AND rh.activo ORDER BY rh.idreserva_habitacion",[id]);
      const chargesResult=await tx.query('SELECT tipo,descripcion,cantidad,monto_unitario_gs FROM movimiento WHERE fk_idreserva=$1 AND activo AND NOT anulado ORDER BY idmovimiento',[id]);
      const paymentsResult=await tx.query('SELECT p.clase,p.monto_gs,f.nombre AS forma_pago_nombre FROM pago p JOIN forma_pago f ON f.idforma_pago=p.fk_idforma_pago WHERE p.fk_idreserva=$1 AND p.activo AND NOT p.anulado ORDER BY p.idpago',[id]);
      const hotelResult=await tx.query('SELECT nombre,direccion,telefono FROM hotel WHERE activo ORDER BY idhotel LIMIT 1');
      const rooms=roomsResult.rows.filter(room=>room.estado==='en_casa');
      const total=chargesResult.rows.reduce((sum,item)=>sum+(item.tipo==='descuento'?-1n:1n)*BigInt(item.cantidad)*BigInt(item.monto_unitario_gs),0n);
      const paid=paymentsResult.rows.reduce((sum,payment)=>sum+(payment.clase==='devolucion'?-1n:1n)*BigInt(payment.monto_gs),0n);
      if(total!==paid) throw new BadRequestException('La cuenta debe tener saldo cero antes del check-out');
      const checkoutAt=(await tx.query('SELECT clock_timestamp() AS fecha_checkout')).rows[0].fecha_checkout.toISOString();
      const summary={version:1,idreserva:String(row.idreserva),cliente_nombre:row.cliente_nombre,cliente_apellido:row.cliente_apellido,
        fecha_entrada:dateText(row.fecha_entrada),fecha_salida:dateText(row.fecha_salida),fecha_checkout:checkoutAt,registrado_por:u.nombre,
        hotel:hotelResult.rows[0]||null,
        habitaciones:roomsResult.rows.map(room=>({numero:room.numero,fecha_entrada:room.fecha_entrada,fecha_salida:room.fecha_salida,tarifa_noche_gs:String(room.tarifa_noche_gs)})),
        cargos:chargesResult.rows.map(item=>({tipo:item.tipo,descripcion:item.descripcion,cantidad:item.cantidad,monto_unitario_gs:String(item.monto_unitario_gs),importe_gs:((item.tipo==='descuento'?-1n:1n)*BigInt(item.cantidad)*BigInt(item.monto_unitario_gs)).toString()})),
        pagos:paymentsResult.rows.map(payment=>({clase:payment.clase,forma_pago_nombre:payment.forma_pago_nombre,monto_gs:String(payment.monto_gs)})),
        total_gs:total.toString(),pagado_gs:paid.toString(),saldo_gs:'0'};
      await tx.query("UPDATE reserva_habitacion SET estado='finalizada' WHERE fk_idreserva=$1 AND activo AND estado='en_casa'",[id]);
      for(const room of rooms){
        await tx.query("UPDATE habitacion SET estado_limpieza='sucia' WHERE idhabitacion=$1",[room.fk_idhabitacion]);
        await tx.query("INSERT INTO tarea_limpieza(fk_idhabitacion,creado_por) VALUES($1,$2)",[room.fk_idhabitacion,u.nombre]);
      }
      return (await tx.query("UPDATE reserva SET estado='finalizada',fecha_checkout=$2,checkout_resumen=$3::jsonb WHERE idreserva=$1 RETURNING *",[id,checkoutAt,JSON.stringify(summary)])).rows[0];
    }); await audit('reserva',id,'check_out',u); return r;
  }
  @Get('reservas/:id/check-out/ticket') @Roles('administracion','recepcion','caja') async checkoutTicket(@Param('id') id:string,@Res() res:any) {
    const summary=one((await query("SELECT checkout_resumen FROM reserva WHERE idreserva=$1 AND activo AND estado='finalizada' AND checkout_resumen IS NOT NULL",[positiveInt(id,'reserva')])).rows,'Ticket de check-out').checkout_resumen;
    const pdf=createCheckoutTicket(summary);
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`inline; filename="reserva-${id}-check-out.pdf"`);
    pdf.pipe(res);
  }
  @Post('reservas/:id/cambiar-habitacion') @Roles('administracion','recepcion') async transferRoom(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req),todayLocal=hotelDate(),fromId=positiveInt(b.fk_idreserva_habitacion,'asignación'),toId=positiveInt(b.fk_idhabitacion,'nueva habitación'),rate=nonNegativeGs(b.tarifa_noche_gs,'tarifa');
    try {
      const result=await transaction(async tx=>{
        const reservation=one((await tx.query('SELECT * FROM reserva WHERE idreserva=$1 AND activo FOR UPDATE',[id])).rows,'Reserva');
        if(reservation.estado!=='en_casa') throw new BadRequestException('El cambio requiere una estadía en curso');
        if((await tx.query('SELECT 1 FROM documento_electronico WHERE fk_idreserva=$1 AND activo LIMIT 1',[id])).rowCount) throw new BadRequestException('No se puede cambiar de habitación después de preparar la factura');
        const old=one((await tx.query("SELECT rh.*,h.numero FROM reserva_habitacion rh JOIN habitacion h ON h.idhabitacion=rh.fk_idhabitacion WHERE rh.idreserva_habitacion=$1 AND rh.fk_idreserva=$2 AND rh.estado='en_casa' FOR UPDATE",[fromId,id])).rows,'Asignación activa');
        const start=dateText(reservation.fecha_entrada),end=dateText(reservation.fecha_salida);
        if(todayLocal>=end) throw new BadRequestException('La estadía ya llegó a su fecha de salida');
        const next=one((await tx.query("SELECT * FROM habitacion WHERE idhabitacion=$1 AND activo AND NOT fuera_servicio AND estado_limpieza='limpia'",[toId])).rows,'Nueva habitación limpia');
        if(String(old.fk_idhabitacion)===String(toId)) throw new BadRequestException('Elegí otra habitación');
        if(todayLocal>dateText(old.fecha_entrada)) await tx.query("UPDATE reserva_habitacion SET fecha_salida=$1,estado='finalizada' WHERE idreserva_habitacion=$2",[todayLocal,fromId]);
        else await tx.query("UPDATE reserva_habitacion SET estado='finalizada' WHERE idreserva_habitacion=$1",[fromId]);
        await tx.query('INSERT INTO reserva_habitacion(fk_idreserva,fk_idhabitacion,fecha_entrada,fecha_salida,tarifa_noche_gs,estado,creado_por) VALUES($1,$2,$3,$4,$5,\'en_casa\',$6)',[id,toId,todayLocal,end,rate,u.nombre]);
        const oldStart=dateText(old.fecha_entrada);
        await tx.query("UPDATE movimiento SET anulado=true WHERE fk_idreserva=$1 AND tipo='alojamiento' AND descripcion=$2 AND fecha_servicio=$3 AND NOT anulado",[id,`Alojamiento habitación ${old.numero}`,oldStart]);
        if(todayLocal>oldStart) await tx.query("INSERT INTO movimiento(fk_idreserva,tipo,descripcion,cantidad,monto_unitario_gs,fecha_servicio,creado_por) VALUES($1,'alojamiento',$2,$3,$4,$5,$6)",[id,`Alojamiento habitación ${old.numero}`,nights(oldStart,todayLocal),old.tarifa_noche_gs,oldStart,u.nombre]);
        await tx.query("INSERT INTO movimiento(fk_idreserva,tipo,descripcion,cantidad,monto_unitario_gs,fecha_servicio,creado_por) VALUES($1,'alojamiento',$2,$3,$4,$5,$6)",[id,`Alojamiento habitación ${next.numero}`,nights(todayLocal,end),rate,todayLocal,u.nombre]);
        await tx.query("UPDATE habitacion SET estado_limpieza='sucia' WHERE idhabitacion=$1",[old.fk_idhabitacion]);
        await tx.query('INSERT INTO tarea_limpieza(fk_idhabitacion,creado_por) VALUES($1,$2)',[old.fk_idhabitacion,u.nombre]);
        return {habitacion_anterior:old.numero,habitacion_nueva:next.numero};
      }); await audit('reserva',id,'cambiar_habitacion',u,result); return result;
    } catch(e){dbError(e);}
  }
  @Post('reservas/:id/cancelar') @Roles('administracion','recepcion') async cancel(@Param('id') id:string,@Req() req:any) {
    const u=actor(req);
    const r=await transaction(async tx=>{
      const row=one((await tx.query('SELECT * FROM reserva WHERE idreserva=$1 AND activo FOR UPDATE',[id])).rows,'Reserva');
      if(row.estado!=='confirmada') throw new BadRequestException('Solo se puede cancelar una reserva confirmada');
      await tx.query("UPDATE reserva_habitacion SET estado='cancelada' WHERE fk_idreserva=$1 AND activo",[id]);
      await tx.query("UPDATE movimiento SET anulado=true WHERE fk_idreserva=$1 AND tipo='alojamiento' AND activo",[id]);
      return (await tx.query("UPDATE reserva SET estado='cancelada' WHERE idreserva=$1 RETURNING *",[id])).rows[0];
    }); await audit('reserva',id,'cancelar',u); return r;
  }
  @Post('reservas/:id/cargos') @Roles('administracion','recepcion','caja') async charge(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req), tipo=allowed(b.tipo,['extra','ajuste','descuento'] as const,'tipo');
    const row=await transaction(async tx=>{
      const reservation=one((await tx.query('SELECT estado FROM reserva WHERE idreserva=$1 AND activo FOR UPDATE',[id])).rows,'Reserva');
      if(!['confirmada','en_casa'].includes(reservation.estado)) throw new BadRequestException('La estadía no admite nuevos cargos');
      if((await tx.query('SELECT 1 FROM documento_electronico WHERE fk_idreserva=$1 AND activo LIMIT 1',[id])).rowCount) throw new BadRequestException('La cuenta ya tiene un documento fiscal preparado');
      return (await tx.query('INSERT INTO movimiento(fk_idreserva,tipo,descripcion,cantidad,monto_unitario_gs,iva_tasa,fecha_servicio,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id,tipo,required(b.descripcion,'descripción'),positiveInt(b.cantidad||1,'cantidad'),nonNegativeGs(b.monto_unitario_gs),allowed(Number(b.iva_tasa ?? 10),[0,5,10] as const,'IVA'),isoDate(b.fecha_servicio||hotelDate(),'fecha_servicio'),u.nombre])).rows[0];
    });
    await audit('movimiento',row.idmovimiento,'crear',u); return row;
  }
  @Post('reservas/:id/pagos') @Roles('administracion','caja') async payment(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req);
    const forma=positiveInt(b.fk_idforma_pago,'forma de pago');
    const monto=nonNegativeGs(b.monto_gs); if(monto==='0') throw new BadRequestException('El pago debe ser mayor a cero');
    const splitProvided=b.monto_alojamiento_gs!==undefined||b.monto_otros_gs!==undefined;
    const alojamientoExplicit=splitProvided?nonNegativeGs(b.monto_alojamiento_gs,'alojamiento'):null;
    const otrosExplicit=splitProvided?nonNegativeGs(b.monto_otros_gs,'otros cargos'):null;
    const solicitudId=b.solicitud_id;
    if(solicitudId!==undefined&&(typeof solicitudId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(solicitudId))) throw new BadRequestException('Identificador de pago inválido');
    if(splitProvided&&BigInt(alojamientoExplicit!)+BigInt(otrosExplicit!)!==BigInt(monto)) throw new BadRequestException('Alojamiento y otros cargos deben sumar el monto del pago');
    return transaction(async tx=>{
      const caja=one((await tx.query('SELECT idcaja FROM caja WHERE cerrada_en IS NULL AND activo FOR UPDATE')).rows,'Caja abierta');
      const reservation=one((await tx.query('SELECT idreserva,estado FROM reserva WHERE idreserva=$1 AND activo FOR UPDATE',[positiveInt(id,'reserva')])).rows,'Reserva');
      if(reservation.estado==='cancelada') throw new BadRequestException('No se pueden registrar pagos en una reserva cancelada');
      if(solicitudId&&(await tx.query('SELECT 1 FROM pago WHERE fk_idreserva=$1 AND solicitud_id=$2',[id,solicitudId])).rowCount) throw new BadRequestException('Este pago ya fue registrado');
      const charges=(await tx.query("SELECT COALESCE(SUM(CASE WHEN tipo='descuento' THEN -cantidad*monto_unitario_gs ELSE cantidad*monto_unitario_gs END),0)::text AS total, COALESCE(SUM(CASE WHEN tipo='alojamiento' THEN cantidad*monto_unitario_gs ELSE 0 END),0)::text AS alojamiento FROM movimiento WHERE fk_idreserva=$1 AND activo AND NOT anulado",[id])).rows[0];
      const payments=(await tx.query("SELECT COALESCE(SUM(CASE WHEN clase='devolucion' THEN -monto_gs ELSE monto_gs END),0)::text AS total, COALESCE(SUM(CASE WHEN clase='devolucion' THEN -monto_alojamiento_gs ELSE monto_alojamiento_gs END),0)::text AS alojamiento FROM pago WHERE fk_idreserva=$1 AND activo AND NOT anulado",[id])).rows[0];
      const saldo=BigInt(charges.total)-BigInt(payments.total);
      if(saldo<=0n) throw new BadRequestException('La reserva no tiene saldo pendiente para registrar otro pago');
      if(BigInt(monto)>saldo) throw new BadRequestException(`El pago supera el saldo pendiente de ₲ ${saldo.toLocaleString('es-PY')}`);
      const alojamientoPendiente=BigInt(charges.alojamiento)-BigInt(payments.alojamiento);
      const alojamiento=alojamientoExplicit??(alojamientoPendiente>0n?(alojamientoPendiente<BigInt(monto)?alojamientoPendiente:BigInt(monto)).toString():'0');
      one((await tx.query('SELECT idforma_pago FROM forma_pago WHERE idforma_pago=$1 AND activo FOR SHARE',[forma])).rows,'Forma de pago activa');
      const row=(await tx.query('INSERT INTO pago(fk_idreserva,fk_idcaja,fk_idforma_pago,monto_gs,monto_alojamiento_gs,referencia,solicitud_id,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id,caja.idcaja,forma,monto,alojamiento,b.referencia||null,solicitudId||null,u.nombre])).rows[0];
      await tx.query('INSERT INTO auditoria(fk_idusuario,accion,entidad,identificador,creado_por) VALUES($1,$2,$3,$4,$5)',[u.idusuario,'crear','pago',String(row.idpago),u.nombre]);
      return row;
    });
  }

  @Post('pagos/:id/anular') @Roles('administracion','caja') async annulPayment(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req),motivo=required(b.motivo,'motivo de anulación');
    return transaction(async tx=>{
      const original=one((await tx.query('SELECT * FROM pago WHERE idpago=$1 AND activo',[positiveInt(id,'pago')])).rows,'Pago');
      if(original.fk_idcaja) await tx.query('SELECT idcaja FROM caja WHERE idcaja=$1 FOR UPDATE',[original.fk_idcaja]);
      const pago=one((await tx.query('SELECT * FROM pago WHERE idpago=$1 AND activo FOR UPDATE',[id])).rows,'Pago');
      if(pago.anulado) return pago;
      if(pago.fk_idventa) throw new BadRequestException('Los pagos de ventas se corrigen anulando la venta');
      const row=(await tx.query('UPDATE pago SET anulado=TRUE,fecha_anulado=now(),anulado_por=$2,motivo_anulacion=$3 WHERE idpago=$1 RETURNING *',[id,u.nombre,motivo])).rows[0];
      await tx.query('INSERT INTO auditoria(fk_idusuario,accion,entidad,identificador,detalle,creado_por) VALUES($1,$2,$3,$4,$5,$6)',[u.idusuario,'anular','pago',id,JSON.stringify({motivo,fk_idcaja:pago.fk_idcaja}),u.nombre]);
      if(pago.fk_idcaja){
        const detail=one((await tx.query('SELECT idcaja_detalle FROM caja_detalle WHERE fk_idpago=$1',[id])).rows,'Detalle de caja');
        await tx.query('INSERT INTO auditoria(fk_idusuario,accion,entidad,identificador,detalle,creado_por) VALUES($1,$2,$3,$4,$5,$6)',[u.idusuario,'anular','caja_detalle',String(detail.idcaja_detalle),JSON.stringify({motivo,fk_idpago:id}),u.nombre]);
      }
      return row;
    });
  }

  @Get('cajas') @Roles('administracion','caja') async cashHistory(@Q('estado') estado?:string) {
    if(estado!==undefined) allowed(estado,['abierta','cerrada'] as const,'estado');
    return (await query(`SELECT idcaja,abierta_en,cerrada_en,monto_inicial_gs,monto_cierre_gs,(cierre_comprobante IS NOT NULL) AS tiene_ticket FROM caja
      WHERE activo AND ($1::text IS NULL OR ($1='abierta' AND cerrada_en IS NULL) OR ($1='cerrada' AND cerrada_en IS NOT NULL))
      ORDER BY CASE WHEN $1='cerrada' THEN cerrada_en ELSE abierta_en END DESC,idcaja DESC`,[estado??null])).rows;
  }
  @Get('cajas/:id/ticket') @Roles('administracion','caja') async cashTicket(@Param('id') id:string,@Res() res:any) {
    const summary=one((await query('SELECT cierre_comprobante FROM caja WHERE idcaja=$1 AND activo AND cerrada_en IS NOT NULL AND cierre_comprobante IS NOT NULL',[positiveInt(id,'caja')])).rows,'Ticket de cierre de caja').cierre_comprobante as CashCloseSummary;
    const pdf=createCashCloseTicket(summary);
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`inline; filename="caja-${id}-cierre.pdf"`);
    pdf.pipe(res);
  }
  @Get('cajas/:id/detalle') @Roles('administracion','caja') async cashDetails(@Param('id') id:string) {
    const c=one((await query('SELECT *,caja_totales(idcaja) AS resumen FROM caja WHERE idcaja=$1 AND activo',[positiveInt(id,'caja')])).rows,'Caja');
    const movimientos=(await query(`SELECT d.*,f.nombre AS forma_pago_nombre,p.fk_idreserva,p.fk_idventa,c.nombre AS cliente_nombre,c.apellido AS cliente_apellido,pr.razon_social AS proveedor_nombre,
      CASE WHEN d.fk_idgasto IS NOT NULL OR d.fk_idcompra IS NOT NULL THEN '—' ELSE COALESCE(h.numeros,'Sin habitación') END AS habitaciones
      FROM caja_detalle d LEFT JOIN pago p ON p.idpago=d.fk_idpago
      JOIN forma_pago f ON f.idforma_pago=d.fk_idforma_pago
      LEFT JOIN compra co ON co.idcompra=d.fk_idcompra LEFT JOIN proveedor pr ON pr.idproveedor=co.fk_idproveedor
      LEFT JOIN reserva r ON r.idreserva=p.fk_idreserva LEFT JOIN cliente c ON c.idcliente=r.fk_idcliente
      LEFT JOIN LATERAL (SELECT string_agg(DISTINCT h.numero,', ' ORDER BY h.numero) AS numeros
        FROM reserva_habitacion rh JOIN habitacion h ON h.idhabitacion=rh.fk_idhabitacion WHERE rh.fk_idreserva=r.idreserva) h ON TRUE
      WHERE d.fk_idcaja=$1 ORDER BY d.fecha_movimiento DESC,d.idcaja_detalle DESC`,[id])).rows;
    return {...c,movimientos,ajuste_posterior_gs:c.cierre_totales?(BigInt(c.resumen.neto_gs)-BigInt(c.cierre_totales.neto_gs)).toString():null,
      efectivo_esperado_gs:(BigInt(c.monto_inicial_gs)+BigInt(c.resumen.efectivo_gs)).toString()};
  }

  @Get('caja') @Roles('administracion','caja') async cash() {
    const c=(await query('SELECT *,caja_totales(idcaja) AS resumen FROM caja WHERE cerrada_en IS NULL AND activo ORDER BY idcaja DESC LIMIT 1')).rows[0];
    if(!c) return null;
    const totals=(await query(`SELECT f.idforma_pago,f.nombre AS forma_pago_nombre,f.es_efectivo,
      COALESCE(SUM(CASE WHEN d.tipo='egreso' THEN -d.monto_gs ELSE d.monto_gs END),0)::text AS total_gs
      FROM caja_detalle d JOIN forma_pago f ON f.idforma_pago=d.fk_idforma_pago
      WHERE d.fk_idcaja=$1 AND d.activo AND NOT d.anulado GROUP BY f.idforma_pago ORDER BY f.nombre`,[c.idcaja])).rows;
    return {...c,totales:totals,efectivo_esperado_gs:(BigInt(c.monto_inicial_gs)+BigInt(c.resumen.efectivo_gs)).toString()};
  }
  @Post('caja/abrir') @Roles('administracion','caja') async openCash(@Body() b:any,@Req() req:any) {
    const u=actor(req); try { const row=(await query('INSERT INTO caja(fk_idusuario_apertura,monto_inicial_gs,creado_por) VALUES($1,$2,$3) RETURNING *',[u.idusuario,nonNegativeGs(b.monto_inicial_gs||'0'),u.nombre])).rows[0]; await audit('caja',row.idcaja,'abrir',u); return row; } catch(e){dbError(e);}
  }
  @Post('caja/cerrar') @Roles('administracion','caja') async closeCash(@Body() b:any,@Req() req:any) {
    const u=actor(req),{billetes,total}=countCash(b?.billetes);
    return transaction(async tx=>{
      const c=(await tx.query('SELECT * FROM caja WHERE cerrada_en IS NULL AND activo FOR UPDATE')).rows[0];
      if(!c) throw new BadRequestException('No existe una caja abierta para cerrar. Abrí una caja antes de registrar el cierre.');
      const totals=(await tx.query('SELECT caja_totales($1) AS resumen',[c.idcaja])).rows[0].resumen;
      const forms=(await tx.query(`SELECT f.nombre,f.es_efectivo,COALESCE(SUM(CASE WHEN d.tipo='egreso' THEN -d.monto_gs ELSE d.monto_gs END),0)::text AS total_gs
        FROM caja_detalle d JOIN forma_pago f ON f.idforma_pago=d.fk_idforma_pago
        WHERE d.fk_idcaja=$1 AND d.activo AND NOT d.anulado GROUP BY f.idforma_pago,f.nombre,f.es_efectivo ORDER BY f.nombre`,[c.idcaja])).rows;
      const hotel=(await tx.query('SELECT nombre,direccion,telefono FROM hotel WHERE activo ORDER BY idhotel LIMIT 1')).rows[0]||null;
      const closedAt=(await tx.query('SELECT clock_timestamp() AS fecha')).rows[0].fecha.toISOString();
      const expected=BigInt(c.monto_inicial_gs)+BigInt(totals.efectivo_gs);
      const summary:CashCloseSummary={version:1,idcaja:String(c.idcaja),abierta_en:c.abierta_en.toISOString(),cerrada_en:closedAt,registrado_por:u.nombre,
        hotel,monto_inicial_gs:String(c.monto_inicial_gs),billetes,monto_cierre_gs:total,efectivo_esperado_gs:expected.toString(),diferencia_gs:(BigInt(total)-expected).toString(),
        cierre_totales:totals,formas_pago:forms};
      const row=(await tx.query('UPDATE caja SET cerrada_en=$1,fk_idusuario_cierre=$2,monto_cierre_gs=$3,cierre_totales=$4::jsonb,cierre_reconstruido=FALSE,cierre_comprobante=$5::jsonb WHERE idcaja=$6 RETURNING *',
        [closedAt,u.idusuario,total,JSON.stringify(totals),JSON.stringify(summary),c.idcaja])).rows[0];
      await tx.query('INSERT INTO auditoria(fk_idusuario,accion,entidad,identificador,creado_por) VALUES($1,$2,$3,$4,$5)',[u.idusuario,'cerrar','caja',String(row.idcaja),u.nombre]);
      return row;
    });
  }

  @Get('limpieza') async housekeeping() { return (await query(`SELECT t.*,h.numero FROM tarea_limpieza t JOIN habitacion h ON h.idhabitacion=t.fk_idhabitacion WHERE t.activo AND t.estado<>'completada' ORDER BY CASE t.prioridad WHEN 'alta' THEN 0 ELSE 1 END,t.fecha_creado`)).rows; }
  @Post('limpieza') @Roles('administracion','recepcion','limpieza') async createTask(@Body() b:any,@Req() req:any) {
    const u=actor(req), row=(await query('INSERT INTO tarea_limpieza(fk_idhabitacion,fk_idusuario_asignado,prioridad,nota,creado_por) VALUES($1,$2,$3,$4,$5) RETURNING *',[positiveInt(b.fk_idhabitacion,'habitación'),b.fk_idusuario_asignado||null,b.prioridad||'normal',b.nota||null,u.nombre])).rows[0];
    await audit('tarea_limpieza',row.idtarea_limpieza,'crear',u); return row;
  }
  @Patch('limpieza/:id') @Roles('administracion','recepcion','limpieza') async updateTask(@Param('id') id:string,@Body() b:any,@Req() req:any) {
    const u=actor(req), state=allowed(b.estado,['pendiente','en_progreso','completada'] as const,'estado');
    const row=await transaction(async tx=>{
      const t=one((await tx.query('UPDATE tarea_limpieza SET estado=$1,completada_en=CASE WHEN $1=\'completada\' THEN now() ELSE NULL END WHERE idtarea_limpieza=$2 AND activo RETURNING *',[state,id])).rows,'Tarea');
      await tx.query('UPDATE habitacion SET estado_limpieza=$1 WHERE idhabitacion=$2',[state==='completada'?'limpia':'en_limpieza',t.fk_idhabitacion]);
      return t;
    }); await audit('tarea_limpieza',id,'estado',u,{estado:state}); return row;
  }

  @Get('tablero') @Roles('administracion','recepcion','caja') async dashboard() {
    const today=hotelDate();
    const [a,d,o,dirty,debt,pending]=await Promise.all([
      query("SELECT COUNT(*)::int AS n FROM reserva WHERE fecha_entrada=$1 AND estado='confirmada' AND activo",[today]),
      query("SELECT COUNT(*)::int AS n FROM reserva WHERE fecha_salida=$1 AND estado='en_casa' AND activo",[today]),
      query("SELECT COUNT(*)::int AS n FROM habitacion WHERE activo AND NOT fuera_servicio"),
      query("SELECT COUNT(*)::int AS n FROM habitacion WHERE activo AND estado_limpieza<>'limpia'"),
      query(`SELECT COALESCE(SUM(cargos-pagado),0)::text AS total FROM (SELECT r.idreserva,
        COALESCE((SELECT SUM(CASE WHEN m.tipo='descuento' THEN -1 ELSE 1 END*m.cantidad*m.monto_unitario_gs) FROM movimiento m WHERE m.fk_idreserva=r.idreserva AND m.activo AND NOT m.anulado),0) AS cargos,
        COALESCE((SELECT SUM(CASE WHEN p.clase='devolucion' THEN -p.monto_gs ELSE p.monto_gs END) FROM pago p WHERE p.fk_idreserva=r.idreserva AND p.activo AND NOT p.anulado),0) AS pagado FROM reserva r WHERE r.activo AND r.estado NOT IN ('cancelada','no_show')) x WHERE cargos>pagado`),
      query("SELECT COUNT(*)::int AS n FROM documento_electronico WHERE activo AND estado IN ('firmado','enviado','pendiente')")]);
    const occupied=(await query("SELECT COUNT(DISTINCT fk_idhabitacion)::int AS n FROM reserva_habitacion WHERE activo AND estado='en_casa'")).rows[0].n;
    return {fecha:today,llegadas:a.rows[0].n,salidas:d.rows[0].n,habitaciones:o.rows[0].n,ocupadas:occupied,pendientes_limpieza:dirty.rows[0].n,saldos_pendientes_gs:debt.rows[0].total,facturas_pendientes:pending.rows[0].n};
  }
  @Get('informes/ocupacion') @Roles('administracion','recepcion') async occupancy(@Q('desde') desde:string,@Q('hasta') hasta:string) {
    const start=isoDate(desde,'desde'),end=isoDate(hasta,'hasta'); assertDateRange(start,end);
    return (await query(`SELECT d::date::text AS fecha,COUNT(DISTINCT rh.fk_idhabitacion)::int AS ocupadas,
      (SELECT COUNT(*)::int FROM habitacion WHERE activo AND NOT fuera_servicio) AS disponibles
      FROM generate_series($1::date,$2::date - interval '1 day',interval '1 day') d
      LEFT JOIN reserva_habitacion rh ON rh.activo AND rh.estado IN ('confirmada','en_casa','finalizada') AND d::date>=rh.fecha_entrada AND d::date<rh.fecha_salida GROUP BY d ORDER BY d`,[start,end])).rows;
  }
}
