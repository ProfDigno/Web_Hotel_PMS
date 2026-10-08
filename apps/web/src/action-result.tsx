import { useSyncExternalStore } from 'react';
import { ActionResultDialog, type ActionResultState } from './ActionResultDialog';
import { requestId } from './request-id';

export class ActionDismissedError extends Error {
  constructor(message='Operación cancelada'){super(message);}
}

type Display={state:ActionResultState;loadingTitle:string;successTitle:string;errorMessage:string};
type Pending={fingerprint:string;promise:Promise<any>;retry:()=>void;dismiss:()=>void;done:()=>void};
const empty:Display={state:'idle',loadingTitle:'',successTitle:'',errorMessage:''};
let display=empty;
let pending:Pending|null=null;
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};
const snapshot=()=>display;
const update=(value:Display)=>{display=value;listeners.forEach(listener=>listener())};

function titles(path:string,method:string):[string,string]{
  const rules:[RegExp,string,string][]=[
    [/\/gastos\/[^/]+\/anular$/, 'Anulando gasto…','Gasto anulado'],
    [/\/gastos-tipos/, 'Guardando tipo de gasto…','Tipo de gasto guardado'],
    [/\/gastos$/, 'Registrando gasto…','Gasto registrado'],
    [/\/reservas\/[^/]+\/pagos$/, 'Registrando pago…','Pago registrado'],
    [/\/pagos\/[^/]+\/anular$/, 'Anulando pago…','Pago anulado'],
    [/\/reservas\/[^/]+\/check-in$/, 'Registrando entrada…','Entrada registrada'],
    [/\/reservas\/[^/]+\/check-out$/, 'Registrando salida…','Salida registrada'],
    [/\/reservas\/[^/]+\/cancelar$/, 'Cancelando reserva…','Reserva cancelada'],
    [/\/reservas\/[^/]+\/cambiar-habitacion$/, 'Cambiando habitación…','Habitación cambiada'],
    [/\/reservas\/[^/]+\/cargos$/, 'Registrando cargo…','Cargo registrado'],
    [/\/reservas$/, 'Registrando reserva…','Reserva confirmada'],
    [/\/ventas\/[^/]+\/anular$/, 'Anulando venta…','Venta anulada'],
    [/\/ventas\/inventario\/ajustes$/, 'Ajustando inventario…','Inventario actualizado'],
    [/\/ventas\/productos/, 'Guardando producto…','Producto guardado'],
    [/\/ventas\/categorias/, 'Guardando categoría…','Categoría guardada'],
    [/\/ventas$/, 'Registrando venta…','Venta registrada'],
    [/\/caja\/abrir$/, 'Abriendo caja…','Caja abierta'],
    [/\/caja\/cerrar$/, 'Cerrando caja…','Caja cerrada'],
    [/\/limpieza/, 'Actualizando limpieza…','Limpieza actualizada'],
    [/\/facturas\/[^/]+\/emitir$/, 'Emitiendo factura…','Emisión solicitada'],
    [/\/facturas\/[^/]+\/consultar$/, 'Consultando SIFEN…','Estado consultado'],
    [/\/facturas\/[^/]+\/nota-credito$/, 'Preparando nota de crédito…','Nota de crédito preparada'],
    [/\/facturas$/, 'Preparando factura…','Factura preparada'],
    [/\/clientes/, 'Guardando huésped…','Huésped guardado'],
    [/\/usuarios/, 'Guardando usuario…','Usuario guardado'],
    [/\/hotel$/, 'Guardando datos del hotel…','Datos del hotel guardados'],
    [/\/formas-pago/, 'Guardando forma de pago…','Forma de pago guardada'],
    [/\/tipos-habitacion/, 'Guardando tipo de habitación…','Tipo de habitación guardado'],
    [/\/pisos/, 'Guardando piso…','Piso guardado'],
    [/\/tarifas/, 'Guardando tarifa…','Tarifa guardada'],
    [/\/habitaciones/, 'Guardando habitación…','Habitación actualizada'],
  ];
  const match=rules.find(([pattern])=>pattern.test(path));
  return match?[match[1],match[2]]:[method==='DELETE'?'Eliminando registro…':'Guardando cambios…',method==='DELETE'?'Registro eliminado':'Cambios guardados'];
}

export function performMutation<T>(path:string,method:string,body:string|undefined,request:(key:string)=>Promise<T>):Promise<T>{
  const fingerprint=JSON.stringify([path,method,body]);
  if(pending){
    if(pending.fingerprint===fingerprint)return pending.promise;
    return Promise.reject(new Error('Esperá a que termine la operación actual'));
  }
  const key=requestId();
  const [loadingTitle,successTitle]=titles(path,method);
  if(!listeners.size)return request(key);
  let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});
  let result:T;
  const dismiss=()=>{if(!pending)return;const message=display.errorMessage;pending=null;update(empty);reject(new ActionDismissedError(message))};
  const done=()=>{if(!pending)return;pending=null;update(empty);resolve(result)};
  const retry=()=>{if(!pending)return;update({state:'loading',loadingTitle,successTitle,errorMessage:''});void request(key).then(value=>{result=value;update({state:'success',loadingTitle,successTitle,errorMessage:''})}).catch(error=>update({state:'error',loadingTitle,successTitle,errorMessage:error instanceof Error?error.message:String(error)}))};
  pending={fingerprint,promise,retry,dismiss,done};
  retry();
  return promise;
}

export function ActionResultHost(){
  const state=useSyncExternalStore(subscribe,snapshot,snapshot);
  return <ActionResultDialog state={state.state} loadingTitle={state.loadingTitle} successTitle={state.successTitle} errorMessage={state.errorMessage} onRetry={()=>pending?.retry()} onDismiss={()=>pending?.dismiss()} onSuccessDone={()=>pending?.done()}/>;
}
