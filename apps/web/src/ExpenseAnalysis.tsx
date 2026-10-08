import { useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { gs } from './api';
import { ExpenseFilterFields, ExpenseTable, expenseQuery, initialExpenseFilters, useExpenseData, type Expense, type ExpenseOptions } from './Expenses';
import './sales-analytics.css';

type Group={id:string;nombre:string;total_gs:string;cantidad:number;porcentaje:number};
type Analysis={resumen:{total_gs:string;cantidad:number;promedio_gs:string;promedio_diario_gs:string;efectivo_gs:string;no_efectivo_gs:string;anulados:number;anulados_gs:string};dias:{fecha:string;total_gs:string;cantidad:number}[];tipos:Group[];formas_pago:Group[];mayores:Expense[]};
const colors=['#315849','#b97550','#d8a668','#839b87','#8d7470','#557b9b'];
const compact=(v:number)=>'₲ '+new Intl.NumberFormat('es-PY',{notation:'compact',maximumFractionDigits:1}).format(v);
const money=(v:unknown)=>gs(Math.round(Number(v)||0));
const tooltipStyle={borderRadius:9,border:'1px solid #e1e7df',fontSize:12};
function Breakdown({rows}:{rows:Group[]}){return <div className="expense-breakdown">{rows.map(r=><div key={r.id}><span>{r.nombre}</span><strong>{gs(r.total_gs)} · {r.porcentaje}%</strong></div>)}</div>}
export function ExpenseAnalysis({refresh}:{refresh:number}){
  const [filters,setFilters]=useState(initialExpenseFilters);
  const options=useExpenseData<ExpenseOptions>('/gastos/opciones',refresh);
  const valid=!!filters.desde&&!!filters.hasta&&filters.desde<=filters.hasta;
  const {data,error,loading}=useExpenseData<Analysis>(valid?'/gastos/analisis?'+expenseQuery(filters):null,refresh);
  const daily=data?.dias.map(d=>({...d,total:Number(d.total_gs)}))??[],types=data?.tipos.map(t=>({...t,total:Number(t.total_gs)}))??[],methods=data?.formas_pago.map(f=>({...f,total:Number(f.total_gs)}))??[];
  const summary=data?.resumen;
  return <div className="sales-analytics expense-analysis"><div className="page-head"><div><span className="eyebrow">GASTO · ANÁLISIS</span><h1>Análisis Gasto</h1><p>Importes según la fecha del gasto. Los anulados se muestran por separado.</p></div></div>
    <ExpenseFilterFields filters={filters} onChange={setFilters} options={options.data} analysis/>
    {!valid&&<div className="form-error" role="alert">Seleccioná un período válido; la fecha hasta debe ser igual o posterior a la fecha desde.</div>}{(error||options.error)&&<div className="form-error" role="alert">{error||options.error}</div>}{loading&&<div className="card empty">Cargando análisis de gastos…</div>}
    {data&&summary&&<><div className="sales-kpi-grid">{[['Total gastado',gs(summary.total_gs)],['Cantidad de gastos',summary.cantidad.toLocaleString('es-PY')],['Promedio por gasto',gs(summary.promedio_gs)],['Promedio diario',gs(summary.promedio_diario_gs)],['En efectivo',gs(summary.efectivo_gs)],['No efectivo',gs(summary.no_efectivo_gs)]].map(([label,value])=><div className="card sales-kpi" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <div className="card expense-notice">Anulados del período: <strong>{summary.anulados} · {gs(summary.anulados_gs)}</strong>. No se incluyen en los totales ni gráficos.</div>
      {!summary.cantidad?<div className="card empty">No hay gastos vigentes en el período seleccionado.</div>:<>
        <section className="card sales-chart-card"><div className="sales-chart-heading"><div><h2>Gastos por día</h2><p>Importe y cantidad, incluyendo los días sin gastos.</p></div></div><div className="sales-chart" role="img" aria-label="Importe y cantidad de gastos por día"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={daily} margin={{left:8,right:10,top:14,bottom:4}}><CartesianGrid stroke="#e8eee8" vertical={false}/><XAxis dataKey="fecha" tickFormatter={v=>v.slice(8,10)+'/'+v.slice(5,7)} tick={{fontSize:11}} minTickGap={25}/><YAxis yAxisId="money" tickFormatter={compact} width={75} tick={{fontSize:11}}/><YAxis yAxisId="count" orientation="right" allowDecimals={false} width={30}/><Tooltip contentStyle={tooltipStyle} formatter={(v,name)=>name==='Importe'?money(v):Number(v).toLocaleString('es-PY')}/><Legend/><Area yAxisId="money" dataKey="total" name="Importe" stroke={colors[0]} fill="#e3eee7" strokeWidth={2} isAnimationActive={false}/><Line yAxisId="count" dataKey="cantidad" name="Gastos" stroke={colors[1]} dot={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div></section>
        <div className="sales-chart-grid"><section className="card sales-chart-card"><div className="sales-chart-heading"><div><h2>Gastos por tipo</h2><p>Importe y participación en el total filtrado.</p></div></div><div style={{height:Math.max(270,types.length*38)}} role="img" aria-label="Ranking de gastos por tipo"><ResponsiveContainer width="100%" height="100%"><BarChart data={types} layout="vertical" margin={{right:15}}><CartesianGrid horizontal={false} stroke="#e8eee8"/><XAxis type="number" tickFormatter={compact} tick={{fontSize:11}}/><YAxis type="category" dataKey="nombre" width={110} tick={{fontSize:11}} tickFormatter={v=>v.length>17?v.slice(0,16)+'…':v}/><Tooltip contentStyle={tooltipStyle} formatter={money}/><Bar dataKey="total" name="Gastado" fill={colors[0]} radius={[0,4,4,0]} isAnimationActive={false}/></BarChart></ResponsiveContainer></div><Breakdown rows={data.tipos}/></section>
          <section className="card sales-chart-card"><div className="sales-chart-heading"><div><h2>Gastos por forma de pago</h2><p>Distribución de los egresos.</p></div></div><div className="sales-chart sales-chart-pie" role="img" aria-label="Distribución de gastos por forma de pago"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={methods} nameKey="nombre" dataKey="total" innerRadius="48%" outerRadius="75%" isAnimationActive={false}>{methods.map((m,i)=><Cell key={m.id} fill={colors[i%colors.length]}/>)}</Pie><Tooltip contentStyle={tooltipStyle} formatter={money}/></PieChart></ResponsiveContainer></div><Breakdown rows={data.formas_pago}/></section></div>
        <section className="card table-card"><div className="card-head"><div><h2>Los 10 mayores gastos</h2><p>Gastos vigentes del período seleccionado.</p></div></div><ExpenseTable rows={data.mayores}/></section>
      </>}
    </>}
  </div>;
}
