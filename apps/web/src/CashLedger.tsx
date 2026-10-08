import { useEffect, useState } from 'react';
import { api, gs } from './api';
import { CashFixed } from './CashFixed';
import { openCashTicket } from './CashTicket';

type CashProps = { refresh:number; run:any };
const timestamp=(value:string)=>new Intl.DateTimeFormat('es-PY',{timeZone:'America/Asuncion',dateStyle:'short',timeStyle:'short'}).format(new Date(value));

function useLoad<T>(path:string|null,refresh:number) {
  const [result,setResult]=useState<{path:string|null;refresh:number;data:T|null;error:string;loading:boolean}>({path:null,refresh:-1,data:null,error:'',loading:false});
  useEffect(()=>{
    let live=true;
    setResult({path,refresh,data:null,error:'',loading:Boolean(path)});
    if(path)api<T>(path).then(data=>{if(live)setResult({path,refresh,data,error:'',loading:false})})
      .catch(e=>{if(live)setResult({path,refresh,data:null,error:e.message,loading:false})});
    return()=>{live=false};
  },[path,refresh]);
  return result.path===path&&result.refresh===refresh?result:{data:null,error:'',loading:Boolean(path)};
}

function CashSummary({detail}:{detail:any}) {
  return <>
    <div className="cash-detail-totals">
      <span>Fondo inicial <b>{gs(detail.monto_inicial_gs)}</b></span>
      <span>Ingresos actuales <b>{gs(detail.resumen.ingresos_gs)}</b></span>
      <span>Egresos actuales <b>{gs(detail.resumen.egresos_gs)}</b></span>
      <span>Neto actual <b>{gs(detail.resumen.neto_gs)}</b></span>
      <span>Efectivo actual <b>{gs(detail.resumen.efectivo_gs)}</b></span>
      <span>No efectivo actual <b>{gs(detail.resumen.no_efectivo_gs)}</b></span>
    </div>
    {detail.cerrada_en&&<div className="cash-close-info">
      <p>Cerrada el {timestamp(detail.cerrada_en)} · Efectivo contado: <b>{gs(detail.monto_cierre_gs)}</b></p>
      {detail.cierre_comprobante&&<p>Efectivo esperado al cierre: <b>{gs(detail.cierre_comprobante.efectivo_esperado_gs)}</b> · Diferencia al cierre: <b>{gs(detail.cierre_comprobante.diferencia_gs)}</b></p>}
      <p>Totales originales del cierre{detail.cierre_reconstruido?' (reconstruidos)':''}: ingresos <b>{gs(detail.cierre_totales?.ingresos_gs)}</b> · egresos <b>{gs(detail.cierre_totales?.egresos_gs)}</b> · neto <b>{gs(detail.cierre_totales?.neto_gs)}</b></p>
      <p>Ajuste posterior al cierre: <b>{gs(detail.ajuste_posterior_gs)}</b></p>
      <p>Efectivo esperado actual: <b>{gs(detail.efectivo_esperado_gs)}</b> · Diferencia con lo contado: <b>{gs((BigInt(detail.monto_cierre_gs)-BigInt(detail.efectivo_esperado_gs)).toString())}</b></p>
    </div>}
  </>;
}

function CashMovements({movimientos}:{movimientos:any[]}) {
  return <><div className="table-wrap"><table className="types-table cash-movements-table">
    <thead><tr><th>Fecha y hora</th><th>Concepto</th><th>Monto</th><th>Forma de pago</th><th>Ingreso/Egreso</th><th>Estado</th></tr></thead>
    <tbody>{movimientos.map(m=>{const customer=[m.cliente_nombre,m.cliente_apellido].filter(Boolean).join(' ').trim();const room=m.habitaciones&&!['—','Sin habitación'].includes(m.habitaciones)?`Hab. ${m.habitaciones}`:'';const context=m.fk_idcompra?(m.proveedor_nombre||''):[customer,room].filter(Boolean).join(' · ');return <tr key={m.idcaja_detalle} className={m.anulado||!m.activo?'inactive-row':''}>
      <td>{timestamp(m.fecha_movimiento)}</td><td><div className="cash-concept"><span>{m.descripcion}</span>{context&&<small>{context}</small>}</div></td><td>{gs(m.monto_gs)}</td><td>{m.forma_pago_nombre}</td>
      <td><span className={'badge '+(m.tipo==='ingreso'?'status-en_casa':'status-rechazado')}>{m.tipo.toUpperCase()}</span></td>
      <td>{m.anulado?'Anulado':!m.activo?'Inactivo':'Vigente'}{m.anulado&&<small className="cash-annul-note">{m.motivo_anulacion||'Sin motivo histórico'}{m.anulado_por&&' · '+m.anulado_por}{m.fecha_anulado&&' · '+timestamp(m.fecha_anulado)}</small>}</td>
    </tr>})}</tbody>
  </table></div>{!movimientos.length&&<div className="empty"><p>Esta caja no tiene movimientos registrados.</p></div>}</>;
}

function CashDetail({id,refresh,run}:{id:string}&CashProps) {
  const {data:detail,error,loading}=useLoad<any>('/cajas/'+id+'/detalle',refresh);
  const [ticketError,setTicketError]=useState('');
  const [printing,setPrinting]=useState(false);
  const printTicket=async()=>{
    const tab=window.open('','_blank');setPrinting(true);setTicketError('');
    try{await openCashTicket(id,tab)}catch(e:any){if(tab&&!tab.closed)tab.close();setTicketError(e.message||'No se pudo abrir el ticket')}
    finally{setPrinting(false)}
  };
  return <section className="card table-card top-space" aria-busy={loading}>
    <div className="card-head cash-detail-toolbar"><div><span className="eyebrow">MOVIMIENTOS</span><h2>Detalle de caja #{id}</h2></div>{detail?.cierre_comprobante&&<button className="ghost-button" disabled={printing} onClick={()=>void printTicket()}>{printing?'Abriendo ticket…':'Imprimir ticket de cierre'}</button>}</div>
    {error&&<div className="form-error" role="alert">{error}</div>}
    {ticketError&&<div className="form-error" role="alert">{ticketError}</div>}
    {loading&&<div className="empty"><p>Cargando detalle…</p></div>}
    {detail&&<><CashSummary detail={detail}/><CashMovements movimientos={detail.movimientos}/></>}
  </section>;
}

export function CashCurrent({refresh,run}:CashProps) {
  const [localRefresh,setLocalRefresh]=useState(0);
  const {data:caja,error,loading}=useLoad<any>('/caja',refresh+localRefresh);
  return <>
    <CashFixed caja={caja} loading={loading} error={error} run={run} onClosed={()=>setLocalRefresh(n=>n+1)}/>
    {caja?.idcaja&&<CashDetail key={String(caja.idcaja)} id={String(caja.idcaja)} refresh={refresh+localRefresh} run={run}/>}
  </>;
}

export function CashClosed({refresh,run}:CashProps) {
  const {data:cajas,error,loading}=useLoad<any[]>('/cajas?estado=cerrada',refresh);
  const [selected,setSelected]=useState('');
  return <>
    <div className="page-head"><div><span className="eyebrow">FINANZAS</span><h1>Cajas cerradas</h1><p>Consultá los cierres y los movimientos de cada turno.</p></div></div>
    <section className="card table-card" aria-busy={loading}>
      <div className="card-head cash-detail-toolbar"><div><span className="eyebrow">HISTORIAL</span><h2>Cajas cerradas</h2></div></div>
      {error&&<div className="form-error" role="alert">{error}</div>}
      {loading&&<div className="empty"><p>Cargando cajas cerradas…</p></div>}
      {cajas&&<><div className="table-wrap"><table className="types-table cash-history-table">
        <thead><tr><th>Número de caja</th><th>Apertura</th><th>Cierre</th><th>Fondo inicial</th><th>Efectivo contado al cierre</th><th>Acciones</th></tr></thead>
        <tbody>{cajas.map(c=><tr key={c.idcaja} className={selected===String(c.idcaja)?'cash-history-selected':''}>
          <td>#{c.idcaja}</td><td>{timestamp(c.abierta_en)}</td><td>{timestamp(c.cerrada_en)}</td><td>{gs(c.monto_inicial_gs)}</td><td>{gs(c.monto_cierre_gs)}</td>
          <td><button className="small-button" aria-pressed={selected===String(c.idcaja)} onClick={()=>setSelected(String(c.idcaja))}>Ver detalle</button></td>
        </tr>)}</tbody>
      </table></div>{!cajas.length&&<div className="empty"><p>No hay cajas cerradas registradas.</p></div>}</>}
    </section>
    {selected?<CashDetail key={selected} id={selected} refresh={refresh} run={run}/>:<section className="card top-space empty"><p>Seleccioná una caja para ver sus movimientos.</p></section>}
  </>;
}
