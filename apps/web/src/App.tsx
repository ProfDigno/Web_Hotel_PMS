import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { version as appVersion } from '../package.json';
import { LayoutDashboard, CalendarDays, BedDouble, Users, Sparkles, Wallet, ReceiptText, ChartNoAxesCombined, Settings, LogIn, LogOut, Plus, Search, ChevronLeft, ChevronRight, Menu, X, Check, Clock3, CircleAlert, ArrowRight, Building2, ShoppingCart, Play, CheckCircle2 } from 'lucide-react';
import { api, BASE, addDays, daysBetween, gs, today } from './api';
import { Configuration, EditRoomType, RoomTypesTable, RatesTable, EditRate, FloorsTable, EditFloor, RoomsTable, EditRoom } from './Configuration';
import { CashCurrent, CashClosed } from './CashLedger';
import { PaymentMethodSelect } from './PaymentMethods';
import { Guests } from './Guests';
import { Pagination, type PageResult } from './Pagination';
import { AnnulPaymentButton } from './AnnulPayment';
import { isCheckoutOverdue, roomVisualState, RoomStateIcon } from './RoomAppearance';
import { Expenses, type ExpenseTab } from './Expenses';
import { Sales, type SalesTab } from './Sales';
import { Purchases, type PurchaseTab } from './Purchases';
import { ActionResultDialog, type ActionResultState } from './ActionResultDialog';
import { ActionDismissedError } from './action-result';
import { requestId } from './request-id';
import './reservation-payment.css';
const RoomAnalytics=lazy(()=>import('./RoomAnalytics').then(module=>({default:module.RoomAnalytics})));

const amountDigits=(value:string)=>value.replace(/\D/g,'');
const formatAmountInput=(value:string)=>{const digits=amountDigits(value);return digits?BigInt(digits).toLocaleString('es-PY'):''};
type User = { idusuario: string; nombre: string; email: string; rol: string };
type Section = 'tablero'|'calendario'|'reservas'|'habitaciones'|'clientes'|'limpieza'|'caja'|'venta'|'compra'|'gasto'|'facturas'|'informes'|'configuracion';
const sections: { key: Section; label: string; icon: any }[] = [
  {key:'tablero',label:'Tablero',icon:LayoutDashboard},{key:'calendario',label:'Calendario',icon:CalendarDays},{key:'reservas',label:'Reservas',icon:ReceiptText},{key:'habitaciones',label:'Habitaciones',icon:BedDouble},{key:'clientes',label:'Huéspedes',icon:Users},{key:'limpieza',label:'Limpieza',icon:Sparkles},{key:'caja',label:'Caja',icon:Wallet},{key:'venta',label:'Venta',icon:ShoppingCart},{key:'compra',label:'Compra',icon:ShoppingCart},{key:'gasto',label:'Gasto',icon:ReceiptText},{key:'facturas',label:'Facturación',icon:ReceiptText},{key:'informes',label:'Informes',icon:ChartNoAxesCombined},{key:'configuracion',label:'Configuración',icon:Settings}
];
const labels: Record<string,string> = {confirmada:'Confirmada',en_casa:'En casa',finalizada:'Finalizada',cancelada:'Cancelada',no_show:'No se presentó',limpia:'Limpia',sucia:'Sucia',en_limpieza:'En limpieza',inspeccion:'Inspección',borrador:'Borrador',firmado:'Firmado',enviado:'Enviado',pendiente:'Pendiente',aprobado:'Aprobado',rechazado:'Rechazado',pendiente_limpieza:'Pendiente'};
function Badge({value}:{value:string}) { return <span className={`badge status-${value}`}>{labels[value] || value.replaceAll('_',' ')}</span>; }
function Empty({text}:{text:string}) { return <div className="empty"><div className="empty-icon"><BedDouble size={23}/></div><p>{text}</p></div>; }
function Field({label,children}:{label:string,children:React.ReactNode}) { return <label className="field"><span>{label}</span>{children}</label>; }
function Modal({title,children,onClose,className=''}:{title:string,children:React.ReactNode,onClose:()=>void,className?:string}) { return <div className="modal-backdrop" onMouseDown={onClose}><div className={`modal ${className}`} onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button type="button" className="icon-button" onClick={onClose}><X size={20}/></button></div>{children}</div></div>; }
function useLoad<T>(path:string, refresh=0) { const [data,setData]=useState<T|null>(null),[error,setError]=useState(''); useEffect(()=>{let live=true; api<T>(path).then(x=>{if(live){setData(x);setError('');}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false};},[path,refresh]); return {data,error}; }
function useMinuteClock() {
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{
    let interval:ReturnType<typeof setInterval>;
    const timeout=setTimeout(()=>{setNow(new Date());interval=setInterval(()=>setNow(new Date()),60_000)},60_000-Date.now()%60_000);
    return()=>{clearTimeout(timeout);clearInterval(interval)};
  },[]);
  return now;
}
const checkoutDateTime=(value:string)=>new Date(value).toLocaleString('es-PY',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Asuncion'});
async function openCheckoutTicket(id:string,tab:Window|null) {
  const token=localStorage.getItem('pms_token');
  let response:Response;
  try { response=await fetch(`${BASE}/reservas/${id}/check-out/ticket`,{headers:token?{Authorization:`Bearer ${token}`}:{}}); }
  catch { throw new Error('No se pudo conectar con la API'); }
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.message||`Error ${response.status}`);}
  const url=URL.createObjectURL(await response.blob());
  if(tab&&!tab.closed)tab.location.href=url;
  else {const link=document.createElement('a');link.href=url;link.download=`reserva-${id}-check-out.pdf`;document.body.appendChild(link);link.click();link.remove();}
  window.setTimeout(()=>URL.revokeObjectURL(url),300000);
}

export default function App(){
  const [token,setToken]=useState(localStorage.getItem('pms_token'));
  const [user,setUser]=useState<User|null>(()=>{try{return JSON.parse(localStorage.getItem('pms_user')||'null')}catch{return null}});
  const [section,setSection]=useState<Section>(user?.rol==='limpieza'?'limpieza':user?.rol==='caja'?'caja':'tablero'),[menu,setMenu]=useState(false),[configOpen,setConfigOpen]=useState(false),[roomsOpen,setRoomsOpen]=useState(false),[cashOpen,setCashOpen]=useState(user?.rol==='caja'),[purchaseOpen,setPurchaseOpen]=useState(false),[purchaseTab,setPurchaseTab]=useState<PurchaseTab>('compra'),[expenseOpen,setExpenseOpen]=useState(false),[expenseTab,setExpenseTab]=useState<ExpenseTab>('gasto'),[salesOpen,setSalesOpen]=useState(false),[salesTab,setSalesTab]=useState<SalesTab>('venta'),[cashTab,setCashTab]=useState<'current'|'closed'>('current'),[roomsTab,setRoomsTab]=useState<'rooms'|'analysis'|'admin'|'types'|'rates'|'floors'>('rooms'),[configTab,setConfigTab]=useState<'hotel'|'usuarios'|'formas-pago'>('hotel'),[refresh,setRefresh]=useState(0),[toast,setToast]=useState(''),[modal,setModal]=useState('');
  const reload=()=>setRefresh(x=>x+1);
  const notify=(message:string)=>{setToast(message);setTimeout(()=>setToast(''),4500)};
  const run=async(fn:()=>Promise<any>,_success='Guardado',keepModal=false)=>{try{await fn();reload();if(!keepModal)setModal('')}catch(e:any){if(!(e instanceof ActionDismissedError))notify(e.message)}};
  if(!token) return <Login onLogin={(t,u)=>{localStorage.setItem('pms_token',t);localStorage.setItem('pms_user',JSON.stringify(u));setToken(t);setUser(u);setSection(u.rol==='limpieza'?'limpieza':u.rol==='caja'?'caja':'tablero')}}/>;
  const page=sections.find(s=>s.key===section)!;
  const visible=(key:Section)=>user?.rol==='administracion'||(user?.rol==='limpieza'?['habitaciones','limpieza'].includes(key):user?.rol==='caja'?['tablero','reservas','clientes','caja','venta','compra','gasto','facturas'].includes(key):key!=='caja'&&key!=='compra'&&key!=='gasto'&&key!=='configuracion');
  return <div className="shell">
    <aside className={`sidebar ${menu?'open':''}`}>
      <div className="brand"><div className="brand-symbol"><Building2 size={25}/></div><div><strong>Casa Hotel</strong><small>Property Management</small></div><button className="mobile-close icon-button" onClick={()=>setMenu(false)}><X/></button></div>
      <div className="side-label">OPERACIONES</div>
<nav>{sections.slice(0,11).filter(item=>visible(item.key)).map(item=>item.key==='habitaciones'?<div className="nav-group" key={item.key}><button className={`nav-item ${section===item.key?'active':''}`} onClick={()=>{setSection(item.key);setRoomsOpen(x=>!x);setMenu(false)}}><item.icon size={19}/><span>{item.label}</span><span className="nav-chevron">{roomsOpen?'⌃':'⌄'}</span></button>{roomsOpen&&section==='habitaciones'&&<div className="sidebar-submenu"><button className={roomsTab==='rooms'?'selected':''} onClick={()=>{setRoomsTab('rooms');setSection('habitaciones');setMenu(false)}}>Habitaciones</button>{['administracion','recepcion'].includes(user?.rol||'')&&<button className={roomsTab==='analysis'?'selected':''} onClick={()=>{setRoomsTab('analysis');setSection('habitaciones');setMenu(false)}}>Análisis de habitaciones</button>}{user?.rol==='administracion'&&<button className={roomsTab==='admin'?'selected':''} onClick={()=>{setRoomsTab('admin');setSection('habitaciones');setMenu(false)}}>Administración de habitaciones</button>}<button className={roomsTab==='types'?'selected':''} onClick={()=>{setRoomsTab('types');setSection('habitaciones');setMenu(false)}}>Tipo de habitación</button><button className={roomsTab==='rates'?'selected':''} onClick={()=>{setRoomsTab('rates');setSection('habitaciones');setMenu(false)}}>Tarifa</button>{user?.rol==='administracion'&&<button className={roomsTab==='floors'?'selected':''} onClick={()=>{setRoomsTab('floors');setSection('habitaciones');setMenu(false)}}>Pisos</button>}</div>}</div>:item.key==='compra'?<div className='nav-group' key={item.key}><button className={'nav-item '+(section==='compra'?'active':'')} aria-expanded={purchaseOpen} onClick={()=>{setSection('compra');setPurchaseOpen(x=>!x)}}><item.icon size={19}/><span>Compra</span><span className='nav-chevron'>{purchaseOpen?'⌃':'⌄'}</span></button>{purchaseOpen&&<div className='sidebar-submenu'>{(['compra',...(user?.rol==='administracion'?['proveedor','analisis']:[])] as PurchaseTab[]).map(tab=><button key={tab} className={section==='compra'&&purchaseTab===tab?'selected':''} onClick={()=>{setPurchaseTab(tab);setSection('compra');setMenu(false)}}>{tab==='compra'?'Compra':tab==='proveedor'?'Proveedor':'Análisis de compra'}</button>)}</div>}</div>:item.key==='gasto'?<div className="nav-group" key={item.key}><button className={'nav-item '+(section==='gasto'?'active':'')} aria-expanded={expenseOpen} onClick={()=>{setSection('gasto');setExpenseOpen(x=>!x)}}><item.icon size={19}/><span>Gasto</span><span className="nav-chevron">{expenseOpen?'⌃':'⌄'}</span></button>{expenseOpen&&<div className="sidebar-submenu">{(['gasto',...(user?.rol==='administracion'?['tipo','analisis']:[])] as ExpenseTab[]).map(tab=><button key={tab} className={section==='gasto'&&expenseTab===tab?'selected':''} onClick={()=>{setExpenseTab(tab);setSection('gasto');setMenu(false)}}>{tab==='gasto'?'Gasto':tab==='tipo'?'Gasto tipo':'Análisis Gasto'}</button>)}</div>}</div>:item.key==='caja'?<div className="nav-group" key={item.key}><button className={'nav-item '+(section==='caja'?'active':'')} aria-expanded={cashOpen} onClick={()=>{setSection('caja');setCashOpen(x=>!x)}}><item.icon size={19}/><span>{item.label}</span><span className="nav-chevron">{cashOpen?'⌃':'⌄'}</span></button>{cashOpen&&<div className="sidebar-submenu"><button className={section==='caja'&&cashTab==='current'?'selected':''} onClick={()=>{setCashTab('current');setSection('caja');setMenu(false)}}>Caja actual</button><button className={section==='caja'&&cashTab==='closed'?'selected':''} onClick={()=>{setCashTab('closed');setSection('caja');setMenu(false)}}>Cajas cerradas</button></div>}</div>:<div className="nav-group" key={item.key}><button className={`nav-item ${section===item.key?'active':''}`} onClick={()=>{if(item.key==='venta')setSalesOpen(x=>!x);setSection(item.key);setMenu(false)}}><item.icon size={19}/><span>{item.label}</span>{item.key==='calendario'&&<span className="nav-dot"/>}</button>{item.key==='venta'&&salesOpen&&section==='venta'&&<div className="sidebar-submenu">{(['venta','historial','analisis','categoria','producto','inventario'] as SalesTab[]).map(tab=><button key={tab} className={salesTab===tab?'selected':''} onClick={()=>{setSalesTab(tab);setSection('venta');setMenu(false)}}>{tab==='venta'?'Venta':tab==='historial'?'Historial de ventas':tab==='analisis'?'Análisis de ventas':tab==='categoria'?'Categoría':tab==='producto'?'Producto':'Inventario'}</button>)}</div>}</div>)}</nav>
      {sections.slice(11).some(item=>visible(item.key))&&<><div className="side-label side-label-lower">GESTIÓN</div><nav>{sections.slice(11).filter(item=>visible(item.key)).map(item=>item.key==='configuracion'?<div className="nav-group" key={item.key}><button className={`nav-item ${section===item.key?'active':''}`} onClick={()=>{setSection(item.key);setConfigOpen(x=>!x);setMenu(false)}}><item.icon size={19}/><span>{item.label}</span><span className="nav-chevron">{configOpen?'⌃':'⌄'}</span></button>{configOpen&&section==='configuracion'&&<div className="sidebar-submenu"><button className={configTab==='hotel'?'selected':''} onClick={()=>{setConfigTab('hotel');setSection('configuracion');setMenu(false)}}>Hotel</button><button className={configTab==='usuarios'?'selected':''} onClick={()=>{setConfigTab('usuarios');setSection('configuracion');setMenu(false)}}>Usuarios</button><button className={configTab==='formas-pago'?'selected':''} onClick={()=>{setConfigTab('formas-pago');setSection('configuracion');setMenu(false)}}>Formas de pago</button></div>}</div>:<div className="nav-group" key={item.key}><button className={`nav-item ${section===item.key?'active':''}`} onClick={()=>{setSection(item.key);setMenu(false)}}><item.icon size={19}/><span>{item.label}</span></button></div>)}</nav></>}
      <div className="sidebar-bottom"><div className="profile"><div className="avatar">{user?.nombre?.slice(0,1).toUpperCase()||'U'}</div><div><strong>{user?.nombre||'Usuario'}</strong><small>{user?.rol||'PMS'}</small></div></div><button className="logout" onClick={()=>{localStorage.removeItem('pms_token');localStorage.removeItem('pms_user');setToken(null)}}><LogOut size={17}/> Cerrar sesión</button></div>
    </aside>
    <main className="main"><header className="topbar"><button className="hamburger icon-button" onClick={()=>setMenu(true)}><Menu/></button><div className="breadcrumb">Casa Hotel <span>/</span> <b>{section==='caja'?(cashTab==='current'?'Caja actual':'Cajas cerradas'):page.label}</b></div><div className="top-actions"><span className="date-pill">{new Intl.DateTimeFormat('es-PY',{timeZone:'America/Asuncion',dateStyle:'long'}).format(new Date())}</span><div className="top-avatar">{user?.nombre?.slice(0,1).toUpperCase()||'U'}</div></div></header>
      <div className="page">
        {section==='tablero'&&<Dashboard refresh={refresh} navigate={setSection} />}
        {section==='calendario'&&<Calendar refresh={refresh} openReservation={id=>setModal(`reserva:${id}`)} onNew={()=>setModal('nueva-reserva')}/>}
        {section==='reservas'&&<Reservations refresh={refresh} onNew={()=>setModal('nueva-reserva')} open={id=>setModal(`reserva:${id}`)} transfer={id=>setModal(`transfer:${id}`)} user={user}/>}
        {section==='habitaciones'&&roomsTab==='rooms'&&<Rooms refresh={refresh} onNew={type=>setModal(type)} run={run} user={user} openReservation={id=>setModal(`reserva:${id}`)}/>}
        {section==='habitaciones'&&roomsTab==='analysis'&&['administracion','recepcion'].includes(user?.rol||'')&&<Suspense fallback={<div className="card empty"><p>Cargando gráficos de habitaciones…</p></div>}><RoomAnalytics refresh={refresh}/></Suspense>}
        {section==='habitaciones'&&roomsTab==='admin'&&user?.rol==='administracion'&&<RoomsTable refresh={refresh} onNew={()=>setModal('nueva-habitacion')} onEdit={id=>setModal(`editar-habitacion:${id}`)} run={run}/>}
        {section==='habitaciones'&&roomsTab==='types'&&<RoomTypesTable refresh={refresh} onNew={()=>setModal('nuevo-tipo')} onEdit={id=>setModal(`editar-tipo:${id}`)} run={run}/>}
        {section==='habitaciones'&&roomsTab==='rates'&&<RatesTable refresh={refresh} onNew={()=>setModal('nueva-tarifa')} onEdit={id=>setModal(`editar-tarifa:${id}`)} run={run}/>}
        {section==='habitaciones'&&roomsTab==='floors'&&<FloorsTable refresh={refresh} onNew={()=>setModal('nuevo-piso')} onEdit={id=>setModal(`editar-piso:${id}`)} run={run}/>}
        {section==='clientes'&&<Guests refresh={refresh} onNew={()=>setModal('nuevo-cliente')} openReservation={id=>setModal('reserva:'+id)} renderStatus={value=><Badge value={value}/>}/>}
        {section==='limpieza'&&<Housekeeping refresh={refresh} run={run}/>}
        {section==='caja'&&['administracion','caja'].includes(user?.rol||'')&&(cashTab==='current'?<CashCurrent refresh={refresh} run={run}/>:<CashClosed refresh={refresh} run={run}/>)}
        {section==='venta'&&['administracion','recepcion','caja'].includes(user?.rol||'')&&<Sales tab={salesTab} refresh={refresh} run={run} role={user?.rol||''}/>}
        {section==='compra'&&<Purchases tab={purchaseTab} role={user?.rol||''} refresh={refresh} run={run}/>}
        {section==='gasto'&&<Expenses tab={expenseTab} role={user?.rol||''} refresh={refresh} run={run}/>}
        {section==='facturas'&&<Invoices refresh={refresh} open={id=>setModal(`reserva:${id}`)} run={run} user={user}/>}
        {section==='informes'&&<Reports refresh={refresh}/>}
        {section==='configuracion'&&<Configuration refresh={refresh} user={user} run={run} initialTab={configTab}/>}
      </div>
    </main>
    {modal==='nueva-reserva'&&<NewReservation onClose={()=>setModal('')} run={run} onSaved={reload}/>}
    {modal==='nuevo-cliente'&&<NewClient onClose={()=>setModal('')} run={run}/>}
    {modal==='nuevo-tipo'&&<NewRoomType onClose={()=>setModal('')} run={run}/>}
    {modal.startsWith('editar-tipo:')&&<EditRoomType id={modal.slice(12)} onClose={()=>setModal('')} run={run} refresh={refresh}/>}
    {modal.startsWith('editar-tarifa:')&&<EditRate id={modal.slice(14)} onClose={()=>setModal('')} run={run} refresh={refresh}/>}
    {modal==='nuevo-piso'&&<NewFloor onClose={()=>setModal('')} run={run}/>}
    {modal.startsWith('editar-piso:')&&<EditFloor id={modal.slice(12)} onClose={()=>setModal('')} run={run} refresh={refresh}/>}
    {modal==='nueva-habitacion'&&<NewRoom onClose={()=>setModal('')} run={run} refresh={refresh}/>}
    {modal.startsWith('editar-habitacion:')&&<EditRoom id={modal.slice(18)} onClose={()=>setModal('')} run={run} refresh={refresh}/>}
    {modal==='nueva-tarifa'&&<NewRate onClose={()=>setModal('')} run={run} refresh={refresh}/>}
    {modal.startsWith('reserva:')&&<ReservationDetail id={modal.slice(8)} onClose={()=>setModal('')} refresh={refresh} run={run} user={user} onPaymentSaved={reload}/>}
    {modal.startsWith('transfer:')&&<TransferRoom id={modal.slice(9)} onClose={()=>setModal('')} refresh={refresh} run={run}/>}
    {toast&&<div className="toast">{toast}</div>}
  </div>;
}

function Login({onLogin}:{onLogin:(t:string,u:User)=>void}){const[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState('');return <div className="login-wrap"><div className="login-art"><div className="login-art-content"><div className="brand-symbol"><Building2 size={30}/></div><span>BIENVENIDO A CASA HOTEL</span><h1>Hospitalidad en cada detalle.</h1><p>Una forma más clara y cálida de gestionar tu hotel.</p></div><div className="art-circle circle-one"/><div className="art-circle circle-two"/></div><form className="login-card" onSubmit={async e=>{e.preventDefault();try{const x=await api<{token:string,usuario:User}>('/auth/login',{method:'POST',body:JSON.stringify({email,password})});onLogin(x.token,x.usuario)}catch(err:any){setError(err.message)}}}><div className="eyebrow">ACCESO AL PMS</div><h2>Iniciar sesión</h2><p>Ingresá con tu cuenta de trabajo para continuar.</p><Field label="Correo electrónico"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="usuario@hotel.com"/></Field><Field label="Contraseña"><input type="password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="••••••••••"/></Field>{error&&<div className="form-error">{error}</div>}<button className="primary-button full" type="submit">Entrar <ArrowRight size={18}/></button><small className="login-foot">Hotel PMS · Paraguay · v{appVersion}</small></form></div>}

function PageHead({eyebrow,title,subtitle,action}:{eyebrow:string,title:string,subtitle:string,action?:React.ReactNode}){return <div className="page-head"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action&&<div className="page-action">{action}</div>}</div>}

type ReservationDetailProps={id:string;onClose:()=>void;refresh:number;run:any;user:User|null;onPaymentSaved:()=>void};
function ReservationDetail(props:ReservationDetailProps){
  return props.user?.rol==='limpieza'?<ReservationStayDetail id={props.id} onClose={props.onClose} refresh={props.refresh}/>:<ReservationFinancialDetail {...props}/>;
}
function ReservationStayDetail({id,onClose,refresh}:{id:string;onClose:()=>void;refresh:number}){
  const {data:r,error}=useLoad<any>(`/reservas/${id}`,refresh);
  return <Modal title={`Reserva #${id}`} onClose={onClose}>{error&&<div className="form-error">{error}</div>}{!r&&!error&&<p>Cargando detalle…</p>}{r&&<div className="detail-hero"><div><span className="eyebrow">HUÉSPED</span><h3>{r.cliente_nombre} {r.cliente_apellido}</h3><p>{r.fecha_entrada} → {r.fecha_salida} · {r.habitaciones.map((h:any)=>`Hab. ${h.numero}`).join(', ')}</p></div><Badge value={r.estado}/></div>}</Modal>;
}
function Dashboard({refresh,navigate}:{refresh:number,navigate:(s:Section)=>void}){const{data:d,error}=useLoad<any>('/tablero',refresh),{data:reservas}=useLoad<any[]>('/reservas',refresh),{data:rooms}=useLoad<any[]>('/habitaciones',refresh);const arrivals=reservas?.filter(x=>x.fecha_entrada===today()&&x.estado==='confirmada').slice(0,5)||[];return <><PageHead eyebrow="VISTA GENERAL" title="Buen día, bienvenido" subtitle="Así está tu hotel hoy. Cada detalle, a la vista." action={<button className="primary-button" onClick={()=>navigate('calendario')}><CalendarDays size={18}/> Ver calendario</button>}/>{error&&<div className="form-error">{error}</div>}<div className="stat-grid"><Stat icon={CalendarDays} label="Llegadas hoy" value={d?.llegadas??'—'} tone="copper"/><Stat icon={LogOut} label="Salidas hoy" value={d?.salidas??'—'} tone="blue"/><Stat icon={BedDouble} label="Ocupación" value={d?`${d.ocupadas} / ${d.habitaciones}`:'—'} tone="green"/><Stat icon={Sparkles} label="Por limpiar" value={d?.pendientes_limpieza??'—'} tone="sand"/></div><div className="dashboard-grid"><section className="card"><div className="card-head"><div><span className="eyebrow">RECEPCIÓN</span><h2>Llegadas de hoy</h2></div><button className="text-button" onClick={()=>navigate('reservas')}>Ver reservas <ArrowRight size={16}/></button></div>{arrivals.length?<div className="list">{arrivals.map(r=><div className="list-row" key={r.idreserva}><div className="row-avatar">{r.cliente_nombre.slice(0,1)}</div><div className="grow"><strong>{r.cliente_nombre} {r.cliente_apellido}</strong><small>Habitación {r.habitaciones||'sin asignar'}</small></div><Badge value={r.estado}/></div>)}</div>:<Empty text="No hay llegadas pendientes para hoy"/>}</section><section className="card"><div className="card-head"><div><span className="eyebrow">ESTADO DEL HOTEL</span><h2>Habitaciones</h2></div><button className="text-button" onClick={()=>navigate('habitaciones')}>Ver todas <ArrowRight size={16}/></button></div><div className="room-summary"><div className="room-ring"><span>{d?.habitaciones??0}</span><small>en total</small></div><div className="room-legend"><div><i className="legend-green"/> Ocupadas <b>{d?.ocupadas??0}</b></div><div><i className="legend-sand"/> Por limpiar <b>{d?.pendientes_limpieza??0}</b></div><div><i className="legend-light"/> Disponibles <b>{Math.max(0,(d?.habitaciones??0)-(d?.ocupadas??0)-(d?.pendientes_limpieza??0))}</b></div></div></div></section></div><div className="stat-grid bottom-stats"><div className="wide-stat"><Wallet size={24}/><div><small>Saldos pendientes</small><strong>{gs(d?.saldos_pendientes_gs)}</strong></div></div><div className="wide-stat"><ReceiptText size={24}/><div><small>Facturas pendientes de respuesta</small><strong>{d?.facturas_pendientes??0}</strong></div></div></div></>}
function Stat({icon:Icon,label,value,tone}:{icon:any,label:string,value:string|number,tone:string}){return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={22}/></div><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>}

function Calendar({refresh,openReservation,onNew}:{refresh:number,openReservation:(id:string)=>void,onNew:()=>void}){
  type CalendarView='month'|'week'|'day';
  const [view,setView]=useState<CalendarView>('week');
  const [selected,setSelected]=useState(today());
  const dateLabel=new Intl.DateTimeFormat('es-PY',{dateStyle:'medium'});
  const monthLabel=new Intl.DateTimeFormat('es-PY',{month:'long',year:'numeric'});
  const weekStart=addDays(selected,-new Date(`${selected}T12:00:00Z`).getUTCDay());
  const monthStart=`${selected.slice(0,7)}-01`;
  const nextMonth=new Date(`${monthStart}T12:00:00Z`); nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1);
  const monthEnd=nextMonth.toISOString().slice(0,10);
  const rangeStart=view==='month'?addDays(monthStart,-new Date(`${monthStart}T12:00:00Z`).getUTCDay()):view==='week'?weekStart:selected;
  const rangeEnd=view==='month'?addDays(monthEnd,6-new Date(`${monthEnd}T12:00:00Z`).getUTCDay()):view==='week'?addDays(weekStart,7):addDays(selected,1);
  const {data:rooms}=useLoad<any[]>('/habitaciones',refresh),{data:bookings}=useLoad<any[]>(`/calendario?desde=${rangeStart}&hasta=${rangeEnd}`,refresh);
  const dates=Array.from({length:view==='month'?daysBetween(rangeStart,rangeEnd)+1:view==='week'?7:1},(_,i)=>addDays(rangeStart,i));
  const formatDay=(d:string,opts:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat('es-PY',opts).format(new Date(`${d}T12:00:00Z`));
  const move=(direction:number)=>{if(view==='month'){const d=new Date(`${monthStart}T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+direction);setSelected(d.toISOString().slice(0,10));}else setSelected(addDays(selected,view==='week'?direction*7:direction));};
  const title=view==='month'?monthLabel.format(new Date(`${monthStart}T12:00:00Z`)):view==='week'?`${formatDay(weekStart,{day:'numeric',month:'short'})} – ${formatDay(addDays(weekStart,6),{day:'numeric',month:'short',year:'numeric'})}`:dateLabel.format(new Date(`${selected}T12:00:00Z`));
  const bookingForDay=(day:string)=>bookings?.filter(b=>b.fecha_entrada<=day&&b.fecha_salida>day)||[];
  const bookingForRoom=(roomId:string|number)=>bookings?.filter(b=>b.fk_idhabitacion===roomId)||[];
  const shortName=(b:any)=>{const first=String(b.nombre||'').trim().split(/\s+/)[0];const initial=Array.from(String(b.apellido||'').trim())[0];return [first,initial?`${initial}.`:''].filter(Boolean).join(' ')||'Huésped';};
  const bookingTitle=(b:any)=>`${b.nombre||''} ${b.apellido||''} · Hab. ${b.numero} · ${labels[b.estado]||b.estado} · ${b.fecha_entrada} → ${b.fecha_salida}`;
  return <><PageHead eyebrow="PLANIFICACIÓN" title="Calendario de reservas" subtitle="Disponibilidad y estadías de un vistazo." action={<button className="primary-button" onClick={onNew}><Plus size={18}/> Nueva reserva</button>}/>
    <div className="toolbar calendar-toolbar"><div className="calendar-nav"><button className="icon-button" onClick={()=>move(-1)}><ChevronLeft size={18}/></button><strong>{title}</strong><button className="icon-button" onClick={()=>move(1)}><ChevronRight size={18}/></button><button className="ghost-button" onClick={()=>setSelected(today())}>Hoy</button></div><div className="calendar-view-tabs">{[['month','Mes'],['week','Semana'],['day','Día']].map(([value,label])=><button key={value} className={view===value?'selected':''} onClick={()=>setView(value as CalendarView)}>{label}</button>)}</div></div>
    <div className="calendar-legend"><span><i className="dot copper"/> Confirmada</span><span><i className="dot green"/> En casa</span><span><i className="dot gray"/> Finalizada</span></div>
    {view==='week'&&<div className="calendar-scroll"><div className="calendar-grid" style={{gridTemplateColumns:'170px repeat(7,minmax(90px,1fr))'}}><div className="calendar-corner">HABITACIÓN</div>{dates.map(d=><div className={`calendar-day ${d===today()?'current':''}`} key={d}><small>{formatDay(d,{weekday:'short'})}</small><b>{d.slice(-2)}</b></div>)}{rooms?.map(room=><div className="calendar-row" style={{gridColumn:'1 / -1',gridTemplateColumns:'170px repeat(7,minmax(90px,1fr))'}} key={room.idhabitacion}><div className="calendar-room"><BedDouble size={16}/><div><strong>{room.numero}</strong><small>{room.tipo}</small></div></div>{dates.map(d=><div className={`calendar-cell ${d===today()?'today':''}`} key={d}/>)}{bookingForRoom(room.idhabitacion).map(b=>{const begin=Math.max(0,daysBetween(weekStart,b.fecha_entrada));const finish=Math.min(7,daysBetween(weekStart,b.fecha_salida));return <button key={b.idreserva_habitacion} className={`calendar-booking status-${b.estado}`} style={{gridColumn:`${begin+2} / ${Math.max(begin+3,finish+2)}`,gridRow:1}} onClick={()=>openReservation(b.fk_idreserva)} title={bookingTitle(b)} aria-label={bookingTitle(b)}><span className="calendar-guest">{shortName(b)}</span></button>})}</div>)}</div>{!rooms?.length&&<Empty text="Agregá habitaciones para ver el calendario"/>}</div>}
    {view==='month'&&<div className="month-calendar"><div className="month-weekdays">{['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(d=><span key={d}>{d}</span>)}</div><div className="month-grid">{dates.map(d=><div className={`month-cell ${d.slice(0,7)!==monthStart.slice(0,7)?'outside':''} ${d===today()?'current':''}`} key={d}><b>{Number(d.slice(-2))}</b>{bookingForDay(d).slice(0,4).map(b=><button key={b.idreserva_habitacion} className={`month-booking status-${b.estado}`} onClick={()=>openReservation(b.fk_idreserva)} title={bookingTitle(b)} aria-label={bookingTitle(b)}><span className="month-room-number">{b.numero}</span><span className="calendar-guest">{shortName(b)}</span></button>)}{bookingForDay(d).length>4&&<button className="month-more" onClick={()=>{setSelected(d);setView('day')}}>+{bookingForDay(d).length-4} más</button>}</div>)}</div></div>}
    {view==='day'&&<div className="day-agenda">{rooms?.map(room=><div className="day-room" key={room.idhabitacion}><div className="day-room-title"><BedDouble size={17}/><strong>Habitación {room.numero}</strong><small>{room.tipo} · {room.estado_limpieza?.replaceAll('_',' ')}</small></div><div className="day-room-bookings">{bookingForRoom(room.idhabitacion).filter(b=>b.fecha_entrada<=selected&&b.fecha_salida>selected).map(b=><button key={b.idreserva_habitacion} className={`day-booking status-${b.estado}`} onClick={()=>openReservation(b.fk_idreserva)} title={bookingTitle(b)} aria-label={bookingTitle(b)}><strong>{shortName(b)}</strong><span>{b.fecha_entrada} → {b.fecha_salida}</span><Badge value={b.estado}/></button>)}{!bookingForRoom(room.idhabitacion).some(b=>b.fecha_entrada<=selected&&b.fecha_salida>selected)&&<span className="day-free">Disponible</span>}</div></div>)}{!rooms?.length&&<Empty text="Agregá habitaciones para ver el calendario"/>}</div>}
  </>;
}

function Reservations({refresh,onNew,open,transfer,user}:{refresh:number,onNew:()=>void,open:(id:string)=>void,transfer:(id:string)=>void,user:User|null}){
  const [filter,setFilter]=useState(''),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1);
  const now=useMinuteClock();
  const params=new URLSearchParams({pagina:String(page)});if(filter)params.set('estado',filter);if(query)params.set('q',query);
  const path='/reservas'+(params.size?'?'+params.toString():'');
  const key=path+'|'+refresh;
  const [result,setResult]=useState<{key:string;data:PageResult<any>|null;error:string}>({key:'',data:null,error:''});
  useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),250);return()=>clearTimeout(timer)},[search]);
  useEffect(()=>{
    let live=true;const controller=new AbortController();
    setResult({key,data:null,error:''});
    api<PageResult<any>>(path,{signal:controller.signal}).then(data=>{if(live)setResult({key,data,error:''})}).catch(e=>{if(live)setResult({key,data:null,error:e.message})});
    return()=>{live=false;controller.abort()};
  },[path,refresh]);
  const current=result.key===key&&search.trim()===query;
  const response=current?result.data:null,error=current?result.error:'',pages=response?Math.max(1,Math.ceil(response.total/50)):1;
  useEffect(()=>{if(response&&page>pages)setPage(pages)},[response,page,pages]);
  const correcting=Boolean(response&&page>pages),data=correcting?null:response?.registros,loading=(!response&&!error)||correcting;
  const canManage=['administracion','recepcion'].includes(user?.rol||'');
  return <>
    <PageHead eyebrow="RECEPCIÓN" title="Reservas" subtitle="Gestioná cada estadía, desde la confirmación hasta la salida." action={canManage&&<button className="primary-button" onClick={onNew}><Plus size={18}/> Nueva reserva</button>}/>
    <div className="card table-card" aria-busy={loading}>
      <div className="reservation-toolbar">
        <div className="tabs">{[['','Todas'],['confirmada','Confirmadas'],['en_casa','En casa'],['finalizada','Finalizadas']].map(([v,l])=><button key={v} className={filter===v?'selected':''} onClick={()=>{setFilter(v);setPage(1)}}>{l}</button>)}</div>
        <div className="searchbox reservation-search"><Search size={18}/><input aria-label="Buscar reservas" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Huésped, reserva o habitación"/>{search&&<button type="button" className="icon-button" aria-label="Limpiar búsqueda" onClick={()=>{setSearch('');setQuery('');setPage(1)}}><X size={16}/></button>}</div>
      </div>
      {error&&<div className="form-error" role="alert">{error}</div>}
      {loading&&<Empty text="Cargando reservas…"/>}
      {data&&<div className="table-wrap"><table><thead><tr><th>Reserva</th><th>Huésped</th><th>Habitación</th><th>Entrada</th><th>Salida</th><th>Estado</th><th></th></tr></thead>
        <tbody>{data.map(r=><tr key={r.idreserva}><td><b>#{r.idreserva}</b></td><td>{r.cliente_nombre} {r.cliente_apellido}</td><td>{r.habitaciones}</td><td>{r.fecha_entrada}</td><td>{r.fecha_salida}</td><td><div className="reservation-statuses"><Badge value={r.estado}/>{r.estado==='en_casa'&&r.checkouts?.some((checkout:any)=>isCheckoutOverdue(checkout,now))&&<span className="reservation-overdue">Check-out vencido</span>}</div></td><td><strong className={BigInt(r.saldo_gs||0)>0n?'reservation-balance-pending':'reservation-balance-paid'}>{gs(r.saldo_gs)}</strong></td><td><button className="small-button" onClick={()=>open(r.idreserva)}>Ver detalle <ArrowRight size={15}/></button>{canManage&&r.estado==='en_casa'&&<button className="small-button" onClick={()=>transfer(r.idreserva)}>Cambiar hab.</button>}</td></tr>)}</tbody>
      </table>{!data.length&&<Empty text={query?'No se encontraron reservas para esta búsqueda':'Todavía no hay reservas en esta vista'}/>}</div>}
      <Pagination page={page} total={response?.total??0} loading={loading} disabled={Boolean(error)} onChange={setPage}/>
    </div>
  </>;
}
function TransferRoom({id,onClose,refresh,run}:{id:string,onClose:()=>void,refresh:number,run:any}){
  const {data:r}=useLoad<any>('/reservas/'+id,refresh),{data:rooms}=useLoad<any[]>('/disponibilidad?desde='+today()+'&hasta='+(r?.fecha_salida||addDays(today(),1)),refresh);
  const [assignment,setAssignment]=useState(''),[room,setRoom]=useState(''),[rate,setRate]=useState('');
  return <Modal title={'Cambiar habitación · Reserva #'+id} onClose={onClose}>
    <p>La habitación anterior quedará pendiente de limpieza y los cargos de alojamiento se ajustarán por los días de cada habitación.</p>
    <form onSubmit={e=>{e.preventDefault();run(()=>api('/reservas/'+id+'/cambiar-habitacion',{method:'POST',body:JSON.stringify({fk_idreserva_habitacion:assignment,fk_idhabitacion:room,tarifa_noche_gs:rate})}),'Habitación cambiada')}}>
      <div className="form-grid">
        <Field label="Habitación actual"><select required value={assignment} onChange={e=>setAssignment(e.target.value)}><option value="">Seleccionar</option>{r?.habitaciones.filter((h:any)=>h.estado==='en_casa').map((h:any)=><option key={h.idreserva_habitacion} value={h.idreserva_habitacion}>{h.numero}</option>)}</select></Field>
        <Field label="Nueva habitación"><select required value={room} onChange={e=>setRoom(e.target.value)}><option value="">Seleccionar</option>{rooms?.map(h=><option key={h.idhabitacion} value={h.idhabitacion}>{h.numero} · {h.tipo}</option>)}</select></Field>
        <Field label="Nueva tarifa por noche (₲)"><input type="number" required min="0" value={rate} onChange={e=>setRate(e.target.value)}/></Field>
      </div>
      <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button className="primary-button">Confirmar cambio</button></div>
    </form>
  </Modal>;
}
function Rooms({refresh,onNew,run,user,openReservation}:{refresh:number,onNew:(s:string)=>void,run:any,user:User|null,openReservation:(id:string)=>void}){
  const{data:rooms}=useLoad<any[]>('/habitaciones',refresh),{data:floors}=useLoad<any[]>('/pisos',refresh);
  const[floorFilter,setFloorFilter]=useState('all'),now=useMinuteClock();
  const visibleRooms=rooms?.filter(r=>floorFilter==='all'||String(r.fk_idpiso)===floorFilter)||[];
  return <><PageHead eyebrow="INVENTARIO" title="Habitaciones" subtitle="Conocé el estado de cada habitación."/>
    <div className="floor-filters" role="group" aria-label="Filtrar por piso"><button className={floorFilter==='all'?'selected':''} onClick={()=>setFloorFilter('all')}>Todos</button>{floors?.map(p=><button key={p.idpiso} className={floorFilter===String(p.idpiso)?'selected':''} onClick={()=>setFloorFilter(String(p.idpiso))}>{p.nombre}</button>)}</div>
    <div className="room-grid">{visibleRooms.map(r=>{const state=roomVisualState(r,now);return <div className={`room-card room-state-${state}`} key={r.idhabitacion}>
      <div className="room-card-top"><div className="room-icon"><RoomStateIcon room={r} now={now}/></div><div className="room-statuses"><span className={`room-occupancy ${r.en_casa?'occupied':'unoccupied'}`}><Users size={12} aria-hidden="true"/>{r.en_casa?'En casa':'Sin huésped'}</span>{state==='overdue'&&<span className="room-overdue-badge">Check-out vencido</span>}<Badge value={r.estado_limpieza}/></div></div>
      <h3>Habitación {r.numero}</h3><p>{r.tipo} · {r.capacidad} personas · Piso {r.piso_numero} · {r.piso_nombre}</p>
      {r.en_casa&&<div className="room-guest-detail"><div className="room-guest-name"><Users size={14} aria-hidden="true"/><span>{[r.cliente_nombre,r.cliente_apellido].filter(Boolean).join(' ')||'Cliente alojado'}</span></div>{r.fk_idreserva_actual&&<button type="button" className="small-button" onClick={()=>openReservation(r.fk_idreserva_actual)}>Ver detalle <ArrowRight size={14}/></button>}</div>}
      <div className="room-card-bottom"><span>{r.fuera_servicio?'Fuera de servicio':'En servicio'}</span><select value={r.estado_limpieza} onChange={e=>run(()=>api(`/habitaciones/${r.idhabitacion}`,{method:'PATCH',body:JSON.stringify({estado_limpieza:e.target.value})}),'Estado actualizado')}><option value="limpia">Limpia</option><option value="sucia">Sucia</option><option value="en_limpieza">En limpieza</option><option value="inspeccion">Inspección</option></select></div>
    </div>})}</div>{!visibleRooms.length&&<div className="card"><Empty text="No hay habitaciones en este piso"/></div>}
  </>;
}

function Housekeeping({refresh,run}:{refresh:number,run:any}){const{data:tasks}=useLoad<any[]>('/limpieza',refresh),{data:rooms}=useLoad<any[]>('/habitaciones',refresh);return <><PageHead eyebrow="OPERACIONES" title="Limpieza" subtitle="Prepará cada habitación para recibir al próximo huésped."/><div className="house-grid"><section className="card"><div className="card-head"><div><span className="eyebrow">TAREAS ACTIVAS</span><h2>Pendientes</h2></div><span className="counter">{tasks?.length||0}</span></div>{tasks?.length?<div className="task-list">{tasks.map(t=><div className="task" key={t.idtarea_limpieza}><div className="task-icon"><Sparkles size={19}/></div><div className="grow"><strong>Habitación {t.numero}</strong><small>{t.nota||'Limpieza de habitación'} · {t.prioridad==='alta'?'Alta prioridad':'Normal'}</small></div><button className="small-button" onClick={()=>run(()=>api(`/limpieza/${t.idtarea_limpieza}`,{method:'PATCH',body:JSON.stringify({estado:t.estado==='pendiente'?'en_progreso':'completada'})}),'Tarea actualizada')}>{t.estado==='pendiente'?'Comenzar':'Completar'}</button></div>)}</div>:<Empty text="Todas las tareas están al día"/>}</section><section className="card"><div className="card-head"><div><span className="eyebrow">ESTADO GENERAL</span><h2>Habitaciones</h2></div></div><div className="clean-list">{rooms?.map(r=><div key={r.idhabitacion}><strong>{r.numero}</strong><span>{r.tipo}</span><Badge value={r.estado_limpieza}/></div>)}</div></section></div></>}

function Cash({refresh,run}:{refresh:number,run:any}){const{data:caja}=useLoad<any>('/caja',refresh),[initial,setInitial]=useState('0'),[closing,setClosing]=useState('0');return <><PageHead eyebrow="FINANZAS" title="Caja" subtitle="Registrá los cobros de cada turno y controlá el cierre."/><div className="cash-layout"><div className="card cash-hero"><div className="cash-icon"><Wallet size={28}/></div><span className="eyebrow">ESTADO DE CAJA</span><h2>{caja?'Caja abierta':'Caja cerrada'}</h2><p>{caja?`Abierta el ${new Date(caja.abierta_en).toLocaleString('es-PY')}`:'Abrí una caja para registrar pagos.'}</p>{caja?<div className="cash-form"><Field label="Efectivo contado al cierre (₲)"><input type="number" min="0" value={closing} onChange={e=>setClosing(e.target.value)}/></Field><button className="primary-button" onClick={()=>run(()=>api('/caja/cerrar',{method:'POST',body:JSON.stringify({monto_cierre_gs:closing})}),'Caja cerrada')}>Cerrar caja</button></div>:<div className="cash-form"><Field label="Monto inicial (₲)"><input type="number" min="0" value={initial} onChange={e=>setInitial(e.target.value)}/></Field><button className="primary-button" onClick={()=>run(()=>api('/caja/abrir',{method:'POST',body:JSON.stringify({monto_inicial_gs:initial})}),'Caja abierta')}>Abrir caja</button></div>}</div><div className="card"><div className="card-head"><div><span className="eyebrow">RESUMEN DEL TURNO</span><h2>Movimientos</h2></div></div><div className="cash-totals"><div><span>Fondo inicial</span><b>{gs(caja?.monto_inicial_gs)}</b></div>{caja?.totales?.map((x:any)=><div key={x.idforma_pago}><span>{x.forma_pago_nombre}</span><b>{gs(x.total_gs)}</b></div>)}</div></div></div></>}

function Invoices({refresh,open,run,user}:{refresh:number,open:(id:string)=>void,run:any,user:User|null}){const{data,error}=useLoad<any[]>('/facturas',refresh);const kude=async(id:string)=>{const token=localStorage.getItem('pms_token');const response=await fetch(`${'/api'}/facturas/${id}/kude`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok){const data=await response.json();throw new Error(data.message||'No se pudo descargar el KuDE')}const url=URL.createObjectURL(await response.blob());window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),60000)};const canIssue=['administracion','caja'].includes(user?.rol||'');return <><PageHead eyebrow="DNIT · SIFEN" title="Facturación electrónica" subtitle="Seguimiento de documentos enviados y respuestas de SIFEN."/><div className="notice"><CircleAlert size={20}/><span>Un documento es DTE únicamente cuando SIFEN lo aprueba. Revisá los pendientes y rechazados antes de entregar el KuDE.</span></div><div className="card table-card">{error&&<div className="form-error">{error}</div>}<div className="table-wrap"><table><thead><tr><th>Documento</th><th>Reserva</th><th>Número</th><th>CDC</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data?.map(f=><tr key={f.iddocumento_electronico}><td><b>#{f.iddocumento_electronico}</b> · {f.tipo==='factura'?'Factura':'Nota de crédito'}</td><td><button className="text-button" onClick={()=>open(f.fk_idreserva)}>#{f.fk_idreserva}</button></td><td>{f.numero||'—'}</td><td className="cdc-cell">{f.cdc||'—'}</td><td>{gs(f.total_gs)}</td><td><Badge value={f.estado}/></td><td><div className="invoice-actions">{canIssue&&f.estado==='borrador'&&<button className="small-button" onClick={()=>run(()=>api(`/facturas/${f.iddocumento_electronico}/emitir`,{method:'POST'}),'Emisión solicitada')}>Emitir</button>}{canIssue&&['firmado','enviado','pendiente','rechazado'].includes(f.estado)&&<button className="small-button" onClick={()=>run(()=>api(`/facturas/${f.iddocumento_electronico}/consultar`,{method:'POST'}),'Estado consultado')}>Consultar</button>}{f.estado==='aprobado'&&<button className="small-button" onClick={()=>run(()=>kude(f.iddocumento_electronico),'KuDE abierto')}>KuDE</button>}{canIssue&&f.estado==='aprobado'&&f.tipo==='factura'&&<button className="text-button" onClick={()=>run(()=>api(`/facturas/${f.iddocumento_electronico}/nota-credito`,{method:'POST'}),'Nota de crédito preparada')}>Nota de crédito</button>}</div></td></tr>)}</tbody></table>{!data?.length&&<Empty text="Aún no se emitieron documentos"/>}</div></div></>}
function Reports({refresh}:{refresh:number}){const[start,setStart]=useState(addDays(today(),-7)),[end,setEnd]=useState(addDays(today(),1));const{data,error}=useLoad<any[]>(`/informes/ocupacion?desde=${start}&hasta=${end}`,refresh);const max=Math.max(1,...(data||[]).map(x=>x.disponibles));return <><PageHead eyebrow="ANÁLISIS" title="Informes" subtitle="Ocupación diaria para tomar mejores decisiones."/><div className="card"><div className="report-filters"><Field label="Desde"><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></Field><Field label="Hasta"><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></Field></div>{error&&<div className="form-error">{error}</div>}<div className="chart">{data?.map(x=><div className="chart-column" key={x.fecha}><span>{x.ocupadas}/{x.disponibles}</span><div className="chart-track"><div style={{height:`${Math.max(4,x.ocupadas/max*100)}%`}}/></div><small>{x.fecha.slice(5)}</small></div>)}</div>{!data?.length&&<Empty text="No hay datos en este rango"/>}</div></>}

function SettingsPage({refresh,user,run}:{refresh:number,user:User|null,run:any}){const{data:hotel}=useLoad<any>('/hotel',refresh),{data:types}=useLoad<any[]>('/tipos-habitacion',refresh),{data:users}=useLoad<any[]>('/usuarios',refresh);const[form,setForm]=useState<any>({}),[newUser,setNewUser]=useState<any>({rol:'recepcion'});useEffect(()=>{if(hotel)setForm(hotel)},[hotel]);return <><PageHead eyebrow="ADMINISTRACIÓN" title="Configuración" subtitle="Datos de la propiedad, tipos de habitación y equipo."/><div className="settings-grid"><div className="card"><div className="card-head"><div><span className="eyebrow">PROPIEDAD</span><h2>Datos del hotel</h2></div></div><div className="form-grid"><Field label="Nombre"><input value={form.nombre||''} onChange={e=>setForm({...form,nombre:e.target.value})}/></Field><Field label="Razón social"><input value={form.razon_social||''} onChange={e=>setForm({...form,razon_social:e.target.value})}/></Field><Field label="RUC"><input value={form.ruc||''} onChange={e=>setForm({...form,ruc:e.target.value})}/></Field><Field label="Timbrado"><input value={form.timbrado||''} onChange={e=>setForm({...form,timbrado:e.target.value})}/></Field><Field label="Establecimiento"><input value={form.establecimiento||''} onChange={e=>setForm({...form,establecimiento:e.target.value})}/></Field><Field label="Punto de expedición"><input value={form.punto_expedicion||''} onChange={e=>setForm({...form,punto_expedicion:e.target.value})}/></Field><Field label="Dirección"><input value={form.direccion||''} onChange={e=>setForm({...form,direccion:e.target.value})}/></Field><Field label="Correo"><input value={form.email||''} onChange={e=>setForm({...form,email:e.target.value})}/></Field></div><button className="primary-button" disabled={user?.rol!=='administracion'} onClick={()=>run(()=>api('/hotel',{method:'PUT',body:JSON.stringify(form)}),'Hotel actualizado')}>Guardar cambios</button></div><div className="card"><div className="card-head"><div><span className="eyebrow">INVENTARIO</span><h2>Tipos de habitación</h2></div></div><div className="simple-list">{types?.map(t=><div key={t.idtipo_habitacion}><BedDouble size={17}/><span>{t.nombre}</span><small>{t.capacidad} personas</small></div>)}</div></div>{user?.rol==='administracion'&&<div className="card settings-users"><div className="card-head"><div><span className="eyebrow">EQUIPO</span><h2>Usuarios</h2></div></div><div className="simple-list">{users?.map(u=><div key={u.idusuario}><div className="row-avatar">{u.nombre.slice(0,1)}</div><span>{u.nombre} <small>{u.email}</small></span><Badge value={u.rol}/></div>)}</div><div className="form-grid top-space"><Field label="Nombre"><input value={newUser.nombre||''} onChange={e=>setNewUser({...newUser,nombre:e.target.value})}/></Field><Field label="Correo"><input type="email" value={newUser.email||''} onChange={e=>setNewUser({...newUser,email:e.target.value})}/></Field><Field label="Contraseña inicial"><input type="password" value={newUser.password||''} onChange={e=>setNewUser({...newUser,password:e.target.value})}/></Field><Field label="Rol"><select value={newUser.rol} onChange={e=>setNewUser({...newUser,rol:e.target.value})}><option value="recepcion">Recepción</option><option value="caja">Caja</option><option value="limpieza">Limpieza</option><option value="administracion">Administración</option></select></Field></div><button className="primary-button" onClick={()=>run(async()=>{await api('/usuarios',{method:'POST',body:JSON.stringify(newUser)});setNewUser({rol:'recepcion'})},'Usuario creado')}><Plus size={17}/> Crear usuario</button></div>}</div></>}

function NewClient({onClose,run}:{onClose:()=>void,run:any}){const[f,setF]=useState<any>({pais:'Paraguay'});return <Modal title="Nuevo huésped" onClose={onClose}><form onSubmit={e=>{e.preventDefault();run(()=>api('/clientes',{method:'POST',body:JSON.stringify(f)}),'Huésped creado')}}><div className="form-grid"><Field label="Nombre *"><input required value={f.nombre||''} onChange={e=>setF({...f,nombre:e.target.value})}/></Field><Field label="Apellido"><input value={f.apellido||''} onChange={e=>setF({...f,apellido:e.target.value})}/></Field><Field label="Tipo de documento"><select value={f.tipo_documento||''} onChange={e=>setF({...f,tipo_documento:e.target.value})}><option value="">Seleccionar</option><option>CI</option><option>Pasaporte</option><option>RUC</option></select></Field><Field label="Número de documento"><input value={f.documento||''} onChange={e=>setF({...f,documento:e.target.value})}/></Field><Field label="RUC"><input value={f.ruc||''} onChange={e=>setF({...f,ruc:e.target.value})}/></Field><Field label="Teléfono"><input value={f.telefono||''} onChange={e=>setF({...f,telefono:e.target.value})}/></Field><Field label="Correo"><input type="email" value={f.email||''} onChange={e=>setF({...f,email:e.target.value})}/></Field><Field label="País"><input value={f.pais||''} onChange={e=>setF({...f,pais:e.target.value})}/></Field></div><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button className="primary-button">Guardar huésped</button></div></form></Modal>}
function NewFloor({onClose,run}:{onClose:()=>void;run:any}){const[f,setF]=useState<any>({numero:1});return <Modal title="Nuevo piso" onClose={onClose}><form onSubmit={e=>{e.preventDefault();run(()=>api('/pisos',{method:'POST',body:JSON.stringify(f)}),'Piso creado')}}><div className="form-grid"><Field label="Número"><input type="number" min="1" step="1" required value={f.numero} onChange={e=>setF({...f,numero:e.target.value})}/></Field><Field label="Nombre"><input required value={f.nombre||''} onChange={e=>setF({...f,nombre:e.target.value})}/></Field></div><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button className="primary-button">Guardar piso</button></div></form></Modal>}
function NewRoomType({onClose,run}:{onClose:()=>void,run:any}){const[f,setF]=useState<any>({capacidad:2});return <Modal title="Nuevo tipo de habitación" onClose={onClose}><form onSubmit={e=>{e.preventDefault();run(()=>api('/tipos-habitacion',{method:'POST',body:JSON.stringify(f)}),'Tipo creado')}}><div className="form-grid"><Field label="Nombre"><input required value={f.nombre||''} onChange={e=>setF({...f,nombre:e.target.value})}/></Field><Field label="Capacidad"><input type="number" min="1" required value={f.capacidad} onChange={e=>setF({...f,capacidad:e.target.value})}/></Field></div><Field label="Descripción"><textarea value={f.descripcion||''} onChange={e=>setF({...f,descripcion:e.target.value})}/></Field><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button className="primary-button">Guardar tipo</button></div></form></Modal>}
function NewRoom({onClose,run,refresh}:{onClose:()=>void,run:any,refresh:number}){const{data:types}=useLoad<any[]>('/tipos-habitacion',refresh),{data:floors}=useLoad<any[]>('/pisos',refresh),{data:rates}=useLoad<any[]>('/tarifas',refresh),[f,setF]=useState<any>({});return <Modal title="Nueva habitación" onClose={onClose}><form onSubmit={e=>{e.preventDefault();run(()=>api('/habitaciones',{method:'POST',body:JSON.stringify(f)}),'Habitación creada')}}><div className="form-grid"><Field label="Número"><input required value={f.numero||''} onChange={e=>setF({...f,numero:e.target.value})}/></Field><Field label="Piso"><select required value={f.fk_idpiso||''} onChange={e=>setF({...f,fk_idpiso:e.target.value})}><option value="">Seleccionar</option>{floors?.map(p=><option key={p.idpiso} value={p.idpiso}>Piso {p.numero} · {p.nombre}</option>)}</select></Field><Field label="Tipo"><select required value={f.fk_idtipo_habitacion||''} onChange={e=>setF({...f,fk_idtipo_habitacion:e.target.value})}><option value="">Seleccionar</option>{types?.map(t=><option key={t.idtipo_habitacion} value={t.idtipo_habitacion}>{t.nombre}</option>)}</select></Field><Field label="Tarifa"><select required value={f.fk_idtarifa||''} onChange={e=>setF({...f,fk_idtarifa:e.target.value})}><option value="">Seleccionar</option>{rates?.filter(r=>r.fk_idtipo_habitacion===f.fk_idtipo_habitacion).map(r=><option key={r.idtarifa} value={r.idtarifa}>{r.nombre} · {new Intl.NumberFormat('es-PY').format(Number(r.monto_gs))} ₲</option>)}</select></Field></div><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button className="primary-button">Crear habitación</button></div></form></Modal>}
function NewRate({onClose,run,refresh}:{onClose:()=>void,run:any,refresh:number}){const{data:types}=useLoad<any[]>('/tipos-habitacion',refresh),[f,setF]=useState<any>({hora_checkin:'14:00',hora_checkout:'12:00',iva_tasa:10});return <Modal title="Nueva tarifa" onClose={onClose}><form onSubmit={e=>{e.preventDefault();run(()=>api('/tarifas',{method:'POST',body:JSON.stringify(f)}),'Tarifa creada')}}><div className="form-grid"><Field label="Nombre"><input required value={f.nombre||''} onChange={e=>setF({...f,nombre:e.target.value})}/></Field><Field label="Tipo de habitación"><select required value={f.fk_idtipo_habitacion||''} onChange={e=>setF({...f,fk_idtipo_habitacion:e.target.value})}><option value="">Seleccionar</option>{types?.map(t=><option key={t.idtipo_habitacion} value={t.idtipo_habitacion}>{t.nombre}</option>)}</select></Field><Field label="Check-in"><input type="time" step="60" required value={f.hora_checkin} onChange={e=>setF({...f,hora_checkin:e.target.value})}/></Field><Field label="Check-out"><input type="time" step="60" required value={f.hora_checkout} onChange={e=>setF({...f,hora_checkout:e.target.value})}/></Field><Field label="Precio por noche (₲)"><input type="number" min="0" required value={f.monto_gs||''} onChange={e=>setF({...f,monto_gs:e.target.value})}/></Field><Field label="IVA"><select value={f.iva_tasa} onChange={e=>setF({...f,iva_tasa:Number(e.target.value)})}><option value={10}>10%</option><option value={5}>5%</option><option value={0}>Exento</option></select></Field></div><div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button className="primary-button">Guardar tarifa</button></div></form></Modal>}
function NewReservation({onClose,run,onSaved}:{onClose:()=>void,run:any,onSaved:()=>void}){
  const[f,setF]=useState<any>({fecha_entrada:today(),fecha_salida:addDays(today(),1),adultos:1,ninos:0,origen:'directa'});
  const[clientQuery,setClientQuery]=useState('');
  const[clientOptions,setClientOptions]=useState<any[]>([]);
  const[clientLoading,setClientLoading]=useState(false);
  const[clientOpen,setClientOpen]=useState(false);
  const[reservationState,setReservationState]=useState<ActionResultState>('idle');
  const[reservationError,setReservationError]=useState('');
  const reservationLock=useRef(false);
  const reservationRequest=useRef<{body:string;key:string}|null>(null);
  const reservationRetry=useRef<(()=>Promise<void>)|null>(null);
  const{data:rooms}=useLoad<any[]>('/disponibilidad?desde='+f.fecha_entrada+'&hasta='+f.fecha_salida);
  const{data:rates}=useLoad<any[]>('/tarifas');
  const[selected,setSelected]=useState<string[]>([]);
  const rateFor=(room:any)=>rates?.find(r=>r.fk_idtipo_habitacion===room.fk_idtipo_habitacion)?.monto_gs||'0';
  const clientName=(client:any)=>[client.nombre,client.apellido].filter(Boolean).join(' ');
  useEffect(()=>{
    let live=true;
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      setClientLoading(true);
      api<any[]>('/clientes?q='+encodeURIComponent(clientQuery.trim()),{signal:controller.signal}).then(list=>{
        if(live)setClientOptions(list||[]);
      }).catch(()=>{if(live)setClientOptions([])}).finally(()=>{if(live)setClientLoading(false)});
    },250);
    return()=>{live=false;controller.abort();clearTimeout(timer)};
  },[clientQuery]);
  const chooseClient=(client:any)=>{
    setF((current:any)=>({...current,fk_idcliente:String(client.idcliente)}));
    setClientQuery(clientName(client));
    setClientOpen(false);
  };
  const changeClientQuery=(value:string)=>{
    setClientQuery(value);
    setF((current:any)=>({...current,fk_idcliente:''}));
    setClientOpen(true);
  };
  const submitReservation=async()=>{
    if(!f.fk_idcliente||!selected.length||reservationLock.current)return;
    reservationLock.current=true;
    reservationRetry.current=submitReservation;
    setReservationError('');
    setReservationState('loading');
    try{
      const body=JSON.stringify({...f,habitaciones:selected.map(id=>{
        const room=rooms?.find(x=>String(x.idhabitacion)===id);
        return {fk_idhabitacion:id,tarifa_noche_gs:room?rateFor(room):'0'};
      })});
      if(reservationRequest.current?.body!==body)reservationRequest.current={body,key:requestId()};
      await api('/reservas',{method:'POST',body,headers:{'Idempotency-Key':reservationRequest.current.key}});
      onSaved();
      setReservationState('success');
    }catch(error:any){
      reservationLock.current=false;
      setReservationError(error?.message||'No se pudo confirmar la reserva. Intentá nuevamente.');
      setReservationState('error');
    }
  };
  const submit=(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();void submitReservation()};
  const dismissResult=()=>{reservationLock.current=false;setReservationState('idle')};
  return <Modal title="Nueva reserva" onClose={reservationState==='loading'||reservationState==='success'?()=>{}:onClose}><form onSubmit={submit}>
    <div className="form-grid reservation-basics">
      <div className="field reservation-guest-field">
        <span>Huésped</span>
        <div className="guest-picker">
          <div className="searchbox guest-searchbox">
            <Search size={16}/>
            <input aria-label="Buscar huésped" role="combobox" aria-expanded={clientOpen} aria-autocomplete="list" value={clientQuery} onFocus={()=>setClientOpen(true)} onBlur={()=>setTimeout(()=>setClientOpen(false),150)} onChange={e=>changeClientQuery(e.target.value)} placeholder="Buscar por nombre o documento" required/>
          </div>
          {clientOpen&&<div className="guest-results" role="listbox">
            {clientLoading&&<div className="guest-result-state">Buscando huéspedes…</div>}
            {!clientLoading&&!clientOptions.length&&<div className="guest-result-state">No se encontraron huéspedes</div>}
            {!clientLoading&&clientOptions.map(client=><button type="button" role="option" key={client.idcliente} className="guest-result" onMouseDown={event=>event.preventDefault()} onClick={()=>chooseClient(client)}><strong>{clientName(client)}</strong><small>{client.documento||client.ruc||'Sin documento'}</small></button>)}
          </div>}
        </div>
      </div>
      <Field label="Adultos"><input type="number" min="1" step="1" value={f.adultos} onChange={e=>setF({...f,adultos:e.target.value})}/></Field>
      <Field label="Niños"><input type="number" min="0" step="1" value={f.ninos} onChange={e=>setF({...f,ninos:e.target.value})}/></Field>
      <Field label="Entrada"><input type="date" required value={f.fecha_entrada} onChange={e=>{setF({...f,fecha_entrada:e.target.value});setSelected([])}}/></Field>
      <Field label="Salida"><input type="date" required min={addDays(f.fecha_entrada,1)} value={f.fecha_salida} onChange={e=>{setF({...f,fecha_salida:e.target.value});setSelected([])}}/></Field>
    </div>
    <div className="field"><span>Habitaciones disponibles *</span><div className="room-picker">{rooms?.map(r=><button type="button" key={r.idhabitacion} className={"pick-room "+(selected.includes(String(r.idhabitacion))?'picked':'')} onClick={()=>setSelected(selected.includes(String(r.idhabitacion))?selected.filter(x=>x!==String(r.idhabitacion)):[...selected,String(r.idhabitacion)])}><BedDouble size={18}/><strong>{r.numero}</strong><small>{r.tipo}</small><span>{gs(rateFor(r))} / noche</span></button>)}</div>{!rooms?.length&&<small>No hay habitaciones libres en estas fechas.</small>}</div>
    <Field label="Observaciones"><textarea value={f.observaciones||''} onChange={e=>setF({...f,observaciones:e.target.value})}/></Field>
    <div className="modal-actions"><button type="button" className="ghost-button" disabled={reservationState==='loading'} onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!f.fk_idcliente||!selected.length||reservationState==='loading'}>Confirmar reserva</button></div>
  </form><ActionResultDialog state={reservationState} loadingTitle="Registrando reserva…" successTitle="Reserva confirmada" successMessage="La reserva se guardó correctamente." errorMessage={reservationError} onRetry={()=>{if(reservationRetry.current)void reservationRetry.current()}} onDismiss={dismissResult} onSuccessDone={()=>{dismissResult();onClose()}}/></Modal>
}

function ReservationPaymentForm({id,pay,setPay,refresh,onPaymentSaved,saldo}:{id:string;pay:any;setPay:(value:any)=>void;refresh:number;onPaymentSaved:()=>void;saldo:string}){
  const [paymentState,setPaymentState]=useState<'idle'|'loading'|'success'|'error'>('idle');
  const [paymentError,setPaymentError]=useState('');
  const submitLock=useRef(false);
  const solicitudId=useRef<string|null>(null);
  const paymentForm=useRef<HTMLFormElement|null>(null);
  const updatePay=(next:any)=>{solicitudId.current=null;setPay(next)};
  const integer=(value:unknown)=>typeof value==='string'&&/^\d+$/.test(value);
  const validAmount=integer(pay.monto_gs)&&BigInt(pay.monto_gs)>0n;
  const amountWithinBalance=validAmount&&BigInt(saldo)>0n&&BigInt(pay.monto_gs)<=BigInt(saldo);
  const showSuccess=()=>{
    updatePay({fk_idforma_pago:'',monto_gs:''});
    onPaymentSaved();
    setPaymentState('success');
  };
  const submit=async(e:React.FormEvent<HTMLFormElement>)=>{
    e.preventDefault();
    if(!amountWithinBalance||submitLock.current||paymentState!=='idle')return;
    submitLock.current=true;
    setPaymentState('loading');
    setPaymentError('');
    solicitudId.current??=requestId();
    try{
      await api(`/reservas/${id}/pagos`,{method:'POST',body:JSON.stringify({...pay,solicitud_id:solicitudId.current}),headers:{'Idempotency-Key':solicitudId.current},signal:AbortSignal.timeout(30000)});
      showSuccess();
    }catch(error:any){
      if(String(error?.message||'').includes('Este pago ya fue registrado')){
        try{
          const latest=await api<any>(`/reservas/${id}`);
          if(latest.pagos?.some((payment:any)=>payment.solicitud_id===solicitudId.current&&!payment.anulado)){
            showSuccess();
            return;
          }
        }catch{ /* Conservá el error original si no se puede comprobar el pago. */ }
      }
      setPaymentError(error?.message||'No se pudo registrar el pago. Intentá nuevamente.');
      setPaymentState('error');
    }finally{submitLock.current=false}
  };
  return <>
    {BigInt(saldo)<=0n?<p className="payment-balance-note">{BigInt(saldo)<0n?'La cuenta tiene un pago en exceso. Revisá los pagos registrados.':'La cuenta está saldada. No hay pagos pendientes.'}</p>:<form ref={paymentForm} className="payment-split-form" onSubmit={submit}>
      <PaymentMethodSelect value={pay.fk_idforma_pago} onChange={value=>updatePay({...pay,fk_idforma_pago:value})} refresh={refresh}/>
      <label className="field"><span>Monto a pagar (₲) · Saldo pendiente {gs(saldo)}</span><input type="text" inputMode="numeric" pattern="[0-9.]*" required value={formatAmountInput(pay.monto_gs)} onChange={e=>updatePay({...pay,monto_gs:amountDigits(e.target.value)})}/></label>
      <button className="small-button" disabled={!amountWithinBalance||paymentState!=='idle'}>Registrar pago</button>
      {validAmount&&!amountWithinBalance&&<span className="payment-split-error" role="alert">El pago no puede superar el saldo pendiente de {gs(saldo)}.</span>}
    </form>}
    <ActionResultDialog state={paymentState} loadingTitle="Registrando pago…" successTitle="Pago registrado" successMessage="La cuenta se está actualizando. Volverás a Pagos automáticamente." errorMessage={paymentError} onRetry={()=>{setPaymentState('idle');setTimeout(()=>paymentForm.current?.requestSubmit(),0)}} onDismiss={()=>setPaymentState('idle')} onSuccessDone={()=>setPaymentState('idle')}/>
  </>;
}
function ReservationFinancialDetail({id,onClose,refresh,run,user,onPaymentSaved}:{id:string,onClose:()=>void,refresh:number,run:any,user:User|null;onPaymentSaved:()=>void}){
  const {data:r,error}=useLoad<any>(`/reservas/${id}`,refresh);
  const [tab,setTab]=useState<'cuenta'|'pagos'|'facturas'>('cuenta');
  const [charge,setCharge]=useState<any>({tipo:'extra',cantidad:1,monto_unitario_gs:''});
  const [pay,setPay]=useState<any>({fk_idforma_pago:'',monto_gs:''});
  const [review,setReview]=useState<any|null>(null),[saved,setSaved]=useState<any|null>(null);
  const [busy,setBusy]=useState(false),[checkoutError,setCheckoutError]=useState('');
  const [operationState,setOperationState]=useState<ActionResultState>('idle'),[operationError,setOperationError]=useState('');
  const operationRetry=useRef<(()=>Promise<void>)|null>(null);
  const operationLock=useRef(false);
  const operationRequest=useRef<{path:string;key:string}|null>(null);
  const operationKey=(path:string)=>{if(operationRequest.current?.path!==path)operationRequest.current={path,key:requestId()};return operationRequest.current.key};
  const checkoutLock=useRef(false);
  const executeOperation=async(fn:()=>Promise<void>)=>{
    if(operationLock.current)return;
    operationLock.current=true;
    operationRetry.current=()=>executeOperation(fn);
    setOperationError('');setOperationState('loading');
    try{await fn();onPaymentSaved();setOperationState('success')}
    catch(e:any){operationLock.current=false;setOperationError(e?.message||'No se pudo completar la operación. Intentá nuevamente.');setOperationState('error')}
  };
  const closeReview=()=>{
    if(checkoutLock.current)return;
    if(saved){onClose();return;}
    if(review){setReview(null);setCheckoutError('');return;}
    onClose();
  };
  const openReview=async()=>{
    if(checkoutLock.current)return;
    checkoutLock.current=true;setBusy(true);setCheckoutError('');
    try{
      const latest=await api<any>(`/reservas/${id}`);
      if(latest.estado!=='en_casa')throw new Error('La reserva ya no está en casa');
      setReview(latest);
    }catch(e:any){setCheckoutError(e.message)}
    finally{checkoutLock.current=false;setBusy(false)}
  };
  const printTicket=async()=>{
    if(checkoutLock.current)return;
    const ticketTab=window.open('','_blank');
    checkoutLock.current=true;setBusy(true);setCheckoutError('');
    try{await openCheckoutTicket(id,ticketTab)}
    catch(e:any){if(ticketTab&&!ticketTab.closed)ticketTab.close();setCheckoutError(`No se pudo abrir el ticket: ${e.message}`)}
    finally{checkoutLock.current=false;setBusy(false)}
  };
  const confirmCheckout=async(print:boolean)=>{
    if(!review||saved||checkoutLock.current||BigInt(review.saldo_gs)!==0n)return;
    const action=async()=>{
      const ticketTab=print?window.open('','_blank'):null;
      checkoutLock.current=true;setBusy(true);setCheckoutError('');
      try{
        const path=`/reservas/${id}/check-out`;
        const result=await api<any>(path,{method:'POST',headers:{'Idempotency-Key':operationKey(path)},signal:AbortSignal.timeout(30000)});
        setSaved(result);
        if(print){
          try{await openCheckoutTicket(id,ticketTab)}
          catch(e:any){if(ticketTab&&!ticketTab.closed)ticketTab.close();setCheckoutError(`Salida registrada. No se pudo abrir el comprobante: ${e.message}`)}
        }
      }catch(e:any){if(ticketTab&&!ticketTab.closed)ticketTab.close();throw e}
      finally{checkoutLock.current=false;setBusy(false)}
    };
    await executeOperation(action);
  };
  const shown=saved?.checkout_resumen||review;
  const charges=shown?.cargos?.filter((item:any)=>!item.anulado)||[];
  const payments=shown?.pagos?.filter((item:any)=>!item.anulado)||[];
  const settled=shown&&BigInt(shown.saldo_gs)===0n;
  return <Modal title={review?(saved?'Salida registrada':'Confirmar salida'):`Reserva #${id}`} onClose={closeReview} className={review?'sale-detail-modal checkout-review-modal':''}>
    <ActionResultDialog state={operationState} loadingTitle={review?'Registrando salida…':'Registrando entrada…'} successTitle={review?'Salida registrada':'Entrada registrada'} errorMessage={operationError} onRetry={()=>{if(operationRetry.current)void operationRetry.current()}} onDismiss={()=>{operationLock.current=false;setOperationState('idle')}} onSuccessDone={()=>{operationLock.current=false;setOperationState('idle')}}/>
    {error&&<div className="form-error" role="alert">{error}</div>}
    {review&&shown?<><div className="sale-detail-hero"><div><span className="eyebrow">{saved?'SALIDA REGISTRADA':'REVISÁ ANTES DE FINALIZAR'}</span><p>Reserva #{id} · {[shown.cliente_nombre,shown.cliente_apellido].filter(Boolean).join(' ')}</p></div><span className={`sale-detail-status ${settled?'is-paid':'is-pending'}`}>{saved?'Salida realizada':settled?'Cuenta saldada':'Saldo pendiente'}</span></div>
      <div className="sale-detail-facts"><div><span>Huésped</span><strong>{[shown.cliente_nombre,shown.cliente_apellido].filter(Boolean).join(' ')}</strong></div><div><span>Reserva</span><strong>#{id}</strong></div><div><span>Habitaciones</span><strong>{shown.habitaciones.map((room:any)=>`Hab. ${room.numero}`).join(', ')}</strong></div><div><span>Entrada</span><strong>{shown.fecha_entrada}</strong></div><div><span>Salida prevista</span><strong>{shown.fecha_salida}</strong></div><div><span>{saved?'Salida realizada':'Revisión'}</span><strong>{checkoutDateTime(saved?.fecha_checkout||new Date().toISOString())}</strong></div></div>
      <section className="sale-detail-section"><div className="sale-detail-section-head"><div><span className="eyebrow">ESTADÍA</span><h3>Habitaciones</h3></div><span>{shown.habitaciones.length} habitación(es)</span></div><div className="sale-detail-items checkout-review-list">{shown.habitaciones.map((room:any,index:number)=><div className="sale-detail-item" key={room.idreserva_habitacion||index}><div><strong>Habitación {room.numero}</strong><span>{room.fecha_entrada} → {room.fecha_salida}</span></div></div>)}</div></section>
      <section className="sale-detail-section"><div className="sale-detail-section-head"><div><span className="eyebrow">CUENTA</span><h3>Cargos</h3></div><span>{charges.length} concepto(s)</span></div><div className="sale-detail-items checkout-review-list">{charges.map((item:any,index:number)=>{const amount=BigInt(item.importe_gs??(BigInt(item.cantidad)*BigInt(item.monto_unitario_gs)).toString())*(item.importe_gs?1n:item.tipo==='descuento'?-1n:1n);return <div className="sale-detail-item" key={item.idmovimiento||index}><div><strong>{item.descripcion}</strong><span>{item.cantidad} × {gs(item.monto_unitario_gs)}{item.tipo==='descuento'?' · Descuento':''}</span></div><b>{gs(amount)}</b></div>})}</div></section>
      <section className="sale-detail-section"><div className="sale-detail-section-head"><div><span className="eyebrow">CAJA</span><h3>Pagos y devoluciones</h3></div><span>{payments.length} movimiento(s)</span></div><div className="sale-detail-items checkout-review-list">{payments.map((payment:any,index:number)=><div className="sale-detail-item" key={payment.idpago||index}><div><strong>{payment.clase==='devolucion'?'Devolución':'Pago'} · {payment.forma_pago_nombre}</strong></div><b>{gs(payment.clase==='devolucion'?-BigInt(payment.monto_gs):payment.monto_gs)}</b></div>)}</div></section>
      <div className="sale-detail-amounts"><div><span>Total de cargos</span><strong>{gs(shown.total_gs)}</strong></div><div><span>Pagado</span><strong>{gs(shown.pagado_gs)}</strong></div><div><span>Saldo</span><strong>{gs(shown.saldo_gs)}</strong></div></div>
      {!settled&&!saved&&<p className="checkout-balance-note">La cuenta debe quedar en cero antes de registrar la salida.</p>}
      {checkoutError&&<div className="form-error" role="alert">{checkoutError}</div>}
      <div className="modal-actions sale-confirm-actions">{saved?<><button type="button" className="ghost-button" disabled={busy} onClick={closeReview}>Cerrar</button><button type="button" className="primary-button" disabled={busy} onClick={()=>void printTicket()}>{busy?'Abriendo ticket…':'Imprimir ticket'}</button></>:<><button type="button" className="ghost-button" disabled={busy} onClick={closeReview}>Cancelar</button>{!settled&&<button type="button" className="ghost-button" onClick={()=>{setReview(null);setTab('pagos');setCheckoutError('')}}>Volver a pagos</button>}<button type="button" className="ghost-button" disabled={busy||!settled} onClick={()=>void confirmCheckout(false)}>{busy?'Guardando…':'Guardar'}</button><button type="button" className="primary-button" disabled={busy||!settled} onClick={()=>void confirmCheckout(true)}>{busy?'Guardando…':'Imprimir ticket'}</button></>}</div>
    </>:r&&<><div className="detail-hero"><div><span className="eyebrow">HUÉSPED</span><h3>{r.cliente_nombre} {r.cliente_apellido}</h3><p>{r.fecha_entrada} → {r.fecha_salida} · {r.habitaciones.map((h:any)=>`Hab. ${h.numero}`).join(', ')}</p></div><Badge value={r.estado}/></div>
      <div className="detail-actions">{['administracion','recepcion'].includes(user?.rol||'')&&r.estado==='confirmada'&&<><button className="primary-button checkin-button" disabled={operationState==='loading'} onClick={()=>void executeOperation(()=>{const path=`/reservas/${id}/check-in`;return api(path,{method:'POST',headers:{'Idempotency-Key':operationKey(path)}}).then(()=>undefined)})}><LogIn size={17}/>{operationState==='loading'?'Registrando…':'Registrar entrada'}</button><button className="ghost-button danger" onClick={()=>{if(confirm('¿Cancelar esta reserva?'))run(()=>api(`/reservas/${id}/cancelar`,{method:'POST'}),'Reserva cancelada')}}>Cancelar reserva</button></>}{['administracion','recepcion'].includes(user?.rol||'')&&r.estado==='en_casa'&&<button className="primary-button checkout-button" disabled={busy||operationState==='loading'} onClick={()=>void openReview()}><LogOut size={17}/>{busy?'Cargando…':'Registrar salida'}</button>}{r.estado==='finalizada'&&r.fecha_checkout&&<button className="ghost-button checkout-button" disabled={busy||operationState==='loading'} onClick={()=>void printTicket()}><ReceiptText size={17}/>{busy?'Abriendo comprobante…':'Imprimir comprobante de salida'}</button>}</div>
      {checkoutError&&<div className="form-error" role="alert">{checkoutError}</div>}
      <div className="detail-totals"><div><small>Total de cargos</small><strong>{gs(r.total_gs)}</strong></div><div><small>Pagado</small><strong>{gs(r.pagado_gs)}</strong></div><div><small>Saldo</small><strong>{gs(r.saldo_gs)}</strong></div></div>
      <div className="tabs detail-tabs">{[['cuenta','Cuenta'],['pagos','Pagos'],['facturas','Facturas']].map(([v,l])=><button type="button" key={v} className={tab===v?'selected':''} onClick={()=>setTab(v as any)}>{l}</button>)}</div>
      {tab==='cuenta'&&<><div className="detail-list">{r.cargos.map((x:any)=><div key={x.idmovimiento}><span>{x.descripcion} <small className="detail-item-meta">{x.cantidad} × {gs(x.monto_unitario_gs)}{x.anulado?' · Anulado':''}</small></span><b>{gs(BigInt(x.monto_unitario_gs)*BigInt(x.cantidad))}</b></div>)}</div>{['administracion','recepcion','caja'].includes(user?.rol||'')&&r.estado!=='cancelada'&&<form className="inline-form" onSubmit={e=>{e.preventDefault();run(()=>api(`/reservas/${id}/cargos`,{method:'POST',body:JSON.stringify(charge)}),'Cargo registrado')}}><input placeholder="Descripción del cargo" required value={charge.descripcion||''} onChange={e=>setCharge({...charge,descripcion:e.target.value})}/><input type="number" min="0" placeholder="₲" required value={charge.monto_unitario_gs} onChange={e=>setCharge({...charge,monto_unitario_gs:e.target.value})}/><button className="small-button">Agregar</button></form>}</>}
      {tab==='pagos'&&<><div className="detail-list">{r.pagos.map((x:any)=><div key={x.idpago}><span>{x.forma_pago_nombre} <small>{new Date(x.fecha_creado).toLocaleString('es-PY')}</small></span><b>{gs(x.monto_gs)}</b>{x.anulado?<span className="badge status-cancelada" title={x.motivo_anulacion||''}>Anulado</span>:['administracion','caja'].includes(user?.rol||'')&&<AnnulPaymentButton payment={x} run={run}/>}</div>)}</div>{r.estado!=='cancelada'&&['administracion','caja'].includes(user?.rol||'')&&<ReservationPaymentForm id={id} pay={pay} setPay={setPay} refresh={refresh} onPaymentSaved={onPaymentSaved} saldo={r.saldo_gs}/>}</>}
      {tab==='facturas'&&<><div className="detail-list">{r.facturas.map((x:any)=><div key={x.iddocumento_electronico}><span>{x.tipo==='factura'?'Factura electrónica':'Nota de crédito'} #{x.iddocumento_electronico} <small>{x.cdc||'Sin CDC'} · {x.mensaje_respuesta||''}</small></span><Badge value={x.estado}/><button className="small-button" onClick={()=>run(()=>api(`/facturas/${x.iddocumento_electronico}/consultar`,{method:'POST'}),'Consulta enviada')}>Consultar</button></div>)}</div>{r.estado!=='cancelada'&&['administracion','caja'].includes(user?.rol||'')&&<button className="primary-button" onClick={()=>run(()=>api('/facturas',{method:'POST',body:JSON.stringify({fk_idreserva:id})}),'Documento preparado')}>Preparar factura</button>}</>}
    </>}
  </Modal>;
}
