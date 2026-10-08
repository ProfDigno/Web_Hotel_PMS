import { query } from './db';

type AnalysisParams = [string,string,string];

export async function roomAnalysis(desde:string,hasta:string,today:string) {
  const params:AnalysisParams=[desde,hasta,today],range=[desde,hasta];
  const dailySql=`WITH dias AS (
      SELECT d::date AS fecha FROM generate_series($1::date,$2::date,interval '1 day') d
    ), inventario AS (
      SELECT d.fecha,h.idhabitacion,COALESCE(t.nombre,'Sin tipo') AS tipo,
        (estado.activo AND NOT estado.fuera_servicio) AS disponible
      FROM dias d CROSS JOIN habitacion h
      JOIN habitacion_disponibilidad_historial estado ON estado.id=COALESCE(
        (SELECT x.id FROM habitacion_disponibilidad_historial x WHERE x.fk_idhabitacion=h.idhabitacion
          AND x.vigente_desde <= ((d.fecha + time '14:00') AT TIME ZONE 'America/Asuncion')
          ORDER BY x.vigente_desde DESC,x.id DESC LIMIT 1),
        (SELECT x.id FROM habitacion_disponibilidad_historial x WHERE x.fk_idhabitacion=h.idhabitacion
          ORDER BY x.vigente_desde,x.id LIMIT 1))
      LEFT JOIN tipo_habitacion t ON t.idtipo_habitacion=estado.fk_idtipo_habitacion
      WHERE (h.fecha_creado AT TIME ZONE 'America/Asuncion')::date <= d.fecha
    ), noches AS (
      SELECT i.fecha,i.idhabitacion,i.tipo,i.disponible,
        COALESCE(x.realizada,false) AS realizada,COALESCE(x.prevista,false) AS prevista,
        COALESCE(x.ingreso_real_gs,0)::bigint AS ingreso_real_gs
      FROM inventario i LEFT JOIN LATERAL (
        SELECT bool_or(r.estado IN ('en_casa','finalizada') AND i.fecha <= $3::date
          AND i.fecha >= COALESCE((r.fecha_checkin AT TIME ZONE 'America/Asuncion')::date,rh.fecha_entrada)
          AND i.fecha < CASE WHEN rh.estado='en_casa' THEN GREATEST(rh.fecha_salida,$3::date + 1)
            WHEN r.fecha_checkout IS NOT NULL THEN LEAST(rh.fecha_salida,(r.fecha_checkout AT TIME ZONE 'America/Asuncion')::date)
            ELSE rh.fecha_salida END) AS realizada,
          bool_or(r.estado IN ('confirmada','en_casa') AND rh.estado IN ('confirmada','en_casa')
            AND i.fecha >= rh.fecha_entrada AND i.fecha < rh.fecha_salida) AS prevista,
          MAX(CASE WHEN r.estado IN ('en_casa','finalizada') AND i.fecha <= $3::date
            AND i.fecha >= COALESCE((r.fecha_checkin AT TIME ZONE 'America/Asuncion')::date,rh.fecha_entrada)
            AND i.fecha < CASE WHEN rh.estado='en_casa' THEN GREATEST(rh.fecha_salida,$3::date + 1)
              WHEN r.fecha_checkout IS NOT NULL THEN LEAST(rh.fecha_salida,(r.fecha_checkout AT TIME ZONE 'America/Asuncion')::date)
              ELSE rh.fecha_salida END
            AND i.fecha >= rh.fecha_entrada AND i.fecha < rh.fecha_salida
            THEN rh.tarifa_noche_gs ELSE 0 END) AS ingreso_real_gs
        FROM reserva_habitacion rh JOIN reserva r ON r.idreserva=rh.fk_idreserva
        WHERE rh.fk_idhabitacion=i.idhabitacion AND rh.activo AND r.activo
          AND rh.estado NOT IN ('cancelada','no_show') AND r.estado NOT IN ('cancelada','no_show')
          AND rh.fecha_entrada <= i.fecha
          AND (rh.fecha_salida > i.fecha OR r.estado IN ('en_casa','finalizada'))
      ) x ON true
    )
    SELECT fecha::text AS fecha,tipo,
      COUNT(*) FILTER (WHERE disponible)::int AS disponibles,
      COUNT(*) FILTER (WHERE disponible AND realizada)::int AS realizadas,
      COUNT(*) FILTER (WHERE disponible AND prevista)::int AS previstas,
      COALESCE(SUM(ingreso_real_gs) FILTER (WHERE disponible),0)::text AS ingreso_real_gs
    FROM noches GROUP BY fecha,tipo ORDER BY fecha,tipo`;
  const created=`r.activo AND r.fecha_creado >= ($1::date::timestamp AT TIME ZONE 'America/Asuncion')
    AND r.fecha_creado < (($2::date + 1)::timestamp AT TIME ZONE 'America/Asuncion')`;
  const arrivals=`r.activo AND r.estado NOT IN ('cancelada','no_show')
    AND r.fecha_entrada BETWEEN $1::date AND $2::date`;
  const lodgingPayments=`p.activo AND NOT p.anulado AND p.fk_idreserva IS NOT NULL AND p.fk_idventa IS NULL
    AND p.fecha_creado >= ($1::date::timestamp AT TIME ZONE 'America/Asuncion')
    AND p.fecha_creado < (($2::date + 1)::timestamp AT TIME ZONE 'America/Asuncion')`;
  const [nights,bookings,flows,origins,stays,guests,historyStart,missingCheckins,paymentDays,paymentMethods]=await Promise.all([
    query(dailySql,params),
    query(`WITH b AS (SELECT (r.fecha_creado AT TIME ZONE 'America/Asuncion')::date AS fecha,r.estado
      FROM reserva r WHERE ${created})
      SELECT d::date::text AS fecha,COUNT(b.estado)::int AS total,
        COUNT(*) FILTER (WHERE b.estado='confirmada')::int AS confirmadas,
        COUNT(*) FILTER (WHERE b.estado='en_casa')::int AS en_casa,
        COUNT(*) FILTER (WHERE b.estado='finalizada')::int AS finalizadas,
        COUNT(*) FILTER (WHERE b.estado='cancelada')::int AS canceladas,
        COUNT(*) FILTER (WHERE b.estado='no_show')::int AS no_show
      FROM generate_series($1::date,$2::date,interval '1 day') d
      LEFT JOIN b ON b.fecha=d::date GROUP BY d ORDER BY d`,range),
    query(`SELECT d::date::text AS fecha,
      COUNT(DISTINCT r.idreserva) FILTER (WHERE r.fecha_entrada=d::date)::int AS llegadas,
      COUNT(DISTINCT r.idreserva) FILTER (WHERE r.fecha_salida=d::date)::int AS salidas
      FROM generate_series($1::date,$2::date,interval '1 day') d
      LEFT JOIN reserva r ON r.activo AND r.estado NOT IN ('cancelada','no_show')
        AND (r.fecha_entrada=d::date OR r.fecha_salida=d::date)
      GROUP BY d ORDER BY d`,range),
    query(`SELECT COALESCE(NULLIF(BTRIM(r.origen),''),'Sin origen') AS nombre,
      COUNT(*)::int AS reservas FROM reserva r WHERE ${arrivals}
      GROUP BY 1 ORDER BY reservas DESC,nombre`,range),
    query(`SELECT CASE WHEN (r.fecha_salida-r.fecha_entrada)>=7 THEN '7+ noches'
        ELSE (r.fecha_salida-r.fecha_entrada)::text || CASE WHEN (r.fecha_salida-r.fecha_entrada)=1 THEN ' noche' ELSE ' noches' END END AS tramo,
      CASE WHEN (r.fecha_salida-r.fecha_entrada)>=7 THEN 7 ELSE (r.fecha_salida-r.fecha_entrada) END AS orden,
      COUNT(*)::int AS reservas FROM reserva r WHERE ${arrivals}
      GROUP BY 1,2 ORDER BY orden`,range),
    query(`SELECT COALESCE(SUM(r.adultos),0)::int AS adultos,COALESCE(SUM(r.ninos),0)::int AS ninos,
      COUNT(DISTINCT r.fk_idcliente)::int AS titulares,
      COUNT(*)::int AS reservas_llegada,
      COALESCE(SUM(r.fecha_salida-r.fecha_entrada),0)::int AS noches_estadia
      FROM reserva r WHERE ${arrivals}`,range),
    query("SELECT (MIN(vigente_desde) AT TIME ZONE 'America/Asuncion')::date::text AS fecha FROM habitacion_disponibilidad_historial"),
    query(`SELECT EXISTS(SELECT 1 FROM reserva r WHERE r.activo AND r.estado IN ('en_casa','finalizada')
      AND r.fecha_checkin IS NULL AND r.fecha_entrada<=$2::date AND r.fecha_salida>$1::date) AS estimated`,range),
    query(`WITH pagos AS (SELECT (p.fecha_creado AT TIME ZONE 'America/Asuncion')::date AS fecha,
        CASE WHEN p.clase='devolucion' THEN -p.monto_alojamiento_gs ELSE p.monto_alojamiento_gs END AS alojamiento_gs,
        CASE WHEN p.clase='devolucion' THEN -p.monto_gs ELSE p.monto_gs END AS sin_atribucion_gs
        FROM pago p WHERE ${lodgingPayments})
      SELECT d::date::text AS fecha,
        COALESCE(SUM(p.alojamiento_gs),0)::text AS cobrado_alojamiento_gs,
        COALESCE(SUM(p.sin_atribucion_gs) FILTER (WHERE p.alojamiento_gs IS NULL),0)::text AS sin_atribucion_gs,
        COUNT(*) FILTER (WHERE p.alojamiento_gs IS NULL AND p.fecha IS NOT NULL)::int AS pagos_sin_atribucion
      FROM generate_series($1::date,$2::date,interval '1 day') d
      LEFT JOIN pagos p ON p.fecha=d::date GROUP BY d ORDER BY d`,range),
    query(`SELECT f.idforma_pago::text AS idforma_pago,f.nombre,
      COALESCE(SUM(CASE WHEN p.clase='devolucion' THEN -p.monto_alojamiento_gs ELSE p.monto_alojamiento_gs END)
        FILTER (WHERE p.monto_alojamiento_gs IS NOT NULL),0)::text AS total_gs,
      COALESCE(SUM(CASE WHEN p.clase='devolucion' THEN -p.monto_gs ELSE p.monto_gs END)
        FILTER (WHERE p.monto_alojamiento_gs IS NULL),0)::text AS sin_atribucion_gs
      FROM pago p JOIN forma_pago f ON f.idforma_pago=p.fk_idforma_pago
      WHERE ${lodgingPayments}
      GROUP BY f.idforma_pago,f.nombre
      HAVING COALESCE(SUM(CASE WHEN p.clase='devolucion' THEN -p.monto_alojamiento_gs ELSE p.monto_alojamiento_gs END)
        FILTER (WHERE p.monto_alojamiento_gs IS NOT NULL),0)<>0
        OR COALESCE(SUM(CASE WHEN p.clase='devolucion' THEN -p.monto_gs ELSE p.monto_gs END)
        FILTER (WHERE p.monto_alojamiento_gs IS NULL),0)<>0
      ORDER BY (COALESCE(SUM(CASE WHEN p.clase='devolucion' THEN -p.monto_alojamiento_gs ELSE p.monto_alojamiento_gs END)
        FILTER (WHERE p.monto_alojamiento_gs IS NOT NULL),0)
        + COALESCE(SUM(CASE WHEN p.clase='devolucion' THEN -p.monto_gs ELSE p.monto_gs END)
        FILTER (WHERE p.monto_alojamiento_gs IS NULL),0)) DESC`,range)
  ]);
  const byDay=new Map<string,any>();
  const byType=new Map<string,any>();
  for(const row of nights.rows){
    const day=byDay.get(row.fecha)||{fecha:row.fecha,disponibles:0,realizadas:0,previstas:0,ingreso_real_gs:'0'};
    day.disponibles+=row.disponibles;day.realizadas+=row.realizadas;day.previstas+=row.previstas;
    day.ingreso_real_gs=(BigInt(day.ingreso_real_gs)+BigInt(row.ingreso_real_gs)).toString();byDay.set(row.fecha,day);
    const type=byType.get(row.tipo)||{nombre:row.tipo,disponibles:0,realizadas:0,previstas:0};
    type.disponibles+=row.disponibles;
    if(row.fecha<=today)type.realizadas+=row.realizadas;
    if(row.fecha>=today)type.previstas+=row.previstas;
    byType.set(row.tipo,type);
  }
  const days=bookings.rows.map(row=>{
    const occupancy=byDay.get(row.fecha)||{fecha:row.fecha,disponibles:0,realizadas:0,previstas:0,ingreso_real_gs:'0'};
    return {...occupancy,ocupacion_real_pct:row.fecha<=today?(occupancy.disponibles?Math.round(occupancy.realizadas/occupancy.disponibles*1000)/10:0):null,
      ocupacion_prevista_pct:row.fecha>=today?(occupancy.disponibles?Math.round(occupancy.previstas/occupancy.disponibles*1000)/10:0):null};
  });
  const past=days.filter(d=>d.fecha<=today),future=days.filter(d=>d.fecha>=today);
  const sum=(rows:any[],key:string)=>rows.reduce((n,row)=>n+Number(row[key]||0),0);
  const availableReal=sum(past,'disponibles'),real=sum(past,'realizadas'),availableForecast=sum(future,'disponibles'),forecast=sum(future,'previstas');
  const income=past.reduce((n,row)=>n+BigInt(row.ingreso_real_gs),0n);
  const lodgingCollected=paymentDays.rows.reduce((n,row)=>n+BigInt(row.cobrado_alojamiento_gs),0n);
  const unattributed=paymentDays.rows.reduce((n,row)=>n+BigInt(row.sin_atribucion_gs),0n);
  const unattributedCount=paymentDays.rows.reduce((n,row)=>n+row.pagos_sin_atribucion,0);
  const bookingsTotal=sum(bookings.rows,'total'),canceled=sum(bookings.rows,'canceladas');
  const guest=guests.rows[0];
  return {desde,hasta,fecha_hoy:today,historico_estimado:(!!historyStart.rows[0].fecha&&desde<historyStart.rows[0].fecha)||missingCheckins.rows[0].estimated,
    resumen:{ocupacion_real_pct:availableReal?Math.round(real/availableReal*1000)/10:0,
      ocupacion_prevista_pct:availableForecast?Math.round(forecast/availableForecast*1000)/10:0,
      noches_realizadas:real,noches_previstas:forecast,noches_disponibles:availableReal,
      adr_estimado_gs:real?(income/BigInt(real)).toString():'0',
      revpar_estimado_gs:availableReal?(income/BigInt(availableReal)).toString():'0',
      cobrado_alojamiento_gs:lodgingCollected.toString(),sin_atribucion_gs:unattributed.toString(),pagos_sin_atribucion:unattributedCount,
      reservas_creadas:bookingsTotal,tasa_cancelacion_pct:bookingsTotal?Math.round(canceled/bookingsTotal*1000)/10:0,
      estadia_promedio_noches:guest.reservas_llegada?Math.round(guest.noches_estadia/guest.reservas_llegada*10)/10:0,
      adultos:guest.adultos,ninos:guest.ninos,titulares:guest.titulares},
    dias:days,reservas:bookings.rows,llegadas_salidas:flows.rows,
    tipos:[...byType.values()].sort((a,b)=>b.realizadas+b.previstas-a.realizadas-a.previstas),
    origenes:origins.rows,estadias:stays.rows,
    cobros_diarios:paymentDays.rows,formas_pago_alojamiento:paymentMethods.rows};
}
