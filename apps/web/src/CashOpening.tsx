import { useState } from 'react';
import { Wallet, LogOut } from 'lucide-react';
import { AmountInput } from './AmountInput';
import { api } from './api';
import './cash-opening.css';

export function CashOpening({onOpened,onLogout}:{onOpened:()=>Promise<void>;onLogout:()=>void}){
  const [initial,setInitial]=useState('0');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const open=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError('');
    try{
      await api('/caja/abrir',{method:'POST',body:JSON.stringify({monto_inicial_gs:initial||'0'})});
      await onOpened();
    }catch(error:any){setError(error.message||'No se pudo abrir la caja')}
    finally{setBusy(false)}
  };
  return <div className="cash-opening-page">
    <div className="cash-opening-top"><strong>Casa Hotel</strong><button type="button" className="ghost-button" onClick={onLogout}><LogOut size={16}/> Cerrar sesión</button></div>
    <form className="card cash-opening-card" onSubmit={event=>void open(event)}>
      <div className="cash-opening-icon"><Wallet size={27}/></div>
      <span className="eyebrow">INICIO DE TURNO</span>
      <h1>Caja cerrada</h1>
      <p>Abrí una caja para empezar a trabajar en el sistema.</p>
      <label className="field"><span>Monto inicial (₲)</span><AmountInput value={initial} onChange={setInitial} required disabled={busy}/></label>
      {error&&<div className="form-error" role="alert">{error}</div>}
      <button type="submit" className="primary-button" disabled={busy}>{busy?'Abriendo caja…':'Abrir caja'}</button>
    </form>
  </div>;
}
