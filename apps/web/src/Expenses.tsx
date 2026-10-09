import { AmountInput } from './AmountInput';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { api, gs, today } from './api';
import { PaymentMethodButtons, PaymentMethodFilterButtons } from './PaymentMethods';
import { Pagination, type PageResult } from './Pagination';
import './expenses.css';
import { useCan } from './usePermissions';

const ExpenseAnalysis=lazy(()=>import('./ExpenseAnalysis').then(m=>({default:m.ExpenseAnalysis})));
export type ExpenseTab='gasto'|'tipo'|'analisis';
export type ExpenseType={idgasto_tipo:string;nombre:string;activo:boolean};
export type Expense={idgasto:string;fecha_gasto:string;tipo_nombre:string;descripcion:string;monto_gs:string;forma_pago_nombre:string;fk_idcaja:string;anulado:boolean;motivo_anulacion:string|null;anulado_por:string|null;fecha_anulado:string|null;fecha_creado:string;creado_por:string};
export type ExpenseOptions={tipos:ExpenseType[];formas_pago:{idforma_pago:string;nombre:string;activo:boolean}[]};
export type ExpenseFilters={desde:string;hasta:string;tipo:string;forma_pago:string;estado:string;q:string};
type Props={refresh:number;run:any};
export function useExpenseData<T>(path:string|null,refresh:number){
  const [state,setState]=useState<{path:string|null;refresh:number;data:T|null;error:string;loading:boolean}>({path:null,refresh:-1,data:null,error:'',loading:false});
  useEffect(()=>{let live=true;setState({path,refresh,data:null,error:'',loading:!!path});if(path)api<T>(path).then(data=>{if(live)setState({path,refresh,data,error:'',loading:false})}).catch(e=>{if(live)setState({path,refresh,data:null,error:e.message,loading:false})});return()=>{live=false};},[path,refresh]);
  return state.path===path&&state.refresh===refresh?state:{data:null,error:'',loading:!!path};
}
export const initialExpenseFilters=():ExpenseFilters=>({desde:today().slice(0,7)+'-01',hasta:today(),tipo:'',forma_pago:'',estado:'todos',q:''});
export const expenseQuery=(f:ExpenseFilters)=>new URLSearchParams(Object.entries(f).filter(([,value])=>value!=='')).toString();
export function ExpenseFilterFields({filters:f,onChange,options,analysis=false}:{filters:ExpenseFilters;onChange:(f:ExpenseFilters)=>void;options:ExpenseOptions|null;analysis?:boolean}){
  return <div className={"expense-filters card"+(analysis?" expense-analysis-filters":"")}><label className="field"><span>Fecha desde</span><input type="date" value={f.desde} onChange={e=>onChange({...f,desde:e.target.value})}/></label><label className="field"><span>Fecha hasta</span><input type="date" value={f.hasta} onChange={e=>onChange({...f,hasta:e.target.value})}/></label>
    <label className="field"><span>Tipo de gasto</span><select value={f.tipo} onChange={e=>onChange({...f,tipo:e.target.value})}><option value="">Todos los tipos</option>{options?.tipos.map(t=><option key={t.idgasto_tipo} value={t.idgasto_tipo}>{t.nombre}{!t.activo?' (inactivo)':''}</option>)}</select></label>
    <div className="field"><span>Forma de pago</span><PaymentMethodFilterButtons value={f.forma_pago} onChange={value=>onChange({...f,forma_pago:value})} options={options?.formas_pago} allLabel="Todas las formas"/></div>
    {!analysis&&<><label className="field"><span>Estado</span><select value={f.estado} onChange={e=>onChange({...f,estado:e.target.value})}><option value="todos">Todos</option><option value="vigente">Vigente</option><option value="anulado">Anulado</option></select></label><label className="field"><span>Descripción</span><input type="search" placeholder="Buscar gasto…" value={f.q} onChange={e=>onChange({...f,q:e.target.value})}/></label></>}
  </div>;
}
function Dialog({title,busy,onClose,children}:{title:string;busy:boolean;onClose:()=>void;children:ReactNode}){
  useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy)onClose()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[busy,onClose]);
  return <div className="modal-backdrop" onMouseDown={()=>!busy&&onClose()}><div className="modal expense-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button className="icon-button" disabled={busy} aria-label="Cerrar" onClick={onClose}><X size={18}/></button></div>{children}</div></div>;
}
function Actions({busy,onClose,label,disabled=false}:{busy:boolean;onClose:()=>void;label:string;disabled?:boolean}){return <div className="modal-actions"><button className="ghost-button" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy||disabled}>{busy?'Guardando…':label}</button></div>}
export function Expenses({tab,role,...props}:Props&{tab:ExpenseTab;role:string}){
  void role;const can=useCan();
  if(tab==='tipo')return can('expenses.types')?<ExpenseTypes {...props}/>:null;
  if(tab==='analisis')return can('expenses.analysis')?<Suspense fallback={<div className="card empty">Cargando análisis…</div>}><ExpenseAnalysis refresh={props.refresh}/></Suspense>:null;
  return can('expenses.list')?<ExpenseList {...props}/>:null;
}
function ExpenseTypes({refresh,run}:Props){
  const can=useCan();
  const {data,error,loading}=useExpenseData<ExpenseType[]>('/gastos-tipos?todos=1',refresh);
  const [editing,setEditing]=useState<ExpenseType|'new'|null>(null),[busy,setBusy]=useState(false);
  return <section className="card table-card"><div className="card-head"><div><span className="eyebrow">GASTO</span><h2>Gasto tipo</h2></div>{can('expenses.type_form')&&<button className="primary-button" onClick={()=>setEditing('new')}><Plus size={17}/> Nuevo tipo</button>}</div>{error&&<div className="form-error" role="alert">{error}</div>}{loading&&<div className="empty">Cargando tipos…</div>}{data&&<><div className="table-wrap"><table className="types-table"><thead><tr><th>Nombre</th><th>Activo</th><th>Acciones</th></tr></thead><tbody>{data.map(t=><tr key={t.idgasto_tipo} className={!t.activo?'inactive-row':''}><td><strong>{t.nombre}</strong></td><td><label className="active-toggle"><input type="checkbox" checked={t.activo} disabled={!can('expenses.type_form')||busy} aria-label={'Activo: '+t.nombre} onChange={async e=>{const activo=e.target.checked;setBusy(true);try{await run(()=>api('/gastos-tipos/'+t.idgasto_tipo,{method:'PATCH',body:JSON.stringify({activo})}))}finally{setBusy(false)}}}/><span>{t.activo?'Activo':'Inactivo'}</span></label></td><td>{can('expenses.type_form')&&<button className="small-button" disabled={busy} onClick={()=>setEditing(t)}><Pencil size={14}/> Editar</button>}</td></tr>)}</tbody></table></div>{!data.length&&<div className="empty">No hay tipos de gasto. Creá el primero para registrar gastos.</div>}</>}{can('expenses.type_form')&&editing&&<TypeForm existing={editing==='new'?null:editing} onClose={()=>setEditing(null)} run={run}/>}</section>;
}
function TypeForm({existing,onClose,run}:{existing:ExpenseType|null;onClose:()=>void;run:any}){
  const [nombre,setName]=useState(existing?.nombre||''),[activo,setActive]=useState(existing?.activo??true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Dialog title={existing?'Editar tipo de gasto':'Nuevo tipo de gasto'} busy={busy} onClose={onClose}><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await run(async()=>{try{await api('/gastos-tipos'+(existing?'/'+existing.idgasto_tipo:''),{method:existing?'PATCH':'POST',body:JSON.stringify({nombre,activo})});onClose()}catch(e:any){setError(e.message);throw e}})}finally{setBusy(false)}}}><fieldset disabled={busy}><label className="field"><span>Nombre</span><input required autoFocus value={nombre} onChange={e=>setName(e.target.value)}/></label><label className="active-toggle"><input type="checkbox" checked={activo} onChange={e=>setActive(e.target.checked)}/><span>Activo</span></label></fieldset>{error&&<div className="form-error" role="alert">{error}</div>}<Actions busy={busy} onClose={onClose} label="Guardar tipo"/></form></Dialog>;
}
function ExpenseList({refresh,run}:Props){
  const can=useCan();
  const [filters,setFilters]=useState(initialExpenseFilters),[page,setPage]=useState(1),[dialog,setDialog]=useState<'new'|Expense|null>(null),[detail,setDetail]=useState<Expense|null>(null);
  const options=useExpenseData<ExpenseOptions>('/gastos/opciones',refresh),cash=useExpenseData<{idcaja:string}|null>('/caja',refresh);
  const valid=!(filters.desde&&filters.hasta&&filters.desde>filters.hasta);
  const {data,error,loading}=useExpenseData<PageResult<Expense>>(valid?'/gastos?'+expenseQuery(filters)+'&pagina='+page:null,refresh);
  return <div className="expenses"><div className="page-head"><div><span className="eyebrow">FINANZAS</span><h1>Gasto</h1><p>Registrá y consultá los egresos del hotel.</p></div>{can('expenses.new')&&<button className="primary-button" disabled={!cash.data||options.loading||!!options.error} onClick={()=>setDialog('new')}><Plus size={17}/> Nuevo gasto</button>}</div>
    {cash.error&&<div className="form-error" role="alert">{cash.error}</div>}{!cash.loading&&!cash.error&&!cash.data&&<div className="card expense-notice">No hay caja abierta. Abrí una caja para registrar gastos.</div>}{options.error&&<div className="form-error" role="alert">{options.error}</div>}
    <ExpenseFilterFields filters={filters} options={options.data} onChange={f=>{setFilters(f);setPage(1)}}/>{!valid&&<div className="form-error" role="alert">La fecha hasta debe ser igual o posterior a la fecha desde.</div>}
    <section className="card table-card" aria-busy={loading}>{error&&<div className="form-error" role="alert">{error}</div>}{loading&&<div className="empty">Cargando gastos…</div>}{data&&<><ExpenseTable rows={data.registros} action={r=><div className="expense-actions"><button className="small-button" onClick={()=>setDetail(r)}>Ver detalle</button>{!r.anulado&&can('expenses.annul')&&<button className="small-button danger" onClick={()=>setDialog(r)}>Anular</button>}</div>}/>{!data.registros.length&&<div className="empty">No hay gastos para los filtros seleccionados.</div>}</>}<Pagination page={page} total={data?.total??0} loading={loading} disabled={!!error||!valid} onChange={setPage}/></section>
    {can('expenses.new')&&dialog==='new'&&<ExpenseForm refresh={refresh} run={run} onClose={()=>setDialog(null)}/>} {can('expenses.annul')&&dialog&&dialog!=='new'&&<AnnulExpense expense={dialog} run={run} onClose={()=>setDialog(null)}/>}
    {detail&&<Dialog title={'Gasto #'+detail.idgasto} busy={false} onClose={()=>setDetail(null)}><dl className="expense-detail"><dt>Fecha del gasto</dt><dd>{detail.fecha_gasto}</dd><dt>Tipo</dt><dd>{detail.tipo_nombre}</dd><dt>Descripción</dt><dd>{detail.descripcion}</dd><dt>Monto</dt><dd>{gs(detail.monto_gs)}</dd><dt>Forma de pago</dt><dd>{detail.forma_pago_nombre}</dd><dt>Caja</dt><dd>#{detail.fk_idcaja}</dd><dt>Registrado por</dt><dd>{detail.creado_por} · {new Date(detail.fecha_creado).toLocaleString('es-PY',{timeZone:'America/Asuncion'})}</dd><dt>Estado</dt><dd>{detail.anulado?'Anulado':'Vigente'}</dd>{detail.anulado&&<><dt>Anulación</dt><dd>{detail.motivo_anulacion} · {detail.anulado_por} · {detail.fecha_anulado&&new Date(detail.fecha_anulado).toLocaleString('es-PY',{timeZone:'America/Asuncion'})}</dd></>}</dl></Dialog>}
  </div>;
}
export function ExpenseTable({rows,action}:{rows:Expense[];action?:(row:Expense)=>ReactNode}){return <div className="table-wrap"><table className="types-table expense-table"><thead><tr><th>Número</th><th>Fecha del gasto</th><th>Tipo</th><th>Descripción</th><th>Monto</th><th>Forma de pago</th><th>Caja</th><th>Estado</th>{action&&<th>Acciones</th>}</tr></thead><tbody>{rows.map(r=><tr key={r.idgasto} className={r.anulado?'inactive-row':''}><td>#{r.idgasto}</td><td>{r.fecha_gasto}</td><td>{r.tipo_nombre}</td><td className="expense-description">{r.descripcion}</td><td>{gs(r.monto_gs)}</td><td>{r.forma_pago_nombre}</td><td>#{r.fk_idcaja}</td><td><span className={'badge '+(r.anulado?'status-rechazado':'status-en_casa')}>{r.anulado?'Anulado':'Vigente'}</span></td>{action&&<td>{action(r)}</td>}</tr>)}</tbody></table></div>}
function ExpenseForm({refresh,run,onClose}:Props&{onClose:()=>void}){
  const types=useExpenseData<ExpenseType[]>('/gastos-tipos',refresh);
  const [form,setForm]=useState({fecha_gasto:today(),fk_idgasto_tipo:'',descripcion:'',monto_gs:'',fk_idforma_pago:''}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Dialog title="Nuevo gasto" busy={busy} onClose={onClose}><p>El egreso se registrará ahora en la caja abierta, aunque el gasto sea de una fecha anterior.</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await run(async()=>{try{await api('/gastos',{method:'POST',body:JSON.stringify(form)});onClose()}catch(e:any){setError(e.message);throw e}})}finally{setBusy(false)}}}><fieldset disabled={busy}>
    <label className="field"><span>Fecha del gasto</span><input type="date" required max={today()} value={form.fecha_gasto} onChange={e=>setForm({...form,fecha_gasto:e.target.value})}/></label>
    <label className="field"><span>Tipo de gasto</span><select required autoFocus disabled={types.loading||!types.data?.length} value={form.fk_idgasto_tipo} onChange={e=>setForm({...form,fk_idgasto_tipo:e.target.value})}><option value="">Seleccionar tipo</option>{types.data?.map(t=><option key={t.idgasto_tipo} value={t.idgasto_tipo}>{t.nombre}</option>)}</select></label>{types.error&&<div className="form-error">{types.error}</div>}{!types.loading&&!types.error&&!types.data?.length&&<p>No hay tipos activos. Solicitá a administración que cree uno.</p>}
    <label className="field"><span>Descripción</span><textarea required value={form.descripcion} onChange={e=>setForm({...form,descripcion:e.target.value})}/></label>
    <label className="field"><span>Monto del gasto (₲)</span><AmountInput required min={1} value={form.monto_gs} onChange={value=>setForm({...form,monto_gs:value})}/></label>
    <div className="field"><span>Forma de pago</span><PaymentMethodButtons refresh={refresh} value={form.fk_idforma_pago} onChange={id=>setForm(f=>({...f,fk_idforma_pago:id}))}/></div>
  </fieldset>{error&&<div className="form-error" role="alert">{error}</div>}<Actions busy={busy} disabled={!types.data?.length||!form.fk_idforma_pago} onClose={onClose} label="Registrar gasto"/></form></Dialog>;
}
function AnnulExpense({expense,run,onClose}:{expense:Expense;run:any;onClose:()=>void}){
  const [motivo,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Dialog title={'Anular gasto #'+expense.idgasto} busy={busy} onClose={onClose}><p>{expense.descripcion} · {gs(expense.monto_gs)}</p><p>El gasto y su egreso quedarán anulados. Si la caja está cerrada, se conservará el cierre original y se mostrará el ajuste posterior.</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await run(async()=>{try{await api('/gastos/'+expense.idgasto+'/anular',{method:'POST',body:JSON.stringify({motivo})});onClose()}catch(e:any){setError(e.message);throw e}})}finally{setBusy(false)}}}><label className="field"><span>Motivo de anulación</span><textarea autoFocus required disabled={busy} value={motivo} onChange={e=>setReason(e.target.value)}/></label>{error&&<div className="form-error" role="alert">{error}</div>}<Actions busy={busy} onClose={onClose} label="Confirmar anulación"/></form></Dialog>;
}
