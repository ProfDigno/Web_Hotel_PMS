import { BadRequestException } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export const CASH_DENOMINATIONS = ['100000','50000','20000','10000','5000','1000'] as const;
export type CashCounts = Record<typeof CASH_DENOMINATIONS[number],string>;

export function countCash(raw:unknown):{billetes:CashCounts;total:string} {
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) throw new BadRequestException('Ingresá la cantidad de cada billete');
  const data=raw as Record<string,unknown>;
  if(Object.keys(data).length!==CASH_DENOMINATIONS.length || Object.keys(data).some(key=>!CASH_DENOMINATIONS.includes(key as typeof CASH_DENOMINATIONS[number])))
    throw new BadRequestException('El desglose debe contener exactamente las seis denominaciones');
  const billetes={} as CashCounts;
  let total=0n;
  for(const denomination of CASH_DENOMINATIONS){
    const value=data[denomination];
    if(!((typeof value==='string' && /^\d+$/.test(value)) || (typeof value==='number' && Number.isSafeInteger(value) && value>=0)))
      throw new BadRequestException(`Cantidad inválida para el billete de ₲ ${Number(denomination).toLocaleString('es-PY')}`);
    const count=BigInt(value);
    billetes[denomination]=count.toString();
    total+=BigInt(denomination)*count;
  }
  if(total>9223372036854775807n)throw new BadRequestException('El total contado excede el máximo permitido');
  return {billetes,total:total.toString()};
}

export type CashCloseSummary={
  version:number;idcaja:string;abierta_en:string;cerrada_en:string;registrado_por:string;
  hotel:{nombre:string;direccion:string|null;telefono:string|null}|null;
  monto_inicial_gs:string;billetes:CashCounts;monto_cierre_gs:string;efectivo_esperado_gs:string;diferencia_gs:string;
  cierre_totales:{ingresos_gs:string;egresos_gs:string;neto_gs:string;efectivo_gs:string;no_efectivo_gs:string};
  formas_pago:{nombre:string;es_efectivo:boolean;total_gs:string}[];
};

const money=(value:string)=>`Gs. ${BigInt(value).toLocaleString('es-PY')}`;
const dateTime=(value:string)=>new Intl.DateTimeFormat('es-PY',{dateStyle:'short',timeStyle:'short',timeZone:'America/Asuncion'}).format(new Date(value));
type Line={text:string;size:number;bold?:boolean;align?:'left'|'center'|'right';gap?:number;divider?:boolean};

export function createCashCloseTicket(summary:CashCloseSummary):PDFKit.PDFDocument {
  const width=80/25.4*72,margin=12,contentWidth=width-margin*2;
  const lines:Line[]=[];
  const add=(text:string,size=8,options:Partial<Line>={})=>lines.push({text,size,...options});
  const divider=()=>lines.push({text:'',size:0,divider:true,gap:5});
  add(summary.hotel?.nombre||'Hotel',13,{bold:true,align:'center',gap:4});
  if(summary.hotel?.direccion)add(summary.hotel.direccion,8,{align:'center'});
  if(summary.hotel?.telefono)add(`Tel. ${summary.hotel.telefono}`,8,{align:'center'});
  add('CIERRE DE CAJA',10,{bold:true,align:'center',gap:7});
  add(`Caja #${summary.idcaja}`,10,{bold:true});
  add(`Apertura: ${dateTime(summary.abierta_en)}`);
  add(`Cierre: ${dateTime(summary.cerrada_en)}`);
  add(`Responsable: ${summary.registrado_por}`);
  divider();
  add(`Fondo inicial: ${money(summary.monto_inicial_gs)}`,8,{gap:3});
  add(`Ingresos: ${money(summary.cierre_totales.ingresos_gs)}`);
  add(`Egresos: ${money(summary.cierre_totales.egresos_gs)}`);
  add(`Neto: ${money(summary.cierre_totales.neto_gs)}`);
  divider();
  add('MOVIMIENTOS POR FORMA DE PAGO',9,{bold:true,gap:4});
  for(const form of summary.formas_pago)add(`${form.nombre}${form.es_efectivo?' (efectivo)':''}: ${money(form.total_gs)}`,8,{gap:3});
  if(!summary.formas_pago.length)add('Sin movimientos');
  divider();
  add('BILLETES CONTADOS',9,{bold:true,gap:4});
  for(const denomination of CASH_DENOMINATIONS){
    const count=summary.billetes[denomination];
    add(`${money(denomination)} x ${count} = ${money((BigInt(denomination)*BigInt(count)).toString())}`,8,{gap:3});
  }
  divider();
  add(`Efectivo esperado: ${money(summary.efectivo_esperado_gs)}`,8);
  add(`Efectivo contado: ${money(summary.monto_cierre_gs)}`,9,{bold:true});
  add(`Diferencia: ${money(summary.diferencia_gs)}`,9,{bold:true,gap:7});
  add('Comprobante operativo · No es factura',7,{align:'center'});
  const measure=new PDFDocument({size:[width,10000],margin});
  const heights=lines.map(line=>{
    if(line.divider)return 6;
    measure.font(line.bold?'Helvetica-Bold':'Helvetica').fontSize(line.size);
    return measure.heightOfString(line.text,{width:contentWidth,align:line.align||'left'})+2;
  });
  const height=Math.max(120,margin*2+heights.reduce((sum,h,index)=>sum+h+(lines[index].gap||0),0)+4);
  measure.end();
  const pdf=new PDFDocument({size:[width,height],margins:{top:margin,bottom:margin,left:margin,right:margin}});
  let y=margin;
  lines.forEach((line,index)=>{
    if(line.divider){pdf.moveTo(margin,y+2).lineTo(width-margin,y+2).lineWidth(.5).strokeColor('#777777').stroke();y+=heights[index]+(line.gap||0);return;}
    pdf.font(line.bold?'Helvetica-Bold':'Helvetica').fontSize(line.size).fillColor('#111111');
    pdf.text(line.text,margin,y,{width:contentWidth,align:line.align||'left'});
    y+=heights[index]+(line.gap||0);
  });
  pdf.end();
  return pdf;
}
