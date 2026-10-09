import { AmountInput } from './AmountInput';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Search, X } from 'lucide-react';
import { api, BASE, gs } from './api';
import { PaymentMethodButtons } from './PaymentMethods';
import { Pagination } from './Pagination';
import './sales.css';
import { useCan } from './usePermissions';
const SalesAnalytics=lazy(()=>import('./SalesAnalytics').then(module=>({default:module.SalesAnalytics})));

export type SalesTab='venta'|'historial'|'analisis'|'categoria'|'producto'|'inventario';
type Props={tab:SalesTab;refresh:number;run:(fn:()=>Promise<any>,success?:string,keepModal?:boolean)=>Promise<void>;role:string};
type Category={idcategoria_producto:string;nombre:string;orden:number;activo:boolean};
type Product={idproducto:string;fk_idcategoria_producto:string;categoria_nombre:string;categoria_activa:boolean;nombre:string;precio_venta:string;precio_compra:string;stock_actual:number;stock_minimo:number;descontar_stock:boolean;es_vender:boolean;es_comprar:boolean;es_cocina:boolean;activo:boolean};
type Room={idhabitacion:string;numero:string;idreserva:string;cliente_nombre:string;cliente_apellido:string|null};
type Item={product:Product;cantidad:number;pago_inicial:'pagado'|'pendiente'};
type Sale={idventa:string;fk_idreserva:string|null;habitacion_numero:string|null;cliente_nombre:string|null;cliente_apellido:string|null;destino:string;total_gs:string;pagado_inicial_gs:string;saldo_reserva_gs:string;anulado:boolean;fecha_creado:string};
type Inventory={productos:Product[];movimientos:any[]};
const Field=({label,children}:{label:string;children:React.ReactNode})=><label className="field"><span>{label}</span>{children}</label>;
const Modal=({title,children,onClose,className=''}:{title:string;children:React.ReactNode;onClose:()=>void;className?:string})=><div className="modal-backdrop" onMouseDown={onClose}><div className={`modal ${className}`} onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={19}/></button></div>{children}</div></div>;
const Empty=({text}:{text:string})=><div className="empty"><p>{text}</p></div>;
function useData<T>(path:string,refresh:number){const[data,setData]=useState<T|null>(null),[error,setError]=useState('');useEffect(()=>{let live=true;api<T>(path).then(x=>{if(live){setData(x);setError('')}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[path,refresh]);return{data,error};}
const yes=(v:boolean)=>v?'Sí':'No';

export function Sales({tab,refresh,run,role}:Props){
  const can=useCan();
  if(!can(({venta:'sales.new',historial:'sales.history',analisis:'sales.analysis',categoria:'sales.categories',producto:'sales.products',inventario:'sales.inventory'} as const)[tab]))return null;
  if(tab==='historial')return <SalesHistory refresh={refresh} run={run} role={role}/>;
  if(tab==='analisis')return <Suspense fallback={<div className="card empty"><p>Cargando gráficos de ventas…</p></div>}><SalesAnalytics refresh={refresh}/></Suspense>;
  if(tab==='categoria')return <Categories refresh={refresh} run={run}/>;
  if(tab==='producto')return <Products refresh={refresh} run={run}/>;
  if(tab==='inventario')return <InventoryPage refresh={refresh} run={run}/>;
  return <SalesPage refresh={refresh} run={run}/>;
}

function Categories({refresh,run}:{refresh:number;run:Props['run']}){
  const can=useCan();
  const{data,error}=useData<Category[]>('/ventas/categorias?admin=1',refresh),[edit,setEdit]=useState<Category|false|null>(null),[name,setName]=useState('');
  const open=(c:Category|false)=>{setEdit(c);setName(c?c.nombre:'')};
  return <><div className="card table-card"><div className="card-head"><div><span className="eyebrow">VENTA</span><h2>Categorías de producto</h2></div>{can('sales.category_form')&&<button className="primary-button" onClick={()=>open(false)}><Plus size={17}/> Nueva categoría</button>}</div>{error&&<div className="form-error">{error}</div>}<div className="table-wrap types-table-wrap"><table className="types-table"><thead><tr><th>Orden</th><th>Nombre</th><th>Activo</th><th>Acciones</th></tr></thead><tbody>{data?.map((c,i)=><tr key={c.idcategoria_producto} className={!c.activo?'inactive-row':''}><td>{i+1}</td><td><strong>{c.nombre}</strong></td><td><label className="active-toggle"><input type="checkbox" checked={c.activo} disabled={!can('sales.category_form')} onChange={e=>run(()=>api(`/ventas/categorias/${c.idcategoria_producto}`,{method:'PATCH',body:JSON.stringify({activo:e.target.checked})}),e.target.checked?'Categoría activada':'Categoría desactivada',true)}/><span>{c.activo?'Activo':'Inactivo'}</span></label></td><td><div className="sale-row-actions">{can('sales.category_form')&&<><button className="small-button" disabled={i===0} title="Subir" aria-label={`Subir ${c.nombre}`} onClick={()=>run(()=>api(`/ventas/categorias/${c.idcategoria_producto}/mover`,{method:'POST',body:JSON.stringify({direccion:'subir'})}),'Orden actualizado',true)}><ArrowUp size={14}/></button><button className="small-button" disabled={i===data.length-1} title="Bajar" aria-label={`Bajar ${c.nombre}`} onClick={()=>run(()=>api(`/ventas/categorias/${c.idcategoria_producto}/mover`,{method:'POST',body:JSON.stringify({direccion:'bajar'})}),'Orden actualizado',true)}><ArrowDown size={14}/></button><button className="small-button" onClick={()=>open(c)}><Pencil size={14}/> Editar</button></>}</div></td></tr>)}</tbody></table>{!data?.length&&!error&&<Empty text="Todavía no hay categorías"/>}</div></div>{can('sales.category_form')&&edit!==null&&<Modal title={edit?'Editar categoría':'Nueva categoría'} onClose={()=>setEdit(null)}><form onSubmit={e=>{e.preventDefault();run(async()=>{await api(edit?`/ventas/categorias/${edit.idcategoria_producto}`:'/ventas/categorias',{method:edit?'PATCH':'POST',body:JSON.stringify({nombre:name})});setEdit(null)},edit?'Categoría actualizada':'Categoría creada',true)}}><Field label="Nombre"><input required autoFocus value={name} onChange={e=>setName(e.target.value)}/></Field><div className="modal-actions"><button type="button" className="ghost-button" onClick={()=>setEdit(null)}>Cancelar</button><button className="primary-button">{edit?'Guardar cambios':'Crear categoría'}</button></div></form></Modal>}</>;
}

const defaults={fk_idcategoria_producto:'',nombre:'',precio_venta:'',precio_compra:'',stock_actual:'0',stock_minimo:'0',descontar_stock:true,es_vender:true,es_comprar:false,es_cocina:false,activo:true};
function Products({refresh,run}:{refresh:number;run:Props['run']}){
  const can=useCan();
  const{data,error}=useData<Product[]>('/ventas/productos?admin=1',refresh),{data:categories}=useData<Category[]>('/ventas/categorias?admin=1',refresh),[edit,setEdit]=useState<Product|false|null>(null),[form,setForm]=useState<any>(defaults),[search,setSearch]=useState(''),[page,setPage]=useState(1);
  const filtered=useMemo(()=>data?.filter(p=>`${p.nombre} ${p.categoria_nombre}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))||[],[data,search]);
  const visible=filtered.slice((page-1)*50,page*50);
  useEffect(()=>setPage(1),[search]);
  const open=(p:Product|false)=>{setEdit(p);setForm(p?{...p,stock_actual:String(p.stock_actual),stock_minimo:String(p.stock_minimo)}:defaults)};
  return <><div className="card table-card"><div className="card-head"><div><span className="eyebrow">VENTA</span><h2>Productos</h2></div>{can('sales.product_form')&&<button className="primary-button" onClick={()=>open(false)}><Plus size={17}/> Nuevo producto</button>}</div><div className="table-toolbar sale-product-toolbar"><label className="searchbox"><Search size={17}/><input placeholder="Buscar por nombre o categoría" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>{error&&<div className="form-error">{error}</div>}<div className="table-wrap types-table-wrap"><table className="types-table sale-products-table"><thead><tr><th>Nombre</th><th>Categoría</th><th>Precio venta</th><th>Stock actual</th><th>Activo</th><th>Acciones</th></tr></thead><tbody>{visible.map(p=><tr key={p.idproducto} className={!p.activo?'inactive-row':''}><td><strong>{p.nombre}</strong></td><td>{p.categoria_nombre}</td><td>{gs(p.precio_venta)}</td><td>{p.stock_actual}</td><td><label className="active-toggle"><input type="checkbox" checked={p.activo} disabled={!can('sales.product_form')} onChange={e=>run(()=>api(`/ventas/productos/${p.idproducto}`,{method:'PATCH',body:JSON.stringify({activo:e.target.checked})}),e.target.checked?'Producto activado':'Producto desactivado',true)}/><span>{p.activo?'Activo':'Inactivo'}</span></label></td><td>{can('sales.product_form')&&<button className="small-button" onClick={()=>open(p)}><Pencil size={14}/> Editar</button>}</td></tr>)}</tbody></table>{!visible.length&&!error&&<Empty text={search?'No se encontraron productos':'Todavía no hay productos'}/>}</div><Pagination page={page} total={filtered.length} loading={!data&&!error} onChange={setPage}/></div>{can('sales.product_form')&&edit!==null&&<Modal title={edit?'Editar producto':'Nuevo producto'} onClose={()=>setEdit(null)}><form onSubmit={e=>{e.preventDefault();const body={...form};if(edit)delete body.stock_actual;run(async()=>{await api(edit?`/ventas/productos/${edit.idproducto}`:'/ventas/productos',{method:edit?'PATCH':'POST',body:JSON.stringify(body)});setEdit(null)},edit?'Producto actualizado':'Producto creado',true)}}><div className="form-grid"><Field label="Categoría"><select required value={form.fk_idcategoria_producto} onChange={e=>setForm({...form,fk_idcategoria_producto:e.target.value})}><option value="">Seleccionar</option>{categories?.map(c=><option key={c.idcategoria_producto} value={c.idcategoria_producto}>{c.nombre}</option>)}</select></Field><Field label="Nombre"><input required value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})}/></Field><Field label="Precio venta (₲)"><AmountInput required value={form.precio_venta} onChange={value=>setForm({...form,precio_venta:value})}/></Field><Field label="Precio compra (₲)"><AmountInput required value={form.precio_compra} onChange={value=>setForm({...form,precio_compra:value})}/></Field>{!edit&&<Field label="Stock inicial"><input required type="number" step="1" value={form.stock_actual} onChange={e=>setForm({...form,stock_actual:e.target.value})}/></Field>}<Field label="Stock mínimo"><input required type="number" min="0" step="1" value={form.stock_minimo} onChange={e=>setForm({...form,stock_minimo:e.target.value})}/></Field></div>{edit&&<p className="sale-form-note">El stock actual se modifica desde Inventario.</p>}<div className="sale-flags">{([['descontar_stock','Descontar stock'],['es_vender','Vender'],['es_comprar','Comprar'],['es_cocina','Cocina']] as const).map(([key,label])=><label className="active-toggle" key={key}><input type="checkbox" checked={Boolean(form[key])} onChange={e=>setForm({...form,[key]:e.target.checked})}/><span>{label}</span></label>)}</div><div className="modal-actions"><button type="button" className="ghost-button" onClick={()=>setEdit(null)}>Cancelar</button><button className="primary-button">{edit?'Guardar cambios':'Crear producto'}</button></div></form></Modal>}</>;
}

function InventoryPage({refresh,run}:{refresh:number;run:Props['run']}){
  const can=useCan();
  const{data,error}=useData<Inventory>('/ventas/inventario',refresh),[edit,setEdit]=useState<Product|null>(null),[stock,setStock]=useState(''),[reason,setReason]=useState('');
  const open=(p:Product)=>{setEdit(p);setStock(String(p.stock_actual));setReason('')};
  return <><div className="card table-card"><div className="card-head"><div><span className="eyebrow">VENTA</span><h2>Inventario</h2></div></div>{error&&<div className="form-error">{error}</div>}<div className="table-wrap types-table-wrap"><table className="types-table"><thead><tr><th>Producto</th><th>Categoría</th><th>Stock actual</th><th>Stock mínimo</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data?.productos.map(p=><tr key={p.idproducto} className={!p.activo?'inactive-row':''}><td><strong>{p.nombre}</strong></td><td>{p.categoria_nombre}</td><td>{p.stock_actual}</td><td>{p.stock_minimo}</td><td>{p.stock_actual<p.stock_minimo?<span className="badge status-pendiente">Bajo mínimo</span>:<span className="badge status-en_casa">Disponible</span>}</td><td>{can('sales.inventory_adjust')&&<button className="small-button" onClick={()=>open(p)}><Pencil size={14}/> Ajustar</button>}</td></tr>)}</tbody></table>{!data?.productos.length&&!error&&<Empty text="Todavía no hay productos"/>}</div></div><div className="card table-card top-space"><div className="card-head"><div><span className="eyebrow">MOVIMIENTOS</span><h2>Historial de inventario</h2></div></div><div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Anterior</th><th>Cambio</th><th>Nuevo</th><th>Motivo</th><th>Usuario</th></tr></thead><tbody>{data?.movimientos.map(m=><tr key={m.idinventario_movimiento}><td>{new Date(m.fecha_creado).toLocaleString('es-PY')}</td><td>{m.producto_nombre}</td><td>{m.tipo}</td><td>{m.cantidad_anterior}</td><td>{m.delta>0?'+':''}{m.delta}</td><td>{m.cantidad_nueva}</td><td>{m.motivo}</td><td>{m.creado_por}</td></tr>)}</tbody></table>{!data?.movimientos.length&&!error&&<Empty text="Todavía no hay movimientos"/>}</div></div>{can('sales.inventory_adjust')&&edit&&<Modal title={`Ajustar stock · ${edit.nombre}`} onClose={()=>setEdit(null)}><form onSubmit={e=>{e.preventDefault();run(async()=>{await api('/ventas/inventario/ajustes',{method:'POST',body:JSON.stringify({fk_idproducto:edit.idproducto,stock_nuevo:stock,motivo:reason})});setEdit(null)},'Stock actualizado',true)}}><Field label="Stock nuevo"><input required type="number" step="1" value={stock} onChange={e=>setStock(e.target.value)}/></Field><Field label="Motivo"><textarea required value={reason} onChange={e=>setReason(e.target.value)}/></Field><div className="modal-actions"><button type="button" className="ghost-button" onClick={()=>setEdit(null)}>Cancelar</button><button className="primary-button">Guardar ajuste</button></div></form></Modal>}</>;
}

type SaleDraft={items:Item[];room:Room|null;destination:'restaurante'|'habitacion';method:string;methodName:string;total:bigint;paid:bigint};
type SavedSale={idventa:string;total_gs:string;pagado_inicial_gs:string};

async function openSaleTicket(id:string,tab:Window|null){
  const token=localStorage.getItem('pms_token');
  let response:Response;
  try{response=await fetch(`${BASE}/ventas/${id}/ticket`,{headers:token?{Authorization:`Bearer ${token}`}:{}})}
  catch{throw new Error('No se pudo conectar con la API')}
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.message||`Error ${response.status}`)}
  const url=URL.createObjectURL(await response.blob());
  if(tab&&!tab.closed)tab.location.href=url;
  else{const link=document.createElement('a');link.href=url;link.download=`venta-${id}-ticket.pdf`;document.body.appendChild(link);link.click();link.remove()}
  window.setTimeout(()=>URL.revokeObjectURL(url),300000);
}

function SalesPage({refresh,run}:{refresh:number;run:Props['run']}){
  const {data:categories}=useData<Category[]>('/ventas/categorias',refresh);
  const {data:products,error:productError}=useData<Product[]>('/ventas/productos',refresh);
  const {data:rooms}=useData<Room[]>('/ventas/habitaciones-en-casa',refresh);
  const {data:methods}=useData<{idforma_pago:string;nombre:string}[]>('/formas-pago',refresh);
  const [category,setCategory]=useState(''),[search,setSearch]=useState(''),[items,setItems]=useState<Item[]>([]);
  const [room,setRoom]=useState(''),[destination,setDestination]=useState<'restaurante'|'habitacion'>('restaurante'),[method,setMethod]=useState('');
  const [draft,setDraft]=useState<SaleDraft|null>(null),[savedSale,setSavedSale]=useState<SavedSale|null>(null),[savedDetail,setSavedDetail]=useState<SaleDetailData|null>(null);
  const [busy,setBusy]=useState(false),[localError,setLocalError]=useState(''),[confirmError,setConfirmError]=useState('');
  const submissionLock=useRef(false);
  const shown=useMemo(()=>products?.filter(p=>(!category||String(p.fk_idcategoria_producto)===category)&&p.nombre.toLocaleLowerCase().includes(search.toLocaleLowerCase()))||[],[products,category,search]);
  const total=items.reduce((sum,x)=>sum+BigInt(x.product.precio_venta)*BigInt(x.cantidad),0n);
  const paid=items.filter(x=>x.pago_inicial==='pagado').reduce((sum,x)=>sum+BigInt(x.product.precio_venta)*BigInt(x.cantidad),0n);
  const selected=rooms?.find(r=>String(r.idhabitacion)===room)||null;
  const add=(p:Product)=>setItems(current=>{const index=current.findIndex(x=>x.product.idproducto===p.idproducto&&x.pago_inicial==='pagado');if(index<0)return[...current,{product:p,cantidad:1,pago_inicial:'pagado'}];return current.map((x,i)=>i===index?{...x,cantidad:x.cantidad+1}:x)});
  const change=(index:number,patch:Partial<Item>)=>setItems(current=>current.map((x,i)=>i===index?{...x,...patch}:x));
  const openConfirmation=()=>{
    if(!items.length)return;
    if(items.some(x=>x.pago_inicial==='pendiente')&&!selected){setLocalError('Los artículos pendientes requieren una habitación en casa');return}
    if(destination==='habitacion'&&!selected){setLocalError('Elegí una habitación en casa');return}
    if(paid>0n&&!method){setLocalError('Elegí una forma de pago');return}
    setLocalError('');setConfirmError('');setSavedSale(null);setSavedDetail(null);
    setDraft({items:items.map(x=>({...x})),room:selected,destination,method,methodName:methods?.find(x=>String(x.idforma_pago)===method)?.nombre||'',total,paid});
  };
  const closeConfirmation=()=>{if(submissionLock.current)return;setDraft(null);setSavedSale(null);setSavedDetail(null);setConfirmError('')};
  const printSaved=async(id:string,tab:Window|null)=>{
    if(submissionLock.current)return;
    submissionLock.current=true;
    setBusy(true);setConfirmError('');
    try{await openSaleTicket(id,tab)}catch(e:any){if(tab&&!tab.closed)tab.close();setConfirmError(`Venta #${id} guardada. No se pudo abrir el ticket: ${e.message}`)}finally{submissionLock.current=false;setBusy(false)}
  };
  const confirm=async(print:boolean,tab:Window|null)=>{
    if(!draft||submissionLock.current)return;
    if(savedSale){if(print)await printSaved(savedSale.idventa,tab);return}
    submissionLock.current=true;
    setBusy(true);setConfirmError('');
    try{
      const sale=await api<SavedSale>('/ventas',{method:'POST',body:JSON.stringify({fk_idhabitacion:draft.room?.idhabitacion||null,destino:draft.destination,fk_idforma_pago:draft.paid>0n?draft.method:null,items:draft.items.map(x=>({fk_idproducto:x.product.idproducto,cantidad:x.cantidad,pago_inicial:x.pago_inicial}))})});
      setSavedSale(sale);setItems([]);setRoom('');setMethod('');
      await run(async()=>{},`Venta #${sale.idventa} registrada`,true);
      if(print){
        try{await openSaleTicket(sale.idventa,tab);setDraft(null)}
        catch(e:any){if(tab&&!tab.closed)tab.close();setConfirmError(`Venta #${sale.idventa} guardada. No se pudo abrir el ticket: ${e.message}`)}
      }else setDraft(null);
    }catch(e:any){if(tab&&!tab.closed)tab.close();setConfirmError(e.message)}finally{submissionLock.current=false;setBusy(false)}
  };
  const requestPrint=()=>{if(submissionLock.current)return;const tab=window.open('','_blank');void confirm(true,tab)};
  const previewItems=savedDetail?.items.map(x=>({key:x.idventa_item,name:x.nombre_producto,quantity:x.cantidad,unit:x.precio_unitario_gs,payment:x.pago_inicial}))||draft?.items.map((x,i)=>({key:String(i),name:x.product.nombre,quantity:x.cantidad,unit:x.product.precio_venta,payment:x.pago_inicial}))||[];
  const previewTotal=savedSale?BigInt(savedSale.total_gs):draft?.total||0n;
  const previewPaid=savedSale?BigInt(savedSale.pagado_inicial_gs):draft?.paid||0n;
  return <>
    <div className="sale-layout">
      <section className="card sale-catalog">
        <div className="card-head"><div><span className="eyebrow">VENTA</span><h2>Productos</h2></div></div>
        <div className="sale-categories"><button type="button" className={!category?'selected':''} onClick={()=>setCategory('')}>Todos</button>{categories?.map(c=><button type="button" key={c.idcategoria_producto} className={category===String(c.idcategoria_producto)?'selected':''} onClick={()=>setCategory(String(c.idcategoria_producto))}>{c.nombre}</button>)}</div>
        <label className="searchbox sale-search"><Search size={17}/><input placeholder="Buscar producto" value={search} onChange={e=>setSearch(e.target.value)}/></label>
        {productError&&<div className="form-error">{productError}</div>}
        <div className="sale-product-grid">{shown.map(p=><button type="button" className="sale-product" key={p.idproducto} onClick={()=>add(p)}><strong>{p.nombre}</strong><span>{gs(p.precio_venta)}</span><small className={p.stock_actual<p.stock_minimo?'sale-low-stock':''}>Stock: {p.stock_actual}</small></button>)}</div>
        {!shown.length&&!productError&&<Empty text="No hay productos disponibles"/>}
      </section>
      <section className="card sale-cart">
        <div className="card-head"><div><span className="eyebrow">CONSUMICIÓN</span><h2>Venta actual</h2></div></div>
        <div className="sale-destinations"><label><input type="radio" name="destino" checked={destination==='restaurante'} onChange={()=>setDestination('restaurante')}/> Restaurante</label><label><input type="radio" name="destino" checked={destination==='habitacion'} onChange={()=>setDestination('habitacion')}/> Habitación</label></div>
        <Field label="Habitación en casa"><select value={room} onChange={e=>setRoom(e.target.value)}><option value="">Venta sin habitación</option>{rooms?.map(r=><option key={r.idhabitacion} value={r.idhabitacion}>Hab. {r.numero} · {r.cliente_nombre} {r.cliente_apellido||''}</option>)}</select></Field>
        {selected&&<p className="sale-guest">Huésped: <strong>{selected.cliente_nombre} {selected.cliente_apellido}</strong></p>}
        <div className="sale-cart-items">{items.map((x,i)=><div className="sale-cart-item" key={`${x.product.idproducto}-${i}`}>
          <div><strong>{x.product.nombre}</strong><small>{gs(x.product.precio_venta)} c/u</small></div>
          <input aria-label={`Cantidad de ${x.product.nombre}`} type="number" min="1" step="1" value={x.cantidad} onChange={e=>change(i,{cantidad:Math.max(1,Math.trunc(Number(e.target.value)||1))})}/>
          <div className="sale-payment-toggle" role="group" aria-label={`Estado de pago de ${x.product.nombre}`}><button type="button" aria-pressed={x.pago_inicial==='pagado'} className={`sale-payment-button is-paid ${x.pago_inicial==='pagado'?'selected':''}`} onClick={()=>change(i,{pago_inicial:'pagado'})}>Pagado</button><button type="button" aria-pressed={x.pago_inicial==='pendiente'} className={`sale-payment-button is-pending ${x.pago_inicial==='pendiente'?'selected':''}`} onClick={()=>change(i,{pago_inicial:'pendiente'})}>Pendiente</button></div>
          <button type="button" className="icon-button" aria-label={`Quitar ${x.product.nombre}`} onClick={()=>setItems(current=>current.filter((_,j)=>j!==i))}><X size={16}/></button><b>{gs(BigInt(x.product.precio_venta)*BigInt(x.cantidad))}</b>
        </div>)}{!items.length&&<Empty text="Seleccioná productos para iniciar la venta"/>}</div>
        <div className="sale-summary"><div><span>Total</span><strong>{gs(total)}</strong></div><div><span>Pagado ahora</span><b>{gs(paid)}</b></div><div><span>Pendiente</span><b>{gs(total-paid)}</b></div></div>
        {paid>0n&&<div className="field"><span>Forma de pago</span><PaymentMethodButtons value={method} onChange={setMethod} refresh={refresh}/></div>}
        {localError&&<div className="form-error" role="alert">{localError}</div>}
        <button type="button" className="primary-button full" disabled={busy||!items.length||(paid>0n&&!method)} onClick={openConfirmation}>Registrar venta</button>
      </section>
    </div>
    {draft&&<Modal title={savedSale?`Venta #${savedSale.idventa} registrada`:'Confirmar venta'} onClose={closeConfirmation} className="sale-detail-modal sale-confirm-modal">
      <div className="sale-detail-hero"><div><span className="eyebrow">{savedSale?'VENTA GUARDADA':'REVISÁ ANTES DE GUARDAR'}</span><p>{draft.destination==='habitacion'?'Consumo en habitación':'Consumo en restaurante'}</p></div><span className={`sale-detail-status ${previewTotal===previewPaid?'is-paid':'is-pending'}`}>{previewTotal===previewPaid?'Pagada':'Con saldo pendiente'}</span></div>
      <div className="sale-detail-facts"><div><span>Huésped</span><strong>{draft.room?`${draft.room.cliente_nombre} ${draft.room.cliente_apellido||''}`:'Venta sin huésped'}</strong></div><div><span>Habitación</span><strong>{draft.room?`Hab. ${draft.room.numero}`:'Sin habitación'}</strong></div><div><span>Destino</span><strong>{draft.destination==='habitacion'?'Habitación':'Restaurante'}</strong></div><div><span>Forma de pago</span><strong>{previewPaid>0n?draft.methodName:'Sin cobro inicial'}</strong></div>{draft.room&&<div><span>Reserva</span><strong>#{draft.room.idreserva}</strong></div>}<div><span>Fecha</span><strong>{saleDateTime(savedDetail?.fecha_creado||new Date().toISOString())}</strong></div></div>
      <section className="sale-detail-section"><div className="sale-detail-section-head"><div><span className="eyebrow">CONSUMICIÓN</span><h3>Artículos</h3></div><span>{previewItems.reduce((sum,x)=>sum+x.quantity,0)} unidades</span></div><div className="sale-detail-items">{previewItems.map(x=><div className="sale-detail-item" key={x.key}><div><strong>{x.name}</strong><span>{x.quantity} × {gs(x.unit)}</span></div><span className={`sale-detail-item-state ${x.payment==='pagado'?'is-paid':'is-pending'}`}>{x.payment==='pagado'?'Pagado':'Pendiente'}</span><b>{gs(BigInt(x.unit)*BigInt(x.quantity))}</b></div>)}</div></section>
      <div className="sale-detail-amounts"><div><span>Total</span><strong>{gs(previewTotal)}</strong></div><div><span>Pagado ahora</span><b>{gs(previewPaid)}</b></div><div><span>Pendiente</span><b>{gs(previewTotal-previewPaid)}</b></div></div>
      {confirmError&&<div className="form-error" role="alert">{confirmError}</div>}
      <div className="modal-actions sale-confirm-actions">{savedSale?<><button type="button" className="ghost-button" disabled={busy} onClick={closeConfirmation}>Cerrar</button><button type="button" className="primary-button" disabled={busy} onClick={requestPrint}>{busy?'Abriendo ticket…':'Imprimir ticket'}</button></>:<><button type="button" className="ghost-button" disabled={busy} onClick={closeConfirmation}>Cancelar</button><button type="button" className="ghost-button" disabled={busy} onClick={()=>void confirm(false,null)}>{busy?'Guardando…':'Guardar'}</button><button type="button" className="primary-button" disabled={busy} onClick={requestPrint}>{busy?'Guardando…':'Imprimir ticket'}</button></>}</div>
    </Modal>}
  </>;
}
type SalePage={registros:Sale[];total:number;pagina:number;por_pagina:number};
function SalesHistory({refresh,run,role}:{refresh:number;run:Props['run'];role:string}){
  const can=useCan();void role;
  const[from,setFrom]=useState(''),[to,setTo]=useState(''),[guest,setGuest]=useState(''),[page,setPage]=useState(1),[annul,setAnnul]=useState<Sale|null>(null),[motive,setMotive]=useState(''),[detail,setDetail]=useState<any|null>(null),[localError,setLocalError]=useState('');
  const params=useMemo(()=>{const p=new URLSearchParams({pagina:String(page)});if(from)p.set('desde',from);if(to)p.set('hasta',to);if(guest.trim())p.set('q',guest.trim());return p.toString()},[page,from,to,guest]);
  const{data,error}=useData<SalePage>('/ventas?'+params,refresh);
  useEffect(()=>setPage(1),[from,to,guest]);
  const clear=()=>{setFrom('');setTo('');setGuest('');setPage(1)};
  return <><section className="card table-card"><div className="card-head"><div><span className="eyebrow">HISTORIAL</span><h2>Historial de ventas</h2></div></div><div className="table-toolbar sales-history-filters"><Field label="Fecha desde"><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></Field><Field label="Fecha hasta"><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></Field><label className="searchbox"><Search size={17}/><input placeholder="Buscar huésped" value={guest} onChange={e=>setGuest(e.target.value)}/></label><button type="button" className="ghost-button" onClick={clear}>Limpiar filtros</button></div>{(error||localError)&&<div className="form-error">{error||localError}</div>}<div className="table-wrap"><table><thead><tr><th>Venta</th><th>Fecha</th><th>Huésped / habitación</th><th>Destino</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data?.registros.map(s=><tr key={s.idventa}><td><strong>#{s.idventa}</strong></td><td>{new Date(s.fecha_creado).toLocaleString('es-PY')}</td><td>{s.fk_idreserva?`${s.cliente_nombre||''} ${s.cliente_apellido||''} · Hab. ${s.habitacion_numero}`:'Sin habitación'}</td><td>{s.destino}</td><td>{gs(s.total_gs)}</td><td>{s.anulado?<span className="badge status-cancelada">Anulada</span>:BigInt(s.pagado_inicial_gs)===BigInt(s.total_gs)||s.fk_idreserva&&BigInt(s.saldo_reserva_gs)===0n?<span className="badge status-en_casa">Pagada</span>:<span className="badge status-pendiente">Pendiente</span>}</td><td><div className="sale-row-actions"><button className="small-button" onClick={async()=>{try{setDetail(await api(`/ventas/${s.idventa}`));setLocalError('')}catch(e:any){setLocalError(e.message)}}}>Ver detalle</button>{!s.anulado&&can('sales.annul')&&<button className="small-button" onClick={()=>{setAnnul(s);setMotive('')}}>Anular</button>}</div></td></tr>)}</tbody></table>{!data?.registros.length&&!error&&<Empty text="No se encontraron ventas"/>}</div><Pagination page={page} total={data?.total||0} loading={!data&&!error} disabled={!!error} onChange={setPage}/></section>{can('sales.annul')&&annul&&<Modal title={`Anular venta #${annul.idventa}`} onClose={()=>setAnnul(null)}><form onSubmit={e=>{e.preventDefault();run(async()=>{await api(`/ventas/${annul.idventa}/anular`,{method:'POST',body:JSON.stringify({motivo:motive})});setAnnul(null)},'Venta anulada',true)}}><Field label="Motivo de anulación"><textarea required value={motive} onChange={e=>setMotive(e.target.value)}/></Field><div className="modal-actions"><button type="button" className="ghost-button" onClick={()=>setAnnul(null)}>Cancelar</button><button className="primary-button">Anular venta</button></div></form></Modal>}{detail&&<SaleDetail detail={detail} onClose={()=>setDetail(null)}/>}</>;
}

type SaleDetailData=Sale&{
  creado_por:string;fecha_anulado:string|null;anulado_por:string|null;motivo_anulacion:string|null;
  reserva_entrada:string|null;reserva_salida:string|null;
  items:{idventa_item:string;nombre_producto:string;cantidad:number;precio_unitario_gs:string;pago_inicial:'pagado'|'pendiente'}[];
  pagos:{idpago:string;clase:'pago'|'devolucion';monto_gs:string;fecha_creado:string;anulado:boolean;fk_idcaja:string|null;forma_pago_nombre:string}[];
};
const saleDateTime=(value:string)=>new Date(value).toLocaleString('es-PY',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Asuncion'});
const saleDate=(value:string)=>value.slice(0,10).split('-').reverse().join('/');

function SaleDetail({detail,onClose}:{detail:SaleDetailData;onClose:()=>void}){
  const [printing,setPrinting]=useState(false),[ticketError,setTicketError]=useState('');
  const print=async()=>{const tab=window.open('','_blank');setPrinting(true);setTicketError('');try{await openSaleTicket(detail.idventa,tab)}catch(e:any){if(tab&&!tab.closed)tab.close();setTicketError(e.message)}finally{setPrinting(false)}};
  const initiallyPending=BigInt(detail.total_gs)-BigInt(detail.pagado_inicial_gs);
  const accountSettled=detail.fk_idreserva&&detail.saldo_reserva_gs!==null&&BigInt(detail.saldo_reserva_gs)<=0n;
  const status=detail.anulado?'Anulada':initiallyPending===0n?'Pagada':accountSettled?'Cuenta saldada':'Pendiente';
  const guest=detail.fk_idreserva?`${detail.cliente_nombre||''} ${detail.cliente_apellido||''}`.trim():'Venta sin huésped';
  return <Modal title={`Venta #${detail.idventa}`} onClose={onClose} className="sale-detail-modal">
    <div className="sale-detail-hero">
      <div><span className="eyebrow">COMPROBANTE DE CONSUMICIÓN</span><p>{saleDateTime(detail.fecha_creado)}</p></div>
      <span className={`sale-detail-status ${detail.anulado?'is-cancelled':initiallyPending===0n||accountSettled?'is-paid':'is-pending'}`}>{status}</span>
    </div>
    <div className="sale-detail-facts">
      <div><span>Huésped</span><strong>{guest}</strong></div>
      <div><span>Habitación</span><strong>{detail.habitacion_numero?`Hab. ${detail.habitacion_numero}`:'Sin habitación'}</strong></div>
      <div><span>Destino</span><strong>{detail.destino==='habitacion'?'Habitación':'Restaurante'}</strong></div>
      <div><span>Registrada por</span><strong>{detail.creado_por}</strong></div>
      {detail.fk_idreserva&&<div><span>Reserva</span><strong>#{detail.fk_idreserva}</strong></div>}
      {detail.reserva_entrada&&detail.reserva_salida&&<div><span>Estadía</span><strong>{saleDate(detail.reserva_entrada)} – {saleDate(detail.reserva_salida)}</strong></div>}
    </div>
    <section className="sale-detail-section" aria-label="Artículos de la venta">
      <div className="sale-detail-section-head"><div><span className="eyebrow">CONSUMICIÓN</span><h3>Artículos</h3></div><span>{detail.items.reduce((sum,item)=>sum+Number(item.cantidad),0)} unidades</span></div>
      <div className="sale-detail-items">{detail.items.map(item=><div className="sale-detail-item" key={item.idventa_item}>
        <div><strong>{item.nombre_producto}</strong><span>{item.cantidad} × {gs(item.precio_unitario_gs)}</span></div>
        <span className={`sale-detail-item-state ${item.pago_inicial==='pagado'?'is-paid':'is-pending'}`}>{item.pago_inicial==='pagado'?'Pagado al registrar':'Pendiente al registrar'}</span>
        <b>{gs(BigInt(item.precio_unitario_gs)*BigInt(item.cantidad))}</b>
      </div>)}</div>
    </section>
    <div className="sale-detail-amounts"><div><span>Total de la venta</span><strong>{gs(detail.total_gs)}</strong></div><div><span>Cobrado al registrar</span><b>{gs(detail.pagado_inicial_gs)}</b></div><div><span>Cargado a la habitación</span><b>{gs(initiallyPending)}</b></div>{detail.fk_idreserva&&<div className="sale-detail-balance"><span>Saldo actual de la reserva</span><b>{gs(detail.saldo_reserva_gs)}</b></div>}</div>
    <section className="sale-detail-section" aria-label="Cobros relacionados"><div className="sale-detail-section-head"><div><span className="eyebrow">CAJA</span><h3>Cobros y devoluciones</h3></div></div>
      {detail.pagos.length?<div className="sale-detail-payments">{detail.pagos.map(payment=><div key={payment.idpago}><span className={`sale-detail-payment-mark ${payment.clase==='devolucion'?'is-refund':''}`}>{payment.clase==='devolucion'?'−':'+'}</span><div><strong>{payment.clase==='devolucion'?'Devolución':'Cobro inicial'}{payment.anulado?' · Anulado':''}</strong><small>{payment.forma_pago_nombre} · {payment.fk_idcaja?`Caja #${payment.fk_idcaja}`:'Sin caja'} · {saleDateTime(payment.fecha_creado)}</small></div><b>{gs(payment.monto_gs)}</b></div>)}</div>:<p className="sale-detail-empty-payment">Sin cobro inicial. Los importes pendientes figuran en la cuenta de la reserva.</p>}
    </section>
    {detail.anulado&&<div className="sale-detail-annulled"><strong>Venta anulada</strong><span>{detail.motivo_anulacion||'Sin motivo registrado'}</span><small>{detail.anulado_por||'Usuario no registrado'}{detail.fecha_anulado?` · ${saleDateTime(detail.fecha_anulado)}`:''}</small></div>}
    {ticketError&&<div className="form-error" role="alert">No se pudo abrir el ticket: {ticketError}</div>}
    <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cerrar</button><button type="button" className="primary-button" disabled={printing} onClick={()=>void print()}>{printing?'Abriendo ticket…':'Imprimir ticket'}</button></div>
  </Modal>;
}
