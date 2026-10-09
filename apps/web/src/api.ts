import { performMutation } from './action-result';
import { requestId } from './request-id';

export const BASE = '/api';
export type Json = Record<string, any>;
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('pms_token');
  const method=(options.method||'GET').toUpperCase();
  const request=async(key?:string)=>{
    let response:Response;
    try { response=await fetch(`${BASE}${path}`,{...options,signal:options.signal??(['POST','PUT','PATCH','DELETE'].includes(method)?AbortSignal.timeout(path.includes('/facturas/')?120000:30000):undefined),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...(key?{'Idempotency-Key':key}:{}),...options.headers}}); }
    catch(error){if(error instanceof Error&&error.name==='TimeoutError')throw new Error('La solicitud tardó demasiado. Podés volver a intentar sin duplicar el registro.');throw new Error('No se pudo conectar con la API. Revisá que esté iniciada.');}
    if(response.status===401&&!path.includes('/auth/login')){localStorage.removeItem('pms_token');location.reload();}
    const data=await response.json().catch(()=>({}));
    if(!response.ok){if(response.status===403)window.dispatchEvent(new Event('pms-permissions-changed'));if(response.status===409&&data.code==='CAJA_CERRADA')window.dispatchEvent(new Event('pms-cash-changed'));throw new Error(data.message?(Array.isArray(data.message)?data.message.join(', '):data.message):`Error ${response.status}`)}
    return data as T;
  };
  if(['POST','PUT','PATCH','DELETE'].includes(method)&&!path.includes('/auth/login')){
    const nativeKey=new Headers(options.headers).get('Idempotency-Key');
    if(nativeKey)return request(nativeKey);
    let attempts=0;
    const fiscal=path.match(/^\/facturas\/(\d+)\/(emitir|reintentar)$/);
    return performMutation(path,method,typeof options.body==='string'?options.body:undefined,async key=>{
      if(fiscal&&attempts++>0){
        const document=await api<any>(`/facturas/${fiscal[1]}`);
        if(document.estado!=='borrador'){
          if(document.cdc&&document.estado!=='aprobado')return api<T>(`/facturas/${fiscal[1]}/consultar`,{method:'POST',headers:{'Idempotency-Key':requestId()}});
          return document as T;
        }
      }
      return request(key);
    });
  }
  return request();
}
export const gs = (value: string | number | bigint | undefined) => `₲ ${BigInt(value || 0).toLocaleString('es-PY')}`;
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a: string,b: string) => Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
