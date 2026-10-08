import { useEffect, useMemo, useState } from 'react';
import { Area, Bar, BarChart, Brush, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, gs, today } from './api';
import './sales-analytics.css';

type Row={total_gs:string;cantidad_ventas:number};
type Analysis={
  desde:string;hasta:string;
  resumen:{total_gs:string;cantidad_ventas:number;ticket_promedio_gs:string;unidades:number;cobrado_inicial_gs:string;pendiente_inicial_gs:string};
  dias:(Row&{fecha:string})[];
  productos:{idproducto:string;nombre:string;unidades:number;total_gs:string}[];
  formas_pago:{idforma_pago:string;nombre:string;total_gs:string}[];
  destinos:(Row&{destino:'restaurante'|'habitacion'})[];
  horas:(Row&{hora:number})[];
};
const colors=['#315849','#b97550','#d8a668','#839b87','#8d7470','#557b9b'];
const compact=(value:number)=>`₲ ${new Intl.NumberFormat('es-PY',{notation:'compact',maximumFractionDigits:1}).format(value)}`;
const money=(value:unknown)=>gs(Math.round(Number(value)||0));
const dateLabel=(value:string)=>`${value.slice(8,10)}/${value.slice(5,7)}`;
const shortName=(value:string)=>value.length>19?`${value.slice(0,18)}…`:value;
const tooltipStyle={borderRadius:9,border:'1px solid #e1e7df',fontSize:12};

export function SalesAnalytics({refresh}:{refresh:number}){
  const [from,setFrom]=useState(()=>`${today().slice(0,7)}-01`);
  const [to,setTo]=useState(today);
  const [data,setData]=useState<Analysis|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [productMetric,setProductMetric]=useState<'unidades'|'total'>('unidades');
  const [selectedDay,setSelectedDay]=useState<string|null>(null);
  const valid=Boolean(from&&to&&to>=from);
  useEffect(()=>{
    if(!valid){setData(null);setLoading(false);return}
    let live=true;setLoading(true);setData(null);setError('');setSelectedDay(null);
    api<Analysis>(`/ventas/analisis?desde=${from}&hasta=${to}`).then(result=>{if(live){setData(result);setLoading(false)}})
      .catch(e=>{if(live){setError(e.message);setLoading(false)}});
    return()=>{live=false};
  },[from,to,refresh,valid]);
  const daily=useMemo(()=>data?.dias.map(x=>({...x,total:Number(x.total_gs)}))||[],[data]);
  const products=useMemo(()=>data?.productos.map(x=>({...x,total:Number(x.total_gs)})).reverse()||[],[data]);
  const methods=useMemo(()=>data?.formas_pago.map(x=>({...x,total:Number(x.total_gs)})).reverse()||[],[data]);
  const destinations=useMemo(()=>data?.destinos.map(x=>({...x,nombre:x.destino==='habitacion'?'Habitación':'Restaurante',total:Number(x.total_gs)}))||[],[data]);
  const hours=useMemo(()=>data?.horas.map(x=>({...x,etiqueta:`${String(x.hora).padStart(2,'0')}:00`,total:Number(x.total_gs)}))||[],[data]);
  const destinationTotal=destinations.reduce((sum,x)=>sum+Number(x.total_gs),0);
  const metrics=data?.resumen;
  const productValue=productMetric==='unidades'?'unidades':'total';
  return <div className="sales-analytics">
    <div className="page-head"><div><span className="eyebrow">VENTA · ANÁLISIS</span><h1>Análisis de ventas</h1><p>Productos vendidos en restaurante y cargados a habitación.</p></div></div>
    <div className="card sales-analysis-filter"><div className="sales-analysis-filter-fields"><label className="field"><span>Fecha desde</span><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="field"><span>Fecha hasta</span><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div><span className="sales-analysis-period">{from&&to?`${from} → ${to}`:''}</span></div>
    {!valid&&<div className="form-error" role="alert">La fecha hasta debe ser igual o posterior a la fecha desde.</div>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    {loading&&<div className="card empty" aria-live="polite"><p>Cargando análisis de ventas…</p></div>}
    {!loading&&metrics&&<>
      <div className="sales-kpi-grid">
        <div className="card sales-kpi"><span>Total vendido</span><strong>{gs(metrics.total_gs)}</strong></div>
        <div className="card sales-kpi"><span>Número de ventas</span><strong>{metrics.cantidad_ventas.toLocaleString('es-PY')}</strong></div>
        <div className="card sales-kpi"><span>Ticket promedio</span><strong>{gs(metrics.ticket_promedio_gs)}</strong></div>
        <div className="card sales-kpi"><span>Unidades vendidas</span><strong>{metrics.unidades.toLocaleString('es-PY')}</strong></div>
        <div className="card sales-kpi"><span>Cobrado al vender</span><strong>{gs(metrics.cobrado_inicial_gs)}</strong></div>
        <div className="card sales-kpi"><span>Pendiente inicial</span><strong>{gs(metrics.pendiente_inicial_gs)}</strong></div>
      </div>
      {metrics.cantidad_ventas===0?<div className="card empty"><p>No hay ventas en el período seleccionado.</p></div>:<>
        <section className="card sales-chart-card sales-chart-wide"><div className="sales-chart-heading"><div><h2>Ventas por día</h2><p>Importe vendido y cantidad de ventas.{daily.length>14?' Arrastrá el control inferior para explorar el período.':''}</p></div></div>
          <div className="sales-chart" role="img" aria-label="Gráfico de ventas diarias en guaraníes y cantidad de ventas"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={daily} margin={{top:14,right:10,bottom:4,left:8}} onClick={event=>{if(typeof event.activeLabel==='string')setSelectedDay(event.activeLabel)}}>
            <CartesianGrid stroke="#e8eee8" vertical={false}/><XAxis dataKey="fecha" tickFormatter={dateLabel} tick={{fontSize:11}} interval="preserveStartEnd"/><YAxis yAxisId="money" tickFormatter={compact} tick={{fontSize:11}} width={75}/><YAxis yAxisId="count" orientation="right" allowDecimals={false} tick={{fontSize:11}} width={35}/>
            <Tooltip contentStyle={tooltipStyle} formatter={(value,name)=>name==='Vendido'?[money(value),'Vendido']:[Number(value).toLocaleString('es-PY'),'Ventas']}/><Legend verticalAlign="top" height={28}/>
            <Area yAxisId="money" type="monotone" dataKey="total" name="Vendido" stroke={colors[0]} fill="#e3eee7" strokeWidth={2} isAnimationActive={false}/><Line yAxisId="count" type="monotone" dataKey="cantidad_ventas" name="Ventas" stroke={colors[1]} strokeWidth={2} dot={false} activeDot={{r:5}} isAnimationActive={false}/>
            {daily.length>14&&<Brush dataKey="fecha" height={22} stroke={colors[0]} travellerWidth={10}/>}
          </ComposedChart></ResponsiveContainer></div>
          {selectedDay&&<div className="sales-selected-day">{selectedDay}: {gs(data.dias.find(x=>x.fecha===selectedDay)?.total_gs||'0')} · {data.dias.find(x=>x.fecha===selectedDay)?.cantidad_ventas||0} venta(s)</div>}
        </section>
        <div className="sales-chart-grid">
          <section className="card sales-chart-card"><div className="sales-chart-heading"><div><h2>Productos más vendidos</h2><p>Los 10 productos con más unidades.</p></div><div className="sales-metric-toggle"><button type="button" className={productMetric==='unidades'?'selected':''} aria-pressed={productMetric==='unidades'} onClick={()=>setProductMetric('unidades')}>Unidades</button><button type="button" className={productMetric==='total'?'selected':''} aria-pressed={productMetric==='total'} onClick={()=>setProductMetric('total')}>Importe</button></div></div>
            <div className="sales-chart sales-chart-tall" role="img" aria-label="Gráfico de productos más vendidos"><ResponsiveContainer width="100%" height="100%"><BarChart data={products} layout="vertical" margin={{top:8,right:18,bottom:4,left:0}}><CartesianGrid stroke="#e8eee8" horizontal={false}/><XAxis type="number" tickCount={3} tickFormatter={productMetric==='total'?compact:(x:number)=>String(x)} tick={{fontSize:11}}/><YAxis type="category" dataKey="nombre" width={126} tickFormatter={shortName} tick={{fontSize:11}}/><Tooltip contentStyle={tooltipStyle} formatter={(value)=>productMetric==='total'?money(value):Number(value).toLocaleString('es-PY')}/><Bar dataKey={productValue} name={productMetric==='total'?'Vendido':'Unidades'} fill={colors[0]} radius={[0,4,4,0]} isAnimationActive={false}/></BarChart></ResponsiveContainer></div>
          </section>
          <section className="card sales-chart-card"><div className="sales-chart-heading"><div><h2>Formas de pago</h2><p>Cobros vinculados directamente a estas ventas.</p></div></div>
            {methods.length?<div className="sales-chart sales-chart-tall" role="img" aria-label="Gráfico de cobros por forma de pago"><ResponsiveContainer width="100%" height="100%"><BarChart data={methods} layout="vertical" margin={{top:8,right:18,bottom:4,left:0}}><CartesianGrid stroke="#e8eee8" horizontal={false}/><XAxis type="number" tickCount={3} tickFormatter={compact} tick={{fontSize:11}}/><YAxis type="category" dataKey="nombre" width={126} tick={{fontSize:11}}/><Tooltip contentStyle={tooltipStyle} formatter={money}/><Bar dataKey="total" name="Cobrado" fill={colors[1]} radius={[0,4,4,0]} isAnimationActive={false}/></BarChart></ResponsiveContainer></div>:<div className="empty"><p>No hay cobros directos para estas ventas.</p></div>}
          </section>
          <section className="card sales-chart-card"><div className="sales-chart-heading"><div><h2>Ventas por destino</h2><p>Restaurante y habitación.</p></div></div>
            <div className="sales-chart sales-chart-pie" role="img" aria-label="Gráfico de ventas por destino"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={destinations} dataKey="total" nameKey="nombre" innerRadius="48%" outerRadius="72%" isAnimationActive={false}>{destinations.map((_,i)=><Cell key={i} fill={colors[i]}/>)}</Pie><Tooltip contentStyle={tooltipStyle} formatter={money}/></PieChart></ResponsiveContainer></div>
            <div className="sales-destination-summary">{destinations.map((x,i)=><div key={x.destino}><span className="sales-destination-dot" style={{background:colors[i]}}/><span>{x.nombre}</span><b>{gs(x.total_gs)} · {destinationTotal?Math.round(Number(x.total_gs)/destinationTotal*100):0}%</b></div>)}</div>
          </section>
          <section className="card sales-chart-card"><div className="sales-chart-heading"><div><h2>Ventas por hora</h2><p>Horario de Paraguay, de 00:00 a 23:00.</p></div></div>
            <div className="sales-chart sales-chart-tall" role="img" aria-label="Gráfico de ventas por hora"><ResponsiveContainer width="100%" height="100%"><BarChart data={hours} margin={{top:8,right:10,bottom:4,left:0}}><CartesianGrid stroke="#e8eee8" vertical={false}/><XAxis dataKey="etiqueta" interval={3} tick={{fontSize:11}}/><YAxis allowDecimals={false} tick={{fontSize:11}} width={30}/><Tooltip contentStyle={tooltipStyle} formatter={(value)=>[Number(value).toLocaleString('es-PY'),'Ventas']}/><Bar dataKey="cantidad_ventas" name="Ventas" fill={colors[3]} radius={[4,4,0,0]} isAnimationActive={false}/></BarChart></ResponsiveContainer></div>
          </section>
        </div>
      </>}
    </>}
  </div>;
}
