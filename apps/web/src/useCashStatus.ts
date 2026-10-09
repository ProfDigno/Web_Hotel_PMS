import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

type CashStatus={open:boolean|null;error:string};

export function useCashStatus(token:string|null){
  const [status,setStatus]=useState<CashStatus>({open:null,error:''});
  const requestId=useRef(0);
  const refresh=useCallback(async()=>{
    const current=++requestId.current;
    if(!token){setStatus({open:null,error:''});return}
    try{
      const result=await api<{abierta:boolean}>('/caja/estado');
      if(current===requestId.current)setStatus({open:result.abierta,error:''});
    }catch(error:any){
      if(current===requestId.current)setStatus({open:null,error:error.message||'No se pudo consultar el estado de caja'});
    }
  },[token]);
  useEffect(()=>{
    void refresh();
    const update=()=>void refresh();
    window.addEventListener('focus',update);
    window.addEventListener('pms-cash-changed',update);
    const interval=window.setInterval(update,15_000);
    return()=>{requestId.current++;window.removeEventListener('focus',update);window.removeEventListener('pms-cash-changed',update);window.clearInterval(interval)};
  },[refresh]);
  return {...status,refresh};
}
