import { BadRequestException } from '@nestjs/common';
import { parseStringPromise } from 'xml2js';

function textValue(xml:any,key:string): string | undefined {
  if(xml==null||typeof xml!=='object') return;
  for(const [name,value] of Object.entries(xml)) {
    if(name.split(':').pop()===key) return Array.isArray(value) ? String(value[0]) : String(value);
    const found=textValue(value,key); if(found) return found;
  }
}
export async function responseState(raw:any) {
  const xml=typeof raw==='string'?raw:JSON.stringify(raw);
  let parsed:any={}; try { parsed=await parseStringPromise(xml); } catch {}
  const code=textValue(parsed,'dCodRes') || '', message=textValue(parsed,'dMsgRes') || textValue(parsed,'dEstRes') || '';
  const state=code==='0260'||code==='0261' ? 'aprobado' : /^0[34]/.test(code)||/rechazad/i.test(message) ? 'rechazado' : 'pendiente';
  return {xml,code,message,state};
}
export function cdcOf(xml:string) { return xml.match(/<DE\s+Id="(\d{44})"/)?.[1] || xml.match(/<dCDC>(\d{44})<\/dCDC>/)?.[1] || null; }
export function safeNumber(v:string){const n=Number(v);if(!Number.isSafeInteger(n))throw new BadRequestException('Importe fuera del rango admitido para SIFEN');return n}
