import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { addDays, api, gs, today } from './api';
import { useCan } from './usePermissions';
import './reports-dashboard.css';

type OccupancyDay={fecha:string;ocupadas:number;disponibles:number};
type RoomAnalysis={
  resumen:{reservas_creadas:number;noches_realizadas:number;cobrado_alojamiento_gs:string};
  reservas:{fecha:string;total:number;confirmadas:number;en_casa:number;finalizadas:number;canceladas:number;no_show:number}[];
  llegadas_salidas:{fecha:string;llegadas:number;salidas:number}[];
  cobros_diarios:{fecha:string;cobrado_alojamiento_gs:string;sin_atribucion_gs:string}[];
};
type MoneyDay={fecha:string;total_gs:string;cantidad?:number;cantidad_ventas?:number};
type Group={nombre:string;total_gs:string};
type SalesAnalysis={resumen:{total_gs:string;cantidad_ventas:number};dias:MoneyDay[];productos:Group[]};
type ExpenseAnalysis={resumen:{total_gs:string;cantidad:number};dias:MoneyDay[];tipos:Group[]};
type PurchaseAnalysis={resumen:{total_gs:string;cantidad:number};dias:MoneyDay[];proveedores:Group[]};
type Result<T>={data:T|null;loading:boolean;error:string};

const colors={green:'#315849',copper:'#b97550',sage:'#8eae94',blue:'#557b9b',sand:'#d8a668'};
const tooltipStyle={borderRadius:9,border:'1px solid #e1e7df',fontSize:12};
const dateLabel=(value:string)=>`${value.slice(8,10)}/${value.slice(5,7)}`;
const compact=(value:number)=>`₲ ${new Intl.NumberFormat('es-PY',{notation:'compact',maximumFractionDigits:1}).format(value)}`;
const money=(value:unknown)=>gs(Math.round(Number(value)||0));
const count=(value:number)=>value.toLocaleString('es-PY');
const pct=(value:number)=>`${value.toLocaleString('es-PY',{maximumFractionDigits:1})}%`;

function useReport<T>(path:string|null,refresh:number):Result<T>{
  const [result,setResult]=useState<Result<T>>({data:null,loading:false,error:''});
  useEffect(()=>{
    if(!path){setResult({data:null,loading:false,error:''});return}
    const controller=new AbortController();
    setResult({data:null,loading:true,error:''});
    api<T>(path,{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted)setResult({data,loading:false,error:''})})
      .catch(error=>{if(!controller.signal.aborted)setResult({data:null,loading:false,error:error.message||'No se pudo cargar el informe'})});
    return()=>controller.abort();
  },[path,refresh]);
  return result;
}

function Kpi({label,value,detail}:{label:string;value:string;detail?:string}){
  return <div className="card report-kpi"><span>{label}</span><strong>{value}</strong>{detail&&<small>{detail}</small>}</div>;
}

function ChartCard({title,description,children,wide=false}:{title:string;description:string;children:React.ReactNode;wide?:boolean}){
  return <section className={`card report-chart-card${wide?' report-chart-wide':''}`}><div className="report-chart-heading"><h3>{title}</h3><p>{description}</p></div>{children}</section>;
}

function Module<T>({title,description,result,children}:{title:string;description:string;result:Result<T>;children:(data:T)=>React.ReactNode}){
  return <section className="report-module" aria-label={title}>
    <div className="report-module-heading"><div><span className="eyebrow">ANÁLISIS</span><h2>{title}</h2><p>{description}</p></div></div>
    {result.loading&&<div className="card report-state" aria-live="polite">Cargando {title.toLowerCase()}…</div>}
    {result.error&&<div className="form-error" role="alert">No se pudo cargar {title.toLowerCase()}: {result.error}</div>}
    {!result.loading&&!result.error&&result.data!==null?children(result.data):null}
  </section>;
}

function MoneyTrend({rows,label,color}:{rows:MoneyDay[];label:string;color:string}){
  const [selected,setSelected]=useState<string|null>(null);
  const data=rows.map(row=>({...row,total:Number(row.total_gs)}));
  if(!data.some(row=>row.total!==0))return <div className="report-chart-empty">Sin {label.toLowerCase()} en este período.</div>;
  const selectedRow=rows.find(row=>row.fecha===selected);
  return <><div className="report-chart" role="img" aria-label={`${label} por día`}><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} onClick={event=>{if(typeof event.activeLabel==='string')setSelected(event.activeLabel)}} margin={{top:12,right:12,bottom:4,left:4}}><CartesianGrid stroke="#e8eee8" vertical={false}/><XAxis dataKey="fecha" tickFormatter={dateLabel} tick={{fontSize:11}} minTickGap={22}/><YAxis tickFormatter={compact} width={78} tick={{fontSize:11}}/><Tooltip contentStyle={tooltipStyle} formatter={money} labelFormatter={value=>String(value)}/><Area dataKey="total" name={label} type="monotone" stroke={color} fill={color} fillOpacity={0.16} strokeWidth={2} isAnimationActive={false}/></AreaChart></ResponsiveContainer></div>{selectedRow&&<div className="report-selected">{dateLabel(selectedRow.fecha)} · {label}: {gs(selectedRow.total_gs)}</div>}</>;
}

function Ranking({rows,label,color}:{rows:Group[];label:string;color:string}){
  const data=rows.slice(0,6).map(row=>({...row,total:Number(row.total_gs)}));
  if(!data.length)return <div className="report-chart-empty">Sin datos para este desglose.</div>;
  return <div className="report-chart" role="img" aria-label={label}><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{top:8,right:12,bottom:4,left:0}}><CartesianGrid stroke="#e8eee8" horizontal={false}/><XAxis type="number" tickFormatter={compact} tick={{fontSize:11}}/><YAxis type="category" dataKey="nombre" tick={{fontSize:11}} width={110} tickFormatter={value=>String(value).length>17?`${String(value).slice(0,16)}…`:String(value)}/><Tooltip contentStyle={tooltipStyle} formatter={money}/><Bar dataKey="total" name={label} fill={color} radius={[0,4,4,0]} isAnimationActive={false}/></BarChart></ResponsiveContainer></div>;
}

function Occupancy({rows}:{rows:OccupancyDay[]}){
  const [metric,setMetric]=useState<'percent'|'rooms'>('percent');
  const [selected,setSelected]=useState<string|null>(null);
  const data=rows.map(row=>({...row,porcentaje:row.disponibles?Math.round(row.ocupadas/row.disponibles*1000)/10:0}));
  const totalRooms=rows.reduce((sum,row)=>sum+row.disponibles,0);
  const occupied=rows.reduce((sum,row)=>sum+row.ocupadas,0);
  const selectedRow=rows.find(row=>row.fecha===selected);
  return <>
    <div className="report-kpis"><Kpi label="Ocupación promedio" value={totalRooms?pct(occupied/totalRooms*100):'—'} detail="Noches ocupadas / noches disponibles"/><Kpi label="Noches ocupadas" value={count(occupied)} detail="Habitaciones ocupadas por día"/><Kpi label="Noches disponibles" value={count(totalRooms)} detail="Capacidad del período"/></div>
    <ChartCard title="Evolución de la ocupación" description="Seleccioná un día para ver sus valores." wide>
      <div className="report-toggle" aria-label="Unidad de ocupación"><button type="button" className={metric==='percent'?'selected':''} aria-pressed={metric==='percent'} onClick={()=>setMetric('percent')}>Porcentaje</button><button type="button" className={metric==='rooms'?'selected':''} aria-pressed={metric==='rooms'} onClick={()=>setMetric('rooms')}>Habitaciones</button></div>
      {!rows.length?<div className="report-chart-empty">No hay datos de ocupación en este período.</div>:<><div className="report-chart report-chart-primary" role="img" aria-label="Ocupación diaria"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} onClick={event=>{if(typeof event.activeLabel==='string')setSelected(event.activeLabel)}} margin={{top:10,right:12,bottom:4,left:4}}><CartesianGrid stroke="#e8eee8" vertical={false}/><XAxis dataKey="fecha" tickFormatter={dateLabel} tick={{fontSize:11}} minTickGap={22}/><YAxis domain={metric==='percent'?[0,100]:[0,'auto']} allowDecimals={metric==='percent'} tickFormatter={value=>metric==='percent'?`${value}%`:String(value)} width={45} tick={{fontSize:11}}/><Tooltip contentStyle={tooltipStyle} formatter={(value,name)=>[metric==='percent'?pct(Number(value)):count(Number(value)),String(name)]}/><Legend/>{metric==='percent'?<Area dataKey="porcentaje" name="Ocupación" type="monotone" stroke={colors.green} fill="#e3eee7" strokeWidth={2} isAnimationActive={false}/>:<><Bar dataKey="ocupadas" name="Ocupadas" fill={colors.green} radius={[4,4,0,0]} isAnimationActive={false}/><Line dataKey="disponibles" name="Disponibles" stroke={colors.copper} strokeWidth={2} dot={false} isAnimationActive={false}/></>}</ComposedChart></ResponsiveContainer></div>{selectedRow&&<div className="report-selected">{dateLabel(selectedRow.fecha)} · {count(selectedRow.ocupadas)} ocupadas de {count(selectedRow.disponibles)} disponibles · {selectedRow.disponibles?pct(selectedRow.ocupadas/selectedRow.disponibles*100):'—'}</div>}</>}
    </ChartCard>
  </>;
}

function Rooms({data}:{data:RoomAnalysis}){
  const hasBookings=data.reservas.some(row=>row.total>0);
  const hasFlows=data.llegadas_salidas.some(row=>row.llegadas>0||row.salidas>0);
  const payments=data.cobros_diarios.map(row=>({...row,alojamiento:Number(row.cobrado_alojamiento_gs),sinAtribucion:Number(row.sin_atribucion_gs)}));
  return <><div className="report-kpis"><Kpi label="Reservas creadas" value={count(data.resumen.reservas_creadas)} detail="Según fecha de creación"/><Kpi label="Noches realizadas" value={count(data.resumen.noches_realizadas)} detail="Estadías registradas"/><Kpi label="Cobrado por alojamiento" value={gs(data.resumen.cobrado_alojamiento_gs)} detail="Pagos identificados de reservas"/></div><div className="report-chart-grid">
    <ChartCard title="Reservas por día" description="Fecha de creación y estado actual.">{hasBookings?<div className="report-chart" role="img" aria-label="Reservas creadas por día"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.reservas} margin={{top:12,right:8,bottom:4,left:0}}><CartesianGrid stroke="#e8eee8" vertical={false}/><XAxis dataKey="fecha" tickFormatter={dateLabel} tick={{fontSize:11}} minTickGap={22}/><YAxis allowDecimals={false} width={28} tick={{fontSize:11}}/><Tooltip contentStyle={tooltipStyle}/><Legend/><Bar dataKey="confirmadas" name="Confirmadas" stackId="reservas" fill={colors.green}/><Bar dataKey="en_casa" name="En casa" stackId="reservas" fill={colors.sage}/><Bar dataKey="finalizadas" name="Finalizadas" stackId="reservas" fill={colors.blue}/><Bar dataKey="canceladas" name="Canceladas" stackId="reservas" fill={colors.copper}/><Bar dataKey="no_show" name="No show" stackId="reservas" fill={colors.sand}/></BarChart></ResponsiveContainer></div>:<div className="report-chart-empty">Sin reservas creadas en este período.</div>}</ChartCard>
    <ChartCard title="Llegadas y salidas" description="Fechas previstas de las reservas vigentes.">{hasFlows?<div className="report-chart" role="img" aria-label="Llegadas y salidas por día"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.llegadas_salidas} margin={{top:12,right:8,bottom:4,left:0}}><CartesianGrid stroke="#e8eee8" vertical={false}/><XAxis dataKey="fecha" tickFormatter={dateLabel} tick={{fontSize:11}} minTickGap={22}/><YAxis allowDecimals={false} width={28} tick={{fontSize:11}}/><Tooltip contentStyle={tooltipStyle}/><Legend/><Bar dataKey="llegadas" name="Llegadas" fill={colors.green} radius={[4,4,0,0]}/><Line dataKey="salidas" name="Salidas" stroke={colors.copper} strokeWidth={2}/></ComposedChart></ResponsiveContainer></div>:<div className="report-chart-empty">Sin llegadas ni salidas en este período.</div>}</ChartCard>
    <ChartCard title="Cobros de reservas" description="Alojamiento identificado y cobros sin atribución." wide>{payments.some(row=>row.alojamiento||row.sinAtribucion)?<div className="report-chart" role="img" aria-label="Cobros de reservas por día"><ResponsiveContainer width="100%" height="100%"><AreaChart data={payments} margin={{top:12,right:8,bottom:4,left:4}}><CartesianGrid stroke="#e8eee8" vertical={false}/><XAxis dataKey="fecha" tickFormatter={dateLabel} tick={{fontSize:11}} minTickGap={22}/><YAxis tickFormatter={compact} width={78} tick={{fontSize:11}}/><Tooltip contentStyle={tooltipStyle} formatter={money}/><Legend/><Area dataKey="alojamiento" name="Alojamiento" type="monotone" stroke={colors.green} fill={colors.green} fillOpacity={0.13} strokeWidth={2}/><Area dataKey="sinAtribucion" name="Sin atribución" type="monotone" stroke={colors.copper} fill={colors.copper} fillOpacity={0.1} strokeWidth={2}/></AreaChart></ResponsiveContainer></div>:<div className="report-chart-empty">Sin cobros de reservas en este período.</div>}</ChartCard>
  </div></>;
}

export function ReportsDashboard({refresh}:{refresh:number}){
  const can=useCan();
  const [from,setFrom]=useState(()=>addDays(today(),-29));
  const [to,setTo]=useState(today);
  const valid=/^\d{4}-\d{2}-\d{2}$/.test(from)&&/^\d{4}-\d{2}-\d{2}$/.test(to)&&from<=to;
  const query=useMemo(()=>valid?`desde=${from}&hasta=${to}`:null,[from,to,valid]);
  const occupancy=useReport<OccupancyDay[]>(query?`/informes/ocupacion?desde=${from}&hasta=${addDays(to,1)}`:null,refresh);
  const rooms=useReport<RoomAnalysis>(query&&can('rooms.analysis')?`/habitaciones/analisis?${query}`:null,refresh);
  const sales=useReport<SalesAnalysis>(query&&can('sales.analysis')?`/ventas/analisis?${query}`:null,refresh);
  const purchases=useReport<PurchaseAnalysis>(query&&can('purchases.analysis')?`/compras/analisis?${query}`:null,refresh);
  const expenses=useReport<ExpenseAnalysis>(query&&can('expenses.analysis')?`/gastos/analisis?${query}`:null,refresh);
  const preset=(days:number)=>{const end=today();setTo(end);setFrom(addDays(end,1-days))};
  const currentPreset=([7,30,90] as const).find(days=>to===today()&&from===addDays(to,1-days));
  return <div className="reports-dashboard">
    <div className="page-head"><div><span className="eyebrow">ANÁLISIS</span><h1>Informes</h1><p>La actividad del hotel en un solo lugar.</p></div></div>
    <div className="card report-filter-card"><div className="report-presets" aria-label="Período rápido">{([7,30,90] as const).map(days=><button type="button" key={days} className={currentPreset===days?'selected':''} aria-pressed={currentPreset===days} onClick={()=>preset(days)}>{days} días</button>)}</div><div className="report-dates"><label className="field"><span>Desde</span><input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label className="field"><span>Hasta</span><input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label></div></div>
    {!valid&&<div className="form-error" role="alert">Seleccioná un período válido: “Hasta” debe ser igual o posterior a “Desde”.</div>}
    {valid&&<>
      <Module title="Ocupación" description="Habitaciones ocupadas y capacidad disponible." result={occupancy}>{(data:OccupancyDay[])=><Occupancy rows={data}/>}</Module>
      {can('rooms.analysis')&&<Module title="Reservas y alojamiento" description="Movimiento de huéspedes y cobros de reservas." result={rooms}>{(data:RoomAnalysis)=><Rooms data={data}/>}</Module>}
      {can('sales.analysis')&&<Module title="Ventas" description="Ventas registradas, separadas de los cobros de alojamiento." result={sales}>{(data:SalesAnalysis)=><><div className="report-kpis"><Kpi label="Ventas del período" value={gs(data.resumen.total_gs)}/><Kpi label="Operaciones de venta" value={count(data.resumen.cantidad_ventas)}/></div><div className="report-chart-grid"><ChartCard title="Ventas por día" description="Importe de ventas registradas."><MoneyTrend rows={data.dias} label="Ventas" color={colors.green}/></ChartCard><ChartCard title="Productos destacados" description="Los seis productos con mayor importe."><Ranking rows={data.productos} label="Ventas por producto" color={colors.copper}/></ChartCard></div></>}</Module>}
      {can('purchases.analysis')&&<Module title="Compras" description="Compras vigentes y distribución por proveedor." result={purchases}>{(data:PurchaseAnalysis)=><><div className="report-kpis"><Kpi label="Compras del período" value={gs(data.resumen.total_gs)}/><Kpi label="Operaciones de compra" value={count(data.resumen.cantidad)}/></div><div className="report-chart-grid"><ChartCard title="Compras por día" description="Importe de compras vigentes."><MoneyTrend rows={data.dias} label="Compras" color={colors.blue}/></ChartCard><ChartCard title="Principales proveedores" description="Los seis proveedores con mayor importe."><Ranking rows={data.proveedores} label="Compras por proveedor" color={colors.sand}/></ChartCard></div></>}</Module>}
      {can('expenses.analysis')&&<Module title="Gastos" description="Gastos vigentes y distribución por tipo." result={expenses}>{(data:ExpenseAnalysis)=><><div className="report-kpis"><Kpi label="Gastos del período" value={gs(data.resumen.total_gs)}/><Kpi label="Gastos registrados" value={count(data.resumen.cantidad)}/></div><div className="report-chart-grid"><ChartCard title="Gastos por día" description="Importe de gastos vigentes."><MoneyTrend rows={data.dias} label="Gastos" color={colors.copper}/></ChartCard><ChartCard title="Tipos de gasto" description="Los seis tipos con mayor importe."><Ranking rows={data.tipos} label="Gastos por tipo" color={colors.green}/></ChartCard></div></>}</Module>}
    </>}
  </div>;
}
