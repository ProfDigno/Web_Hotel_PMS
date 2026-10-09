import { useEffect, useState } from 'react';
import { api } from './api';

type Matrix={roles:string[];eventos:{clave:string;grupo:string;nombre:string}[];permisos:{rol:string;evento:string;habilitado:boolean}[]};
const names:Record<string,string>={administracion:'Administración',recepcion:'Recepción',caja:'Caja',limpieza:'Limpieza'};

export function PermissionsSettings(){
  const [matrix,setMatrix]=useState<Matrix|null>(null),[error,setError]=useState(''),[saving,setSaving]=useState('');
  useEffect(()=>{let live=true;api<Matrix>('/permisos/matriz').then(value=>{if(live){setMatrix(value);setError('')}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[]);
  const change=async(rol:string,evento:string,habilitado:boolean)=>{
    const key=`${rol}:${evento}`;setSaving(key);setError('');
    try{
      const row=await api<{rol:string;evento:string;habilitado:boolean}>(`/permisos/roles/${rol}/eventos/${evento}`,{method:'PATCH',body:JSON.stringify({habilitado})});
      setMatrix(current=>current?{...current,permisos:current.permisos.map(item=>item.rol===rol&&item.evento===evento?row:item)}:current);
      window.dispatchEvent(new Event('pms-permissions-changed'));
    }catch(e:any){setError(e.message||'No se pudo guardar el permiso')}
    finally{setSaving('')}
  };
  const groups=[...new Set(matrix?.eventos.map(event=>event.grupo)||[])];
  return <section className="card table-card permissions-settings"><div className="card-head"><div><span className="eyebrow">CONFIGURACIÓN</span><h2>Permisos por rol</h2><p>Habilitá las pantallas y formularios disponibles para cada rol.</p></div></div>
    {error&&<div className="form-error" role="alert">{error}</div>}
    {!matrix&&!error&&<p>Cargando permisos…</p>}
    {matrix&&<div className="table-wrap"><table className="types-table permissions-table"><thead><tr><th>Evento</th>{matrix.roles.map(rol=><th key={rol}>{names[rol]||rol}</th>)}</tr></thead><tbody>{groups.map(group=><FragmentGroup key={group} group={group} matrix={matrix} saving={saving} change={change}/>)}</tbody></table></div>}
  </section>;
}

function FragmentGroup({group,matrix,saving,change}:{group:string;matrix:Matrix;saving:string;change:(rol:string,evento:string,habilitado:boolean)=>void}){
  return <><tr className="permissions-group"><th colSpan={matrix.roles.length+1}>{group}</th></tr>{matrix.eventos.filter(event=>event.grupo===group).map(event=><tr key={event.clave}><td>{event.nombre}</td>{matrix.roles.map(rol=>{
    const enabled=matrix.permisos.find(item=>item.rol===rol&&item.evento===event.clave)?.habilitado??false;
    const locked=rol==='administracion'&&event.clave==='settings.permissions';
    return <td key={rol}><input type="checkbox" aria-label={`${event.nombre}: ${names[rol]||rol}`} checked={enabled} disabled={locked||Boolean(saving)} onChange={e=>void change(rol,event.clave,e.target.checked)}/></td>;
  })}</tr>)}</>;
}
