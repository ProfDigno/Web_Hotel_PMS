import PDFDocument from 'pdfkit';

const WIDTH_PT=80/25.4*72;
const MARGIN_PT=12;
const CONTENT_WIDTH=WIDTH_PT-MARGIN_PT*2;
const money=(value:unknown)=>`Gs. ${BigInt(String(value??0)).toLocaleString('es-PY')}`;
const localDate=(value:string)=>value.slice(0,10).split('-').reverse().join('/');
const localDateTime=(value:string)=>new Intl.DateTimeFormat('es-PY',{dateStyle:'short',timeStyle:'short',timeZone:'America/Asuncion'}).format(new Date(value));

type CheckoutSummary={
  idreserva:string;cliente_nombre:string;cliente_apellido:string|null;fecha_entrada:string;fecha_salida:string;
  fecha_checkout:string;registrado_por:string;hotel:{nombre:string;direccion:string|null;telefono:string|null}|null;
  habitaciones:{numero:string;fecha_entrada:string;fecha_salida:string}[];
  cargos:{tipo:string;descripcion:string;cantidad:number;monto_unitario_gs:string;importe_gs:string}[];
  pagos:{clase:string;forma_pago_nombre:string;monto_gs:string}[];
  total_gs:string;pagado_gs:string;saldo_gs:string;
};
type TicketLine={text:string;size:number;bold?:boolean;align?:'left'|'center'|'right';gap?:number;divider?:boolean};

export function createCheckoutTicket(summary:CheckoutSummary):PDFKit.PDFDocument {
  const lines:TicketLine[]=[];
  const add=(text:string,size=8,options:Partial<TicketLine>={})=>lines.push({text,size,...options});
  const divider=()=>lines.push({text:'',size:0,divider:true,gap:5});
  add(summary.hotel?.nombre||'Hotel',13,{bold:true,align:'center',gap:4});
  if(summary.hotel?.direccion)add(summary.hotel.direccion,8,{align:'center'});
  if(summary.hotel?.telefono)add(`Tel. ${summary.hotel.telefono}`,8,{align:'center'});
  add('TICKET DE CHECK-OUT',10,{bold:true,align:'center',gap:7});
  add(`Reserva #${summary.idreserva}`,10,{bold:true});
  add(`Salida: ${localDateTime(summary.fecha_checkout)}`,8,{gap:3});
  add(`Huésped: ${[summary.cliente_nombre,summary.cliente_apellido].filter(Boolean).join(' ')}`,8);
  add(`Estadía: ${localDate(summary.fecha_entrada)} - ${localDate(summary.fecha_salida)}`,8);
  divider();
  add('HABITACIONES',9,{bold:true,gap:4});
  for(const room of summary.habitaciones)add(`Hab. ${room.numero} · ${localDate(room.fecha_entrada)} - ${localDate(room.fecha_salida)}`,8,{gap:3});
  divider();
  add('CARGOS',9,{bold:true,gap:4});
  for(const item of summary.cargos){
    add(item.descripcion,8,{bold:true});
    add(`${item.tipo==='descuento'?'Descuento · ':''}${item.cantidad} x ${money(item.monto_unitario_gs)} = ${money(item.importe_gs)}`,8,{gap:4});
  }
  if(!summary.cargos.length)add('Sin cargos',8,{gap:3});
  divider();
  add('PAGOS',9,{bold:true,gap:4});
  for(const payment of summary.pagos)add(`${payment.clase==='devolucion'?'Devolución · ':''}${payment.forma_pago_nombre}: ${money(payment.clase==='devolucion'?(-BigInt(payment.monto_gs)).toString():payment.monto_gs)}`,8,{gap:4});
  if(!summary.pagos.length)add('Sin pagos',8,{gap:3});
  divider();
  add(`TOTAL: ${money(summary.total_gs)}`,10,{bold:true,align:'right',gap:3});
  add(`Pagado: ${money(summary.pagado_gs)}`,8,{align:'right'});
  add(`Saldo final: ${money(summary.saldo_gs)}`,8,{bold:true,align:'right',gap:7});
  add(`Check-out registrado por ${summary.registrado_por}`,7,{align:'center'});
  add('Comprobante operativo · No es factura',7,{align:'center'});

  const measure=new PDFDocument({size:[WIDTH_PT,10000],margin:MARGIN_PT});
  const lineHeight=(line:TicketLine)=>{
    if(line.divider)return 6;
    measure.font(line.bold?'Helvetica-Bold':'Helvetica').fontSize(line.size);
    return measure.heightOfString(line.text,{width:CONTENT_WIDTH,align:line.align||'left'})+2;
  };
  const heights=lines.map(lineHeight);
  const height=Math.max(120,MARGIN_PT*2+heights.reduce((sum,h,index)=>sum+h+(lines[index].gap||0),0)+4);
  measure.end();
  const pdf=new PDFDocument({size:[WIDTH_PT,height],margins:{top:MARGIN_PT,bottom:MARGIN_PT,left:MARGIN_PT,right:MARGIN_PT}});
  let y=MARGIN_PT;
  lines.forEach((line,index)=>{
    if(line.divider){pdf.moveTo(MARGIN_PT,y+2).lineTo(WIDTH_PT-MARGIN_PT,y+2).lineWidth(.5).strokeColor('#777777').stroke();y+=heights[index]+(line.gap||0);return;}
    pdf.font(line.bold?'Helvetica-Bold':'Helvetica').fontSize(line.size).fillColor('#111111');
    pdf.text(line.text,MARGIN_PT,y,{width:CONTENT_WIDTH,align:line.align||'left'});
    y+=heights[index]+(line.gap||0);
  });
  pdf.end();
  return pdf;
}
