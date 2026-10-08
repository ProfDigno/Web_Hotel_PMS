import { BASE } from './api';

export async function openCashTicket(id:string,tab:Window|null):Promise<void> {
  const token=localStorage.getItem('pms_token');
  let response:Response;
  try{response=await fetch(`${BASE}/cajas/${id}/ticket`,{headers:token?{Authorization:`Bearer ${token}`}:{}})}
  catch{throw new Error('No se pudo conectar con la API para abrir el ticket')}
  if(!response.ok){
    const error=await response.json().catch(()=>({}));
    throw new Error(error.message||`No se pudo abrir el ticket (${response.status})`);
  }
  const url=URL.createObjectURL(await response.blob());
  if(tab&&!tab.closed)tab.location.href=url;
  else{
    const link=document.createElement('a');link.href=url;link.download=`caja-${id}-cierre.pdf`;
    document.body.appendChild(link);link.click();link.remove();
  }
  window.setTimeout(()=>URL.revokeObjectURL(url),300000);
}
