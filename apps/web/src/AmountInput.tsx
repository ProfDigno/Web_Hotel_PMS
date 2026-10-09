import { useEffect, useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';

type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'value'|'onChange'|'min'|'max'> & {
  value:string|number|undefined;
  onChange:(value:string)=>void;
  min?:string|number;
  max?:string|number;
};

export const amountDigits=(value:string)=>value.replace(/\D/g,'').replace(/^0+(?=\d)/,'');
export const formatAmount=(value:string|number|undefined)=>String(value??'').replace(/\B(?=(\d{3})+(?!\d))/g,'.');

export function AmountInput({value,onChange,min=0,max,...props}:Props){
  const input=useRef<HTMLInputElement>(null);
  const cursor=useRef<number|null>(null);
  const digits=amountDigits(String(value??''));
  useLayoutEffect(()=>{
    const element=input.current;
    if(!element||cursor.current===null||document.activeElement!==element)return;
    const target=cursor.current;
    let position=0;
    let count=0;
    while(position<element.value.length&&count<target){
      if(/\d/.test(element.value[position]))count++;
      position++;
    }
    while(element.value[position]==='.')position++;
    element.setSelectionRange(position,position);
    cursor.current=null;
  },[digits]);
  useEffect(()=>{
    const element=input.current;
    if(!element)return;
    const below=digits!==''&&BigInt(digits)<BigInt(min);
    const above=digits!==''&&max!==undefined&&BigInt(digits)>BigInt(max);
    element.setCustomValidity(below?`El monto mínimo es ${formatAmount(min)}.`:above?`El monto máximo es ${formatAmount(max)}.`:'');
  },[digits,min,max]);
  return <input {...props} ref={input} type="text" inputMode="numeric" pattern="[0-9.]*" value={formatAmount(digits)} onChange={event=>{
    const before=event.target.value.slice(0,event.target.selectionStart??event.target.value.length);
    const next=amountDigits(event.target.value);
    cursor.current=next===digits?null:Math.min(amountDigits(before).length,next.length);
    onChange(next);
  }}/>;
}
