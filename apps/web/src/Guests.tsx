import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, Users } from 'lucide-react';
import { api } from './api';
import { Pagination, type PageResult } from './Pagination';

type Guest={idcliente:string;nombre:string;apellido:string|null;documento:string|null;ruc:string|null;telefono:string|null;email:string|null};
type Reservation={idreserva:string;fecha_entrada:string;fecha_salida:string;habitaciones:string;estado:string};
type History={reservas:Reservation[];total:number;pagina:number;por_pagina:number};
type Props={refresh:number;onNew:()=>void;openReservation:(id:string)=>void;renderStatus:(value:string)=>ReactNode};

function useRequest<T>(path:string,refresh:number) {
  const key=path+'|'+refresh;
  const [result,setResult]=useState<{key:string;data:T|null;error:string;loading:boolean}>({key:'',data:null,error:'',loading:true});
  useEffect(()=>{
    let live=true;const controller=new AbortController();
    setResult({key,data:null,error:'',loading:true});
    api<T>(path,{signal:controller.signal})
      .then(data=>{if(live)setResult({key,data,error:'',loading:false})})
      .catch(e=>{if(live)setResult({key,data:null,error:e.message,loading:false})});
    return()=>{live=false;controller.abort()};
  },[path,refresh]);
  return result.key===key?result:{data:null,error:'',loading:true};
}

function Empty({text}:{text:string}) {
  return <div className="empty"><div className="empty-icon"><Users size={23}/></div><p>{text}</p></div>;
}

export function Guests({refresh,onNew,openReservation,renderStatus}:Props) {
  const [search,setSearch]=useState(''),[selected,setSelected]=useState<Guest|null>(null),[page,setPage]=useState(1);
  const {data:response,error,loading}=useRequest<PageResult<Guest>>('/clientes?pagina='+page+(search?'&q='+encodeURIComponent(search):''),refresh);
  const pages=response?Math.max(1,Math.ceil(response.total/50)):1;
  useEffect(()=>{if(response&&page>pages)setPage(pages)},[response,page,pages]);
  const correcting=Boolean(response&&page>pages),data=correcting?null:response?.registros;
  return <>
    <div className="page-head"><div><span className="eyebrow">HUÉSPEDES</span><h1>Huéspedes</h1><p>Información de las personas que se alojan en tu hotel.</p></div>
      <button className="primary-button" onClick={onNew}><Plus size={18}/> Nuevo huésped</button>
    </div>
    <section className="card table-card" aria-busy={loading||correcting}>
      <div className="guest-table-head"><div className="searchbox"><Search size={18}/><input aria-label="Buscar huéspedes" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Buscar por nombre o documento"/></div></div>
      {error&&<div className="form-error" role="alert">{error}</div>}
      {(loading||correcting)&&<Empty text="Cargando huéspedes…"/>}
      {data&&<div className="table-wrap"><table className="types-table guest-table">
        <thead><tr><th>Huésped</th><th>Documento</th><th>RUC</th><th>Teléfono</th><th>Correo</th><th>Acciones</th></tr></thead>
        <tbody>{data.map(c=><tr key={c.idcliente} className={String(selected?.idcliente)===String(c.idcliente)?'guest-selected':''}>
          <td><div className="person-cell"><div className="row-avatar">{c.nombre.slice(0,1)}</div><b>{c.nombre} {c.apellido}</b></div></td>
          <td>{c.documento||'—'}</td><td>{c.ruc||'—'}</td><td>{c.telefono||'—'}</td><td>{c.email||'—'}</td>
          <td><button className="small-button" aria-pressed={String(selected?.idcliente)===String(c.idcliente)} onClick={()=>setSelected(c)}>Ver historial</button></td>
        </tr>)}</tbody>
      </table>{!data.length&&<Empty text="No se encontraron huéspedes"/>}</div>}
      <Pagination page={page} total={response?.total??0} loading={loading||correcting} disabled={Boolean(error)} onChange={setPage}/>
    </section>
    {selected?<GuestHistory key={selected.idcliente} guest={selected} refresh={refresh} openReservation={openReservation} renderStatus={renderStatus}/>:<section className="card top-space"><Empty text="Seleccioná un huésped para ver su historial"/></section>}
  </>;
}

function GuestHistory({guest,refresh,openReservation,renderStatus}:{guest:Guest}&Pick<Props,'refresh'|'openReservation'|'renderStatus'>) {
  const [page,setPage]=useState(1);
  const {data,error,loading}=useRequest<History>('/clientes/'+guest.idcliente+'/reservas?pagina='+page,refresh);
  const pages=data?Math.max(1,Math.ceil(data.total/data.por_pagina)):1;
  useEffect(()=>{if(data&&page>pages)setPage(pages)},[data,page,pages]);
  return <section className="card table-card top-space guest-history" aria-busy={loading}>
    <div className="card-head guest-history-head"><div><span className="eyebrow">HISTORIAL</span><h2>Historial de reservas — {guest.nombre} {guest.apellido||''}</h2></div>{data&&<span className="counter">{data.total}</span>}</div>
    {error&&<div className="form-error" role="alert">{error}</div>}
    {loading&&<Empty text="Cargando historial…"/>}
    {data&&page<=pages&&<>
      <div className="table-wrap"><table className="types-table">
        <thead><tr><th>Reserva</th><th>Entrada</th><th>Salida</th><th>Habitaciones</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>{data.reservas.map(r=><tr key={r.idreserva}>
          <td><b>#{r.idreserva}</b></td><td>{r.fecha_entrada}</td><td>{r.fecha_salida}</td><td>{r.habitaciones||'Sin habitación'}</td><td>{renderStatus(r.estado)}</td>
          <td><button className="small-button" onClick={()=>openReservation(String(r.idreserva))}>Ver detalle</button></td>
        </tr>)}</tbody>
      </table></div>
      {!data.total?<Empty text="Este huésped no tiene reservas registradas"/>:<div className="guest-history-pagination">
        <span>Página {page} de {pages} · {data.total} reservas</span>
        <div className="button-group"><button className="ghost-button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={16}/> Anterior</button>
          <button className="ghost-button" disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>Siguiente <ChevronRight size={16}/></button></div>
      </div>}
    </>}
  </section>;
}
