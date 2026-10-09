import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

type OwnPermissions={rol:string;eventos:string[]};
export const PermissionContext=createContext<(event:string)=>boolean>(()=>false);
export const useCan=()=>useContext(PermissionContext);

export function usePermissions(token:string|null){
  const [state,setState]=useState<{events:Set<string>;loading:boolean;error:string}>({events:new Set(),loading:true,error:''});
  const refresh=useCallback(async()=>{
    if(!token){setState({events:new Set(),loading:false,error:''});return}
    try{
      const result=await api<OwnPermissions>('/permisos/mios');
      setState({events:new Set(result.eventos),loading:false,error:''});
    }catch(error:any){setState({events:new Set(),loading:false,error:error.message||'No se pudieron cargar los permisos'})}
  },[token]);
  useEffect(()=>{
    void refresh();
    const update=()=>void refresh();
    window.addEventListener('focus',update);
    window.addEventListener('pms-permissions-changed',update);
    return()=>{window.removeEventListener('focus',update);window.removeEventListener('pms-permissions-changed',update)};
  },[refresh]);
  return {...state,refresh};
}
