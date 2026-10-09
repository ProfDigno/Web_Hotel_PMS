import { useEffect, useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { api } from './api';

type PaymentMethod={idforma_pago:string;nombre:string;descripcion:string|null;es_efectivo:boolean;activo:boolean;utilizada?:boolean};
type Form={nombre:string;descripcion:string;es_efectivo:boolean;activo:boolean};
function useMethods(path:string,refresh:number) {
  const [data,setData]=useState<PaymentMethod[]|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{let live=true;setError('');setLoading(true);
    api<PaymentMethod[]>(path).then(rows=>{if(live){setData(rows);setLoading(false)}}).catch(e=>{if(live){setError(e.message);setLoading(false)}});
    return()=>{live=false};
  },[path,refresh]);
  return {data,error,loading};
}

export function PaymentMethodButtons({value,onChange,refresh}:{value:string;onChange:(id:string)=>void;refresh:number}) {
  const {data,error,loading}=useMethods('/formas-pago',refresh);
  useEffect(()=>{
    if(!data||loading||data.some(method=>String(method.idforma_pago)===value))return;
    const cash=data.find(method=>method.es_efectivo&&method.nombre.trim().toLocaleLowerCase('es')==='efectivo')
      ??data.find(method=>method.es_efectivo);
    if(cash)onChange(String(cash.idforma_pago));
    else if(value)onChange('');
  },[data,loading,value,onChange]);
  return <>
    <div className="payment-method-buttons" role="group" aria-label="Forma de pago">
      {data?.map(method=><button type="button" key={method.idforma_pago} className={`payment-method-button${String(method.idforma_pago)===value?' selected':''}`} aria-pressed={String(method.idforma_pago)===value} disabled={loading||Boolean(error)} onClick={()=>onChange(String(method.idforma_pago))}>{method.nombre}</button>)}
    </div>
    {loading&&<span>Cargando formas de pago…</span>}
    {error&&<span className="form-error" role="alert">{error}</span>}
    {!loading&&!error&&!data?.length&&<span>No hay formas de pago activas.</span>}
  </>;
}

export function PaymentMethodFilterButtons({value,onChange,options,allLabel='Todas'}:{value:string;onChange:(id:string)=>void;options:{idforma_pago:string;nombre:string;activo?:boolean}[]|undefined;allLabel?:string}) {
  return <div className="payment-method-buttons payment-method-filter-buttons" role="group" aria-label="Filtrar por forma de pago">
    <button type="button" className={`payment-method-button${value===''?' selected':''}`} aria-pressed={value===''} onClick={()=>onChange('')}>{allLabel}</button>
    {options?.map(method=><button type="button" key={method.idforma_pago} className={`payment-method-button${String(method.idforma_pago)===value?' selected':''}`} aria-pressed={String(method.idforma_pago)===value} onClick={()=>onChange(String(method.idforma_pago))}>{method.nombre}{method.activo===false?' (inactiva)':''}</button>)}
  </div>;
}

export function PaymentMethods({refresh,run}:{refresh:number;run:any}) {
  const {data,error,loading}=useMethods('/formas-pago/admin',refresh);
  const [editing,setEditing]=useState<PaymentMethod|'new'|null>(null),[saving,setSaving]=useState(''),[actionError,setActionError]=useState('');
  async function toggle(row:PaymentMethod,activo:boolean) {
    setSaving(String(row.idforma_pago));setActionError('');
    try { await run(async()=>{
      try {await api('/formas-pago/'+row.idforma_pago,{method:'PATCH',body:JSON.stringify({activo})})}
      catch(e:any){setActionError(e.message);throw e}
    },activo?'Forma de pago activada':'Forma de pago desactivada'); } finally {setSaving('')}
  }
  return <section className="card table-card" aria-busy={loading}>
    <div className="card-head payment-methods-head"><div><span className="eyebrow">CONFIGURACIÓN</span><h2>Formas de pago</h2></div>
      <button className="primary-button" onClick={()=>setEditing('new')}><Plus size={17}/> Nueva forma de pago</button>
    </div>
    {(error||actionError)&&<div className="form-error" role="alert">{error||actionError}</div>}
    {loading&&<div className="empty"><p>Cargando formas de pago…</p></div>}
    {!loading&&data&&<div className="table-wrap types-table-wrap"><table className="types-table">
      <thead><tr><th>Nombre</th><th>Descripción</th><th>Cuenta como efectivo</th><th>Activo</th><th>Acciones</th></tr></thead>
      <tbody>{data.map(f=><tr key={f.idforma_pago} className={!f.activo?'inactive-row':''}>
        <td><strong>{f.nombre}</strong></td><td>{f.descripcion||'—'}</td><td>{f.es_efectivo?'Sí':'No'}</td>
        <td><label className="active-toggle"><input type="checkbox" aria-label={'Activo: '+f.nombre} checked={f.activo} disabled={Boolean(saving)} onChange={e=>toggle(f,e.target.checked)}/><span>{f.activo?'Activo':'Inactivo'}</span></label></td>
        <td><button className="small-button" disabled={Boolean(saving)} onClick={()=>setEditing(f)}><Pencil size={14}/> Editar</button></td>
      </tr>)}</tbody>
    </table>{!data.length&&<div className="empty"><p>No hay formas de pago registradas.</p></div>}</div>}
    {editing&&<PaymentMethodModal key={editing==='new'?'new':editing.idforma_pago} existing={editing==='new'?null:editing} onClose={()=>setEditing(null)} run={run}/>}
  </section>;
}

function PaymentMethodModal({existing,onClose,run}:{existing:PaymentMethod|null;onClose:()=>void;run:any}) {
  const [form,setForm]=useState<Form>({nombre:existing?.nombre||'',descripcion:existing?.descripcion||'',es_efectivo:existing?.es_efectivo??false,activo:existing?.activo??true});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy)onClose()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[busy,onClose]);
  async function submit(e:React.FormEvent) {
    e.preventDefault();if(!form.nombre.trim()){setError('Nombre es obligatorio');return}
    setBusy(true);setError('');
    try {await run(async()=>{
      try {await api(existing?'/formas-pago/'+existing.idforma_pago:'/formas-pago',{method:existing?'PATCH':'POST',body:JSON.stringify({...form,nombre:form.nombre.trim()})});onClose()}
      catch(e:any){setError(e.message);throw e}
    },existing?'Forma de pago actualizada':'Forma de pago creada');} finally{setBusy(false)}
  }
  return <div className="modal-backdrop" onMouseDown={()=>!busy&&onClose()}><div className="modal" role="dialog" aria-modal="true" aria-label={existing?'Editar forma de pago':'Nueva forma de pago'} onMouseDown={e=>e.stopPropagation()}>
    <div className="modal-head"><h2>{existing?'Editar forma de pago':'Nueva forma de pago'}</h2><button className="icon-button" disabled={busy} aria-label="Cerrar" onClick={onClose}><X size={18}/></button></div>
    <form onSubmit={submit}><fieldset disabled={busy} className="payment-method-fields">
      <label className="field"><span>Nombre</span><input required autoFocus value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})}/></label>
      <label className="field"><span>Descripción</span><textarea value={form.descripcion} onChange={e=>setForm({...form,descripcion:e.target.value})}/></label>
      <label className="active-toggle"><input type="checkbox" disabled={Boolean(existing?.utilizada)} checked={form.es_efectivo} onChange={e=>setForm({...form,es_efectivo:e.target.checked})}/><span>Cuenta como efectivo</span></label>
      {existing?.utilizada&&<p className="payment-method-note">La clasificación no se puede cambiar porque esta forma ya tiene pagos registrados.</p>}
      <label className="active-toggle"><input type="checkbox" checked={form.activo} onChange={e=>setForm({...form,activo:e.target.checked})}/><span>Activo</span></label>
    </fieldset>{error&&<div className="form-error" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="ghost-button" disabled={busy} onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy}>{busy?'Guardando…':existing?'Guardar cambios':'Crear forma de pago'}</button></div>
    </form>
  </div></div>;
}
