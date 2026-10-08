import { useEffect, useMemo, useState } from 'react';
import { Area, Bar, BarChart, Brush, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, gs, today } from './api';
import './sales-analytics.css';
import './room-analytics.css';

type Day={fecha:string;disponibles:number;realizadas:number;previstas:number;ingreso_real_gs:string;ocupacion_real_pct:number|null;ocupacion_prevista_pct:number|null};
type Booking={fecha:string;total:number;confirmadas:number;en_casa:number;finalizadas:number;canceladas:number;no_show:number};
type PaymentDay={fecha:string;cobrado_alojamiento_gs:string;sin_atribucion_gs:string;pagos_sin_atribucion:number};
type Analysis={desde:string;hasta:string;fecha_hoy:string;historico_estimado:boolean;
  resumen:{ocupacion_real_pct:number;ocupacion_prevista_pct:number;noches_realizadas:number;noches_previstas:number;noches_disponibles:number;adr_estimado_gs:string;revpar_estimado_gs:string;cobrado_alojamiento_gs:string;sin_atribucion_gs:string;pagos_sin_atribucion:number;reservas_creadas:number;tasa_cancelacion_pct:number;estadia_promedio_noches:number;adultos:number;ninos:number;titulares:number};
  dias:Day[];reservas:Booking[];llegadas_salidas:{fecha:string;llegadas:number;salidas:number}[];
  tipos:{nombre:string;disponibles:number;realizadas:number;previstas:number}[];
  origenes:{nombre:string;reservas:number}[];estadias:{tramo:string;orden:number;reservas:number}[];
  cobros_diarios:PaymentDay[];formas_pago_alojamiento:{idforma_pago:string;nombre:string;total_gs:string;sin_atribucion_gs:string}[]};
const colors=['#315849','#b97550','#839b87','#d8a668','#8d7470','#557b9b'];
const dateLabel=(date:string)=>`${date.slice(8,10)}/${date.slice(5,7)}`;
const tooltipStyle={borderRadius:9,border:'1px solid #e1e7df',fontSize:12};
const pct=(value:number)=>`${value.toLocaleString('es-PY',{maximumFractionDigits:1})}%`;
const count=(value:number)=>value.toLocaleString('es-PY');

export function RoomAnalytics({refresh}:{refresh:number}) {
  const [from,setFrom]=useState(()=>`${today().slice(0,7)}-01`);
  const [to,setTo]=useState(today);
  const [data,setData]=useState<Analysis|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selectedDay,setSelectedDay]=useState<string|null>(null);
  const [selectedIncomeDay,setSelectedIncomeDay]=useState<string|null>(null);
  const valid=Boolean(from&&to&&to>=from);
  useEffect(()=>{
    if(!valid){setData(null);setLoading(false);return}
    let live=true;setLoading(true);setError('');setData(null);setSelectedDay(null);setSelectedIncomeDay(null);
    api<Analysis>(`/habitaciones/analisis?desde=${from}&hasta=${to}`).then(result=>{if(live){setData(result);setLoading(false)}})
      .catch(e=>{if(live){setError(e.message);setLoading(false)}});
    return()=>{live=false};
  },[from,to,refresh,valid]);
  const daily=useMemo(()=>data?.dias||[],[data]);
  const payments=useMemo(()=>data?.cobros_diarios.map(row=>({...row,total:Number(row.cobrado_alojamiento_gs),sin_atribucion:Number(row.sin_atribucion_gs)}))||[],[data]);
  const methods=useMemo(()=>data?.formas_pago_alojamiento.map(row=>({...row,total:Number(row.total_gs),sin_atribucion:Number(row.sin_atribucion_gs)})).reverse()||[],[data]);
  const bookingTotal=data?.resumen.reservas_creadas||0;
  const stayTotal=data?.resumen.noches_realizadas||0;
  const hasActivity=bookingTotal>0||stayTotal>0||Boolean(data?.resumen.noches_previstas)||Boolean(data?.resumen.titulares)||payments.some(day=>day.total!==0||day.sin_atribucion!==0);
  const hasPaymentActivity=payments.some(day=>day.total!==0||day.sin_atribucion!==0);
  return <div className="room-analytics sales-analytics">
    <div className="page-head"><div><span className="eyebrow">HABITACIONES · ANÁLISIS</span><h1>Análisis de habitaciones</h1><p>Ocupación, reservas y huéspedes del período.</p></div></div>
    <div className="card sales-analysis-filter"><div className="sales-analysis-filter-fields"><label className="field"><span>Fecha desde</span><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="field"><span>Fecha hasta</span><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div><span className="sales-analysis-period">{from&&to?`${from} → ${to}`:''}</span></div>
    {!valid&&<div className="form-error" role="alert">La fecha hasta debe ser igual o posterior a la fecha desde.</div>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    {loading&&<div className="card empty" aria-live="polite"><p>Cargando análisis de habitaciones…</p></div>}
    {!loading&&data&&<>
      {data.historico_estimado&&<div className="room-analysis-note">El histórico anterior a este análisis es estimado: no se registraban todos los cambios de disponibilidad ni la hora real de check-in.</div>}
      <div className="sales-kpi-grid room-kpi-grid">
        <div className="card sales-kpi"><span>Ocupación realizada</span><strong>{pct(data.resumen.ocupacion_real_pct)}</strong><small>Hasta hoy · {count(data.resumen.noches_realizadas)} noches</small></div>
        <div className="card sales-kpi"><span>Ocupación prevista</span><strong>{pct(data.resumen.ocupacion_prevista_pct)}</strong><small>Desde hoy · {count(data.resumen.noches_previstas)} noches</small></div>
        <div className="card sales-kpi"><span>Noches disponibles</span><strong>{count(data.resumen.noches_disponibles)}</strong><small>Período realizado</small></div>
        <div className="card sales-kpi"><span>ADR estimado</span><strong>{gs(data.resumen.adr_estimado_gs)}</strong><small>Tarifa de alojamiento / noche realizada</small></div>
        <div className="card sales-kpi"><span>RevPAR estimado</span><strong>{gs(data.resumen.revpar_estimado_gs)}</strong><small>Tarifa de alojamiento / noche disponible</small></div>
        <div className="card sales-kpi"><span>Cobrado por alojamiento</span><strong>{gs(data.resumen.cobrado_alojamiento_gs)}</strong><small>Pagos netos registrados en el período</small></div>
        <div className="card sales-kpi"><span>Cobros sin atribución</span><strong>{gs(data.resumen.sin_atribucion_gs)}</strong><small>Pagos de reservas anteriores al desglose</small></div>
        <div className="card sales-kpi"><span>Reservas creadas</span><strong>{count(bookingTotal)}</strong><small>Según fecha de creación</small></div>
        <div className="card sales-kpi"><span>Cancelación</span><strong>{pct(data.resumen.tasa_cancelacion_pct)}</strong><small>De las reservas creadas</small></div>
        <div className="card sales-kpi"><span>Estadía promedio</span><strong>{data.resumen.estadia_promedio_noches.toLocaleString('es-PY')} noches</strong><small>Reservas con llegada en el período</small></div>
        <div className="card sales-kpi"><span>Huéspedes declarados</span><strong>{count(data.resumen.adultos+data.resumen.ninos)}</strong><small>{count(data.resumen.adultos)} adultos · {count(data.resumen.ninos)} niños</small></div>
        <div className="card sales-kpi"><span>Titulares únicos</span><strong>{count(data.resumen.titulares)}</strong><small>Clientes con llegada en el período</small></div>
      </div>
      <div className="room-analysis-note">ADR y RevPAR usan la tarifa nocturna de cada asignación; no incluyen descuentos ni cobros posteriores. Las llegadas y salidas corresponden a las fechas previstas en la reserva.</div>
      {data.resumen.pagos_sin_atribucion>0&&<div className="room-analysis-note">Hay {count(data.resumen.pagos_sin_atribucion)} pago(s) de reservas sin desglose en este período. Se muestran en color separado como “Sin atribución”; pueden incluir alojamiento y otros cargos. Las ventas cobradas directamente quedan fuera.</div>}
      {!hasActivity?<div className="card empty"><p>No hay reservas ni estadías en el período seleccionado.</p></div>:<>
        <section className="card sales-chart-card sales-chart-wide"><div className="sales-chart-heading"><div><h2>Cobros de reservas por día</h2><p>Alojamiento identificado y pagos sin atribución · fecha del pago en Paraguay.</p></div></div>
          {hasPaymentActivity?<div className="sales-chart" role="img" aria-label="Cobros de reservas por día en guaraníes, alojamiento y sin atribución"><ResponsiveContainer width="100%" height="100%"><BarChart data={payments} onClick={e=>{if(typeof e.activeLabel==='string')setSelectedIncomeDay(e.activeLabel)}} margin={{top:12,right:12,bottom:4,left:8}}><CartesianGrid stroke="#e8eee8" vertical={false}/><XAxis dataKey="fecha" tickFormatter={dateLabel} tick={{fontSize:11}} interval="preserveStartEnd"/><YAxis tickFormatter={value=>`₲ ${new Intl.NumberFormat('es-PY',{notation:'compact',maximumFractionDigits:1}).format(Number(value))}`} tick={{fontSize:11}} width={78}/><Tooltip contentStyle={tooltipStyle} formatter={(value,name)=>[gs(Math.round(Number(value))),String(name)]}/><Legend verticalAlign="top" height={28}/><Bar dataKey="total" name="Alojamiento" fill={colors[0]} radius={[4,4,0,0]} isAnimationActive={false}/><Bar dataKey="sin_atribucion" name="Sin atribución" fill={colors[1]} radius={[4,4,0,0]} isAnimationActive={false}/>{payments.length>14&&<Brush dataKey="fecha" height={22} stroke={colors[0]} travellerWidth={10}/>}</BarChart></ResponsiveContainer></div>:<div className="empty"><p>No hay cobros de reservas en el período.</p></div>}
          {selectedIncomeDay&&<div className="sales-selected-day">{selectedIncomeDay}: alojamiento {gs(data.cobros_diarios.find(day=>day.fecha===selectedIncomeDay)?.cobrado_alojamiento_gs||'0')} · sin atribución {gs(data.cobros_diarios.find(day=>day.fecha===selectedIncomeDay)?.sin_atribucion_gs||'0')}</div>}
        </section>
        <section className="card sales-chart-card sales-chart-wide"><div className="sales-chart-heading"><div><h2>Formas de pago de reservas</h2><p>Cobros netos de alojamiento y sin atribución, sin ventas cobradas directamente.</p></div></div>
          {methods.length?<div className="sales-chart sales-chart-tall" role="img" aria-label="Cobros de reservas por forma de pago en guaraníes"><ResponsiveContainer width="100%" height="100%"><BarChart data={methods} layout="vertical" margin={{top:8,right:20,bottom:4,left:0}}><CartesianGrid stroke="#e8eee8" horizontal={false}/><XAxis type="number" tickFormatter={value=>`₲ ${new Intl.NumberFormat('es-PY',{notation:'compact',maximumFractionDigits:1}).format(Number(value))}`} tick={{fontSize:11}}/><YAxis type="category" dataKey="nombre" width={135} tick={{fontSize:11}}/><Tooltip contentStyle={tooltipStyle} formatter={(value,name)=>[gs(Math.round(Number(value))),String(name)]}/><Legend/><Bar dataKey="total" name="Alojamiento" fill={colors[0]} isAnimationActive={false}/><Bar dataKey="sin_atribucion" name="Sin atribución" fill={colors[1]} isAnimationActive={false}/></BarChart></ResponsiveContainer></div>:<div className="empty"><p>No hay cobros de reservas en el período.</p></div>}
        </section>
        <section className="card sales-chart-card sales-chart-wide"><div className="sales-chart-heading"><div><h2>Ocupación diaria</h2><p>Porcentaje de habitaciones disponibles · realizada y prevista.</p></div></div>
          <div className="sales-chart" role="img" aria-label="Ocupación diaria realizada y prevista"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={daily} onClick={e=>{if(typeof e.activeLabel==='string')setSelectedDay(e.activeLabel)}} margin={{top:12,right:12,bottom:4,left:0}}><CartesianGrid stroke="#e8eee8" vertical={false}/><XAxis dataKey="fecha" tickFormatter={dateLabel} tick={{fontSize:11}} interval="preserveStartEnd"/><YAxis domain={[0,100]} tickFormatter={v=>`${v}%`} tick={{fontSize:11}} width={42}/><Tooltip contentStyle={tooltipStyle} formatter={(value,name)=>[pct(Number(value)),String(name)]}/><Legend verticalAlign="top" height={28}/><Area type="monotone" dataKey="ocupacion_real_pct" name="Realizada" stroke={colors[0]} fill="#e3eee7" strokeWidth={2} isAnimationActive={false}/><Line type="monotone" dataKey="ocupacion_prevista_pct" name="Prevista" stroke={colors[1]} strokeWidth={2} dot={false} activeDot={{r:5}} isAnimationActive={false}/>{daily.length>14&&<Brush dataKey="fecha" height={22} stroke={colors[0]} travellerWidth={10}/>}</ComposedChart></ResponsiveContainer></div>
          {selectedDay&&<div className="sales-selected-day">{selectedDay}: {data.dias.find(d=>d.fecha===selectedDay)?.realizadas||0} realizadas · {data.dias.find(d=>d.fecha===selectedDay)?.previstas||0} previstas · {data.dias.find(d=>d.fecha===selectedDay)?.disponibles||0} disponibles</div>}
        </section>
        <div className="sales-chart-grid">
          <section className="card sales-chart-card"><div className="sales-chart-heading"><div><h2>Por tipo de habitación</h2><p>Noches habitación realizadas y previstas.</p></div></div><div className="sales-chart sales-chart-tall" role="img" aria-label="Ocupación por tipo de habitación"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.tipos} layout="vertical" margin={{top:8,right:16,bottom:4,left:0}}><CartesianGrid stroke="#e8eee8" horizontal={false}/><XAxis type="number" allowDecimals={false} tick={{fontSize:11}}/><YAxis type="category" dataKey="nombre" width={105} tick={{fontSize:11}}/><Tooltip contentStyle={tooltipStyle} formatter={value=>count(Number(value))}/><Legend/><Bar dataKey="realizadas" name="Realizadas" fill={colors[0]} isAnimationActive={false}/><Bar dataKey="previstas" name="Previstas" fill={colors[1]} isAnimationActive={false}/></BarChart></ResponsiveContainer></div></section>
          <section className="card sales-chart-card"><div className="sales-chart-heading"><div><h2>Llegadas y salidas</h2><p>Fechas previstas de reservas vigentes.</p></div></div><div className="sales-chart sales-chart-tall" role="img" aria-label="Llegadas y salidas por día"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.llegadas_salidas} margin={{top:8,right:10,bottom:4,left:0}}><CartesianGrid stroke="#e8eee8" vertical={false}/><XAxis dataKey="fecha" tickFormatter={dateLabel} tick={{fontSize:11}} interval="preserveStartEnd"/><YAxis allowDecimals={false} tick={{fontSize:11}} width={30}/><Tooltip contentStyle={tooltipStyle}/><Legend/><Bar dataKey="llegadas" name="Llegadas" fill={colors[0]} isAnimationActive={false}/><Line dataKey="salidas" name="Salidas" stroke={colors[1]} strokeWidth={2} isAnimationActive={false}/>{data.llegadas_salidas.length>14&&<Brush dataKey="fecha" height={20} stroke={colors[0]}/>}</ComposedChart></ResponsiveContainer></div></section>
          <section className="card sales-chart-card"><div className="sales-chart-heading"><div><h2>Reservas creadas</h2><p>Cantidad diaria y estado actual.</p></div></div><div className="sales-chart sales-chart-tall" role="img" aria-label="Reservas creadas por día y estado"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.reservas} margin={{top:8,right:10,bottom:4,left:0}}><CartesianGrid stroke="#e8eee8" vertical={false}/><XAxis dataKey="fecha" tickFormatter={dateLabel} tick={{fontSize:11}} interval="preserveStartEnd"/><YAxis allowDecimals={false} tick={{fontSize:11}} width={30}/><Tooltip contentStyle={tooltipStyle}/><Legend/><Bar dataKey="confirmadas" name="Confirmadas" stackId="s" fill={colors[0]}/><Bar dataKey="en_casa" name="En casa" stackId="s" fill={colors[2]}/><Bar dataKey="finalizadas" name="Finalizadas" stackId="s" fill={colors[5]}/><Bar dataKey="canceladas" name="Canceladas" stackId="s" fill={colors[1]}/><Bar dataKey="no_show" name="No show" stackId="s" fill={colors[4]}/>{data.reservas.length>14&&<Brush dataKey="fecha" height={20} stroke={colors[0]}/>}</BarChart></ResponsiveContainer></div></section>
          <section className="card sales-chart-card"><div className="sales-chart-heading"><div><h2>Origen de reservas</h2><p>Reservas con llegada en el período.</p></div></div>{data.origenes.length?<div className="sales-chart sales-chart-pie" role="img" aria-label="Reservas por origen"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.origenes} dataKey="reservas" nameKey="nombre" innerRadius="48%" outerRadius="72%" isAnimationActive={false}>{data.origenes.map((_,i)=><Cell key={i} fill={colors[i%colors.length]}/>)}</Pie><Tooltip contentStyle={tooltipStyle}/><Legend/></PieChart></ResponsiveContainer></div>:<div className="empty">Sin llegadas en el período.</div>}</section>
          <section className="card sales-chart-card"><div className="sales-chart-heading"><div><h2>Duración de estadía</h2><p>Reservas con llegada en el período.</p></div></div>{data.estadias.length?<div className="sales-chart sales-chart-tall" role="img" aria-label="Duración de estadía"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.estadias} margin={{top:8,right:10,bottom:4,left:0}}><CartesianGrid stroke="#e8eee8" vertical={false}/><XAxis dataKey="tramo" tick={{fontSize:11}}/><YAxis allowDecimals={false} tick={{fontSize:11}} width={30}/><Tooltip contentStyle={tooltipStyle}/><Bar dataKey="reservas" name="Reservas" fill={colors[2]} radius={[4,4,0,0]} isAnimationActive={false}/></BarChart></ResponsiveContainer></div>:<div className="empty">Sin llegadas en el período.</div>}</section>
          <section className="card sales-chart-card"><div className="sales-chart-heading"><div><h2>Huéspedes declarados</h2><p>Adultos y niños de reservas con llegada en el período.</p></div></div>{data.resumen.adultos+data.resumen.ninos?<div className="sales-chart sales-chart-pie" role="img" aria-label="Adultos y niños declarados"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{nombre:'Adultos',cantidad:data.resumen.adultos},{nombre:'Niños',cantidad:data.resumen.ninos}]} dataKey="cantidad" nameKey="nombre" innerRadius="48%" outerRadius="72%" isAnimationActive={false}><Cell fill={colors[0]}/><Cell fill={colors[3]}/></Pie><Tooltip contentStyle={tooltipStyle}/><Legend/></PieChart></ResponsiveContainer></div>:<div className="empty">Sin huéspedes en el período.</div>}</section>
        </div>
      </>}
    </>}
  </div>;
}
