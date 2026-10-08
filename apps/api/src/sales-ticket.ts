import PDFDocument from 'pdfkit';

const WIDTH_PT=80/25.4*72;
const MARGIN_PT=12;
const CONTENT_WIDTH=WIDTH_PT-MARGIN_PT*2;
const money=(value:unknown)=>`Gs. ${BigInt(String(value??0)).toLocaleString('es-PY')}`;
const dateTime=(value:unknown)=>new Intl.DateTimeFormat('es-PY',{dateStyle:'short',timeStyle:'short',timeZone:'America/Asuncion'}).format(new Date(String(value)));

type TicketLine={text:string;size:number;bold?:boolean;align?:'left'|'center'|'right';gap?:number;divider?:boolean};

export function createSaleTicket(sale:any,hotel:any):PDFKit.PDFDocument {
  const lines:TicketLine[]=[];
  const add=(text:string,size=9,options:Partial<TicketLine>={})=>lines.push({text,size,...options});
  const divider=()=>lines.push({text:'',size:0,divider:true,gap:5});

  add(hotel?.nombre||'Hotel',13,{bold:true,align:'center',gap:4});
  if(hotel?.direccion)add(hotel.direccion,8,{align:'center'});
  if(hotel?.telefono)add(`Tel. ${hotel.telefono}`,8,{align:'center'});
  add('TICKET DE CONSUMICIÓN',10,{bold:true,align:'center',gap:7});
  add(`Venta #${sale.idventa}`,10,{bold:true});
  add(dateTime(sale.fecha_creado),8,{gap:3});
  add(`Destino: ${sale.destino==='habitacion'?'Habitación':'Restaurante'}`,8);
  if(sale.fk_idreserva){
    add(`Reserva #${sale.fk_idreserva} · Hab. ${sale.habitacion_numero}`,8);
    add(`Huésped: ${[sale.cliente_nombre,sale.cliente_apellido].filter(Boolean).join(' ')}`,8);
  }else add('Venta sin habitación',8);
  if(sale.anulado)add('VENTA ANULADA',10,{bold:true,align:'center',gap:4});
  divider();
  for(const item of sale.items){
    add(item.nombre_producto,9,{bold:true});
    add(`${item.cantidad} x ${money(item.precio_unitario_gs)} = ${money(BigInt(item.precio_unitario_gs)*BigInt(item.cantidad))}`,8);
    add(item.pago_inicial==='pagado'?'Pagado al registrar':'Pendiente al registrar',7,{gap:6});
  }
  divider();
  add(`TOTAL: ${money(sale.total_gs)}`,11,{bold:true,align:'right',gap:3});
  add(`Cobrado ahora: ${money(sale.pagado_inicial_gs)}`,8,{align:'right'});
  add(`Pendiente: ${money(BigInt(sale.total_gs)-BigInt(sale.pagado_inicial_gs))}`,8,{align:'right',gap:5});
  const payment=sale.pagos.find((p:any)=>p.clase==='pago'&&!p.anulado);
  if(payment)add(`Forma de pago: ${payment.forma_pago_nombre}`,8);
  if(sale.anulado&&sale.motivo_anulacion)add(`Motivo de anulación: ${sale.motivo_anulacion}`,8);
  divider();
  add(`Registrado por ${sale.creado_por}`,7,{align:'center'});

  const measure=new PDFDocument({size:[WIDTH_PT,10000],margin:MARGIN_PT});
  const lineHeight=(line:TicketLine)=>{
    if(line.divider)return 6;
    measure.font(line.bold?'Helvetica-Bold':'Helvetica').fontSize(line.size);
    return measure.heightOfString(line.text,{width:CONTENT_WIDTH,align:line.align||'left'})+2;
  };
  const heights=lines.map(lineHeight);
  const height=Math.max(120,MARGIN_PT*2+heights.reduce((sum,h,index)=>sum+h+(lines[index].gap||0),0)+4);
  measure.end();

  const pdf=new PDFDocument({size:[WIDTH_PT,height],margins:{top:MARGIN_PT,bottom:MARGIN_PT,left:MARGIN_PT,right:MARGIN_PT},autoFirstPage:true});
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
