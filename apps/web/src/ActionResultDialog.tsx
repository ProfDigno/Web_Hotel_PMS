import { useEffect, useRef } from 'react';
import { Check, CircleAlert } from 'lucide-react';
import './reservation-payment.css';

export type ActionResultState='idle'|'loading'|'success'|'error';

export function ActionResultDialog({state,loadingTitle,successTitle,successMessage='La información se está actualizando.',errorMessage,onRetry,onDismiss,onSuccessDone}:{state:ActionResultState;loadingTitle:string;successTitle:string;successMessage?:string;errorMessage:string;onRetry:()=>void;onDismiss:()=>void;onSuccessDone:()=>void}){
  const dialog=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{if(state==='loading'||state==='success')dialog.current?.focus()},[state]);
  useEffect(()=>{if(state!=='success')return;const timer=setTimeout(onSuccessDone,2000);return()=>clearTimeout(timer)},[state,onSuccessDone]);
  if(state==='idle')return null;
  return <div className="payment-result-backdrop"><div ref={dialog} tabIndex={-1} onKeyDown={e=>{if(e.key==='Tab')e.preventDefault()}} className="payment-result-dialog" role="dialog" aria-modal="true" aria-label={state==='loading'?loadingTitle:state==='success'?successTitle:'Error'}>
    {state==='loading'&&<><span className="payment-result-spinner" aria-hidden="true"/><h3>{loadingTitle}</h3><p>Esperá mientras confirmamos la operación.</p></>}
    {state==='success'&&<><span className="payment-result-icon is-success"><Check size={30}/></span><h3>{successTitle}</h3><p>{successMessage}</p></>}
    {state==='error'&&<><span className="payment-result-icon is-error"><CircleAlert size={30}/></span><h3>No se pudo completar la operación</h3><p role="alert">{errorMessage}</p><div className="payment-result-actions"><button type="button" className="primary-button" autoFocus onClick={onRetry}>Volver a intentar</button><button type="button" className="ghost-button" onClick={onDismiss}>Volver al formulario</button></div></>}
  </div></div>;
}
