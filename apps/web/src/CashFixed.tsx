import { useState } from 'react';
import { Wallet, X } from 'lucide-react';
import { api, gs } from './api';
import { openCashTicket } from './CashTicket';

const denominations=['100000','50000','20000','10000','5000','1000'] as const;
type Counts=Record<typeof denominations[number],string>;
const emptyCounts=():Counts=>({100000:'0',50000:'0',20000:'0',10000:'0',5000:'0',1000:'0'});
const Field=({label,children}:{label:string;children:React.ReactNode})=><label className="field"><span>{label}</span>{children}</label>;

export function CashFixed({caja,error,loading,run,onClosed}:{caja:any;error:string;loading:boolean;run:(fn:()=>Promise<any>,success?:string)=>Promise<void>;onClosed:()=>void}){
  const [initial,setInitial]=useState('0');
  const [review,setReview]=useState(false);
  const [counts,setCounts]=useState<Counts>(emptyCounts);
  const [saved,setSaved]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [modalError,setModalError]=useState('');
  const abierta=Boolean(caja?.idcaja);
  const valid=denominations.every(d=>/^\d+$/.test(counts[d]));
  const total=valid?denominations.reduce((sum,d)=>sum+BigInt(d)*BigInt(counts[d]),0n):null;
  const expected=BigInt(caja?.efectivo_esperado_gs??0);
  const closeModal=()=>{if(!busy){setReview(false);setSaved(null);setModalError('')}};
  const print=async(id:string,tab:Window|null)=>{
    try{await openCashTicket(id,tab);setModalError('')}
    catch(e:any){if(tab&&!tab.closed)tab.close();setModalError(`La caja quedó cerrada, pero no se pudo abrir el ticket: ${e.message}. Podés intentar imprimirlo de nuevo.`)}
  };
  const save=async(withTicket:boolean)=>{
    if(busy||saved)return;
    if(!valid||total===null||total>9223372036854775807n){setModalError('Ingresá cantidades enteras válidas para todos los billetes.');return}
    const tab=withTicket?window.open('','_blank'):null;
    setBusy(true);setModalError('');
    try{
      const result=await api<any>('/caja/cerrar',{method:'POST',body:JSON.stringify({billetes:counts})});
      setSaved(result);onClosed();
      if(withTicket)await print(String(result.idcaja),tab);
    }catch(e:any){if(tab&&!tab.closed)tab.close();setModalError(e.message||'No se pudo cerrar la caja')}
    finally{setBusy(false)}
  };
  const reprint=async()=>{
    if(!saved||busy)return;
    const tab=window.open('','_blank');setBusy(true);
    try{await print(String(saved.idcaja),tab)}finally{setBusy(false)}
  };
  return <>
    <div className="page-head"><div><span className="eyebrow">FINANZAS</span><h1>Caja actual</h1><p>Registrá los cobros de cada turno y controlá el cierre.</p></div></div>
    {error&&<div className="form-error">{error}</div>}
    {loading?<div className="card empty"><p>Cargando caja actual…</p></div>:!error&&<div className="cash-layout">
      <div className="card cash-hero"><div className="cash-icon"><Wallet size={28}/></div><span className="eyebrow">ESTADO DE CAJA</span><h2>{abierta?'Caja abierta':'Caja cerrada'}</h2>
        <p>{abierta&&caja.abierta_en?`Abierta el ${new Date(caja.abierta_en).toLocaleString('es-PY',{timeZone:'America/Asuncion'})}`:'Abrí una caja para registrar pagos.'}</p>
        {abierta?<div className="cash-form"><button className="primary-button" onClick={()=>{setCounts(emptyCounts());setSaved(null);setModalError('');setReview(true)}}>Cerrar caja</button></div>
          :<div className="cash-form"><Field label="Monto inicial (₲)"><input type="number" min="0" value={initial} onChange={e=>setInitial(e.target.value)}/></Field><button className="primary-button" onClick={()=>run(()=>api('/caja/abrir',{method:'POST',body:JSON.stringify({monto_inicial_gs:initial})}),'Caja abierta')}>Abrir caja</button></div>}
      </div>
      <div className="card"><div className="card-head"><div><span className="eyebrow">RESUMEN DEL TURNO</span><h2>Movimientos</h2></div></div>{abierta?<div className="cash-totals"><div><span>Fondo inicial</span><b>{gs(caja.monto_inicial_gs)}</b></div>{caja.totales?.map((x:any)=><div key={x.idforma_pago}><span>{x.forma_pago_nombre} · {x.es_efectivo?'Efectivo':'No efectivo'}</span><b>{gs(x.total_gs)}</b></div>)}</div>:<p>No hay una caja abierta en este momento.</p>}</div>
    </div>}
    {review&&<div className="modal-backdrop" onMouseDown={closeModal}><div className="modal cash-close-modal" role="dialog" aria-modal="true" aria-labelledby="cash-close-title" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><h2 id="cash-close-title">{saved?'Caja cerrada':'Conteo de efectivo'}</h2><button type="button" className="icon-button" onClick={closeModal} disabled={busy} aria-label="Cerrar"><X size={20}/></button></div>
      {saved?<><p className="cash-close-success">La caja #{saved.idcaja} quedó cerrada. El total contado fue {gs(saved.monto_cierre_gs)}.</p><p>Diferencia al cierre: <b>{gs(saved.cierre_comprobante?.diferencia_gs)}</b></p>
        {modalError&&<div className="form-error" role="alert">{modalError}</div>}
        <div className="modal-actions"><button className="ghost-button" onClick={closeModal} disabled={busy}>Cerrar</button><button className="primary-button" onClick={()=>void reprint()} disabled={busy}>{busy?'Abriendo ticket…':'Imprimir ticket'}</button></div></>
      :<><p>Ingresá la cantidad de cada billete físico en la caja.</p><div className="cash-count-list">
        {denominations.map(d=><div className="cash-count-row" key={d}><label htmlFor={`cash-count-${d}`}>{gs(d)}</label><input id={`cash-count-${d}`} type="number" min="0" step="1" required value={counts[d]} onChange={e=>setCounts({...counts,[d]:e.target.value})} disabled={busy}/><strong>{/^\d+$/.test(counts[d])?gs(BigInt(d)*BigInt(counts[d])):'—'}</strong></div>)}
      </div><div className="cash-count-summary"><div><span>Efectivo esperado</span><b>{gs(expected)}</b></div><div><span>Total contado</span><b>{total===null?'—':gs(total)}</b></div><div><span>Diferencia</span><b>{total===null?'—':gs(total-expected)}</b></div></div>
      {modalError&&<div className="form-error" role="alert">{modalError}</div>}
      <div className="modal-actions"><button type="button" className="ghost-button" onClick={closeModal} disabled={busy}>Cancelar</button><button type="button" className="ghost-button" onClick={()=>void save(false)} disabled={busy||!valid}>{busy?'Guardando…':'Guardar'}</button><button type="button" className="primary-button" onClick={()=>void save(true)} disabled={busy||!valid}>{busy?'Guardando…':'Imprimir ticket'}</button></div></>}
    </div></div>}
  </>;
}
