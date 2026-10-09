import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import xmlgen from 'facturacionelectronicapy-xmlgen';
import xmlsign from 'facturacionelectronicapy-xmlsign';
import qrgen from 'facturacionelectronicapy-qrgen';
import setapi from 'facturacionelectronicapy-setapi';
import { query, transaction } from './db';
import { Actor, AuthGuard } from './auth';
import { one, positiveInt } from './common';
import { cdcOf, responseState, safeNumber } from './sifen';

type FiscalData = { cliente: any; hotel: any; items: any[]; descuentoGlobal: number; pagado: string; total: string; referencia?: string };
const env = () => {
  if(process.env.SIFEN_ENV==='prod') {
    if(process.env.SIFEN_PRODUCTION_ENABLED!=='true') throw new BadRequestException('Producción SIFEN deshabilitada hasta completar la homologación');
    return 'prod' as const;
  }
  return 'test' as const;
};
const credentials = () => {
  const cert=process.env.SIFEN_CERT_PATH,pass=process.env.SIFEN_CERT_PASSWORD,csc=process.env.SIFEN_CSC,idcsc=process.env.SIFEN_CSC_ID;
  if(!cert||!pass||!csc||!idcsc) throw new BadRequestException('Faltan certificado, contraseña o CSC de SIFEN');
  return {cert,pass,csc,idcsc};
};
const params = () => {
  try { const raw=process.env.SIFEN_PARAMS_PATH?readFileSync(resolve(__dirname,'../../../',process.env.SIFEN_PARAMS_PATH),'utf8'):process.env.SIFEN_PARAMS_JSON||'{}'; const p=JSON.parse(raw); if(!p.ruc||!p.timbradoNumero||!p.establecimientos?.length) throw new Error(); return p; }
  catch { throw new BadRequestException('Configurá SIFEN_PARAMS_PATH con los datos completos del emisor según el Manual Técnico'); }
};
const localTimestamp=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T');
function makeData(doc:any, snapshot:FiscalData, issuer:any) {
  const customer=snapshot.cliente, taxable=Boolean(customer.ruc), amount=safeNumber(snapshot.total);
  const paid=BigInt(snapshot.pagado)>=BigInt(snapshot.total);
  return {
    tipoDocumento:doc.tipo==='factura'?1:5, establecimiento:issuer.establecimientos[0].codigo,
    punto:issuer.punto||process.env.SIFEN_PUNTO||'001', numero:doc.numero,
    fecha:localTimestamp(),tipoEmision:1,tipoTransaccion:1,tipoImpuesto:1,moneda:'PYG',
    descripcion:doc.tipo==='factura'?'Servicios de hospedaje':'Nota de crédito por servicios de hospedaje',
    cliente:taxable?{contribuyente:true,ruc:customer.ruc,razonSocial:`${customer.nombre} ${customer.apellido||''}`.trim(),tipoOperacion:1,direccion:customer.direccion||'No informado',pais:'PRY',paisDescripcion:'Paraguay'}:
      {contribuyente:false,razonSocial:`${customer.nombre} ${customer.apellido||''}`.trim(),tipoOperacion:2,documentoTipo:customer.tipo_documento==='Pasaporte'?2:1,documentoNumero:customer.documento||'0',pais:'PRY',paisDescripcion:'Paraguay'},
    factura:{presencia:1},
    ...(doc.tipo==='nota_credito'?{notaCreditoDebito:{motivo:1},documentoAsociado:{formato:1,cdc:snapshot.referencia}}:{}),
    condicion:paid?{tipo:1,entregas:[{tipo:1,monto:amount,moneda:'PYG'}]}:{tipo:2,credito:{tipo:1,plazo:'30 días'}},
    descuentoGlobal:snapshot.descuentoGlobal,
    items:snapshot.items.map((x,i)=>({codigo:String(i+1).padStart(3,'0'),descripcion:x.descripcion,unidadMedida:77,cantidad:Number(x.cantidad),precioUnitario:safeNumber(String(x.monto_unitario_gs)),ivaTipo:Number(x.iva_tasa)===0?3:1,ivaProporcion:Number(x.iva_tasa)===0?0:100,iva:Number(x.iva_tasa)}))
  };
}

@Controller('api/facturas') @UseGuards(AuthGuard)
export class FiscalController {
  @Get() async list() { return (await query('SELECT iddocumento_electronico,fk_idreserva,tipo,estado,cdc,numero,total_gs,codigo_respuesta,mensaje_respuesta,fecha_creado FROM documento_electronico WHERE activo ORDER BY iddocumento_electronico DESC LIMIT 300')).rows; }
  @Post() async prepare(@Body() body:any,@Req() req:any) {
    const id=positiveInt(body.fk_idreserva,'reserva'),u=req.user as Actor;
    try { return await transaction(async tx=>{
      const r=one((await tx.query('SELECT * FROM reserva WHERE idreserva=$1 AND activo AND estado IN (\'en_casa\',\'finalizada\') FOR UPDATE',[id])).rows,'Reserva en casa o finalizada');
      const customer=one((await tx.query('SELECT * FROM cliente WHERE idcliente=$1',[r.fk_idcliente])).rows,'Cliente');
      const hotel=one((await tx.query('SELECT * FROM hotel WHERE activo LIMIT 1')).rows,'Hotel');
      const movements=(await tx.query('SELECT * FROM movimiento WHERE fk_idreserva=$1 AND activo AND NOT anulado ORDER BY idmovimiento',[id])).rows;
      const items=movements.filter(x=>x.tipo!=='descuento'); if(!items.length) throw new BadRequestException('La cuenta no tiene cargos facturables');
      const discount=movements.filter(x=>x.tipo==='descuento').reduce((v,x)=>v+BigInt(x.cantidad)*BigInt(x.monto_unitario_gs),0n);
      const subtotal=items.reduce((v,x)=>v+BigInt(x.cantidad)*BigInt(x.monto_unitario_gs),0n);
      if(discount>subtotal) throw new BadRequestException('El descuento supera los cargos');
      const paid=(await tx.query("SELECT COALESCE(SUM(CASE WHEN clase='devolucion' THEN -monto_gs ELSE monto_gs END),0)::text AS total FROM pago WHERE fk_idreserva=$1 AND activo AND NOT anulado",[id])).rows[0].total;
      const snapshot={cliente:customer,hotel,items,descuentoGlobal:safeNumber(discount.toString()),pagado:paid,total:(subtotal-discount).toString()} as FiscalData;
      const row=(await tx.query("INSERT INTO documento_electronico(fk_idreserva,tipo,total_gs,datos,creado_por) VALUES($1,'factura',$2,$3,$4) RETURNING *",[id,snapshot.total,JSON.stringify(snapshot),u.nombre])).rows[0];
      const number=String(row.iddocumento_electronico).padStart(7,'0');
      if(number.length>7) throw new BadRequestException('Se agotó la numeración fiscal');
      await tx.query('UPDATE documento_electronico SET numero=$1 WHERE iddocumento_electronico=$2',[number,row.iddocumento_electronico]);
      return {...row,numero:number};
    }); } catch(e:any) { if(e.code==='23505') throw new ConflictException('Esta reserva ya tiene una factura'); throw e; }
  }
  @Get(':id') async detail(@Param('id') id:string){ return one((await query('SELECT * FROM documento_electronico WHERE iddocumento_electronico=$1 AND activo',[id])).rows,'Documento'); }
  @Post(':id/emitir') async issue(@Param('id') id:string,@Req() req:any) {
    const u=req.user as Actor, cred=credentials(),issuer=params();
    const doc=one((await query('SELECT * FROM documento_electronico WHERE iddocumento_electronico=$1 AND activo',[id])).rows,'Documento');
    if(doc.estado!=='borrador') throw new BadRequestException('Este documento ya fue procesado');
    const snap=doc.datos as FiscalData;
    if(snap.hotel.ruc!==issuer.ruc||snap.hotel.timbrado!==issuer.timbradoNumero) throw new BadRequestException('El RUC o timbrado del hotel no coincide con la configuración SIFEN');
    const xml=await xmlgen.generateXMLDE(issuer,makeData(doc,snap,issuer));
    const signed=await xmlsign.signXML(xml,cred.cert,cred.pass,true);
    const withQr=await qrgen.generateQR(signed,cred.idcsc,cred.csc,env());
    const cdc=cdcOf(withQr); if(!cdc) throw new BadRequestException('No se pudo obtener el CDC del XML generado');
    const updated=(await query("UPDATE documento_electronico SET xml=$1,xml_firmado=$2,cdc=$3,estado='firmado',intento=intento+1 WHERE iddocumento_electronico=$4 AND estado='borrador' RETURNING *",[xml,withQr,cdc,id])).rows[0];
    if(!updated) throw new ConflictException('Otro proceso ya inició esta emisión');
    await this.log(id,'firmado','XML firmado y preparado',u);
    return this.send(updated,u,cred);
  }
  private async send(doc:any,u:Actor,cred=credentials()) {
    try {
      const raw=await setapi.recibe(Number(doc.iddocumento_electronico),doc.xml_firmado,env(),cred.cert,cred.pass,{timeout:90000});
      const result=await responseState(raw);
      await query('UPDATE documento_electronico SET estado=$1,xml_respuesta=$2,codigo_respuesta=$3,mensaje_respuesta=$4,ultima_consulta=now() WHERE iddocumento_electronico=$5',[result.state,result.xml,result.code,result.message,doc.iddocumento_electronico]);
      await this.log(doc.iddocumento_electronico,'respuesta_sifen',result.xml,u);
      return {id:doc.iddocumento_electronico,cdc:doc.cdc,estado:result.state,codigo:result.code,mensaje:result.message};
    } catch(e:any) {
      await query("UPDATE documento_electronico SET estado='pendiente',mensaje_respuesta=$1 WHERE iddocumento_electronico=$2",[String(e.message||e),doc.iddocumento_electronico]);
      await this.log(doc.iddocumento_electronico,'error_envio',String(e.message||e),u);
      return {id:doc.iddocumento_electronico,cdc:doc.cdc,estado:'pendiente',mensaje:'No se confirmó la recepción. Consultá SIFEN antes de reintentar.'};
    }
  }
  @Post(':id/consultar') async consult(@Param('id') id:string,@Req() req:any) {
    const u=req.user as Actor,cred=credentials(),doc=one((await query('SELECT * FROM documento_electronico WHERE iddocumento_electronico=$1 AND activo',[id])).rows,'Documento');
    if(!doc.cdc) throw new BadRequestException('El documento aún no tiene CDC');
    if(doc.estado==='aprobado') return {id,estado:'aprobado',codigo:doc.codigo_respuesta,mensaje:doc.mensaje_respuesta};
    const raw=await setapi.consulta(Number(id),doc.cdc,env(),cred.cert,cred.pass,{timeout:90000});
    const result=await responseState(raw);
    await query("UPDATE documento_electronico SET estado=$1,xml_respuesta=$2,codigo_respuesta=$3,mensaje_respuesta=$4,ultima_consulta=now() WHERE iddocumento_electronico=$5 AND estado<>'aprobado'",[result.state,result.xml,result.code,result.message,id]);
    await this.log(id,'consulta_sifen',result.xml,u);
    return {id,estado:result.state,codigo:result.code,mensaje:result.message};
  }
  @Post(':id/reintentar') async retry(@Param('id') id:string,@Req() req:any) {
    const u=req.user as Actor,doc=one((await query('SELECT * FROM documento_electronico WHERE iddocumento_electronico=$1 AND activo',[id])).rows,'Documento');
    if(!['pendiente','rechazado','firmado'].includes(doc.estado)||!doc.xml_firmado||!doc.cdc) throw new BadRequestException('El documento no está listo para reintento');
    const checked=await this.consult(id,req).catch(()=>null);
    if(checked?.estado==='aprobado') return checked;
    if(checked?.codigo && checked.codigo!=='0420') throw new BadRequestException('Consultá el rechazo antes de reenviar el mismo XML');
    await query('UPDATE documento_electronico SET intento=intento+1 WHERE iddocumento_electronico=$1',[id]);
    return this.send(doc,u);
  }
  @Post(':id/nota-credito') async credit(@Param('id') id:string,@Req() req:any) {
    const u=req.user as Actor,original=one((await query("SELECT * FROM documento_electronico WHERE iddocumento_electronico=$1 AND tipo='factura' AND estado='aprobado' AND activo",[id])).rows,'Factura aprobada');
    const snapshot={...(original.datos as FiscalData),referencia:original.cdc};
    let row:any;
    try { row=(await query("INSERT INTO documento_electronico(fk_idreserva,fk_iddocumento_referencia,tipo,total_gs,datos,creado_por) VALUES($1,$2,'nota_credito',$3,$4,$5) RETURNING *",[original.fk_idreserva,id,original.total_gs,JSON.stringify(snapshot),u.nombre])).rows[0]; }
    catch(e:any) { if(e.code==='23505') throw new ConflictException('Esta factura ya tiene una nota de crédito'); throw e; }
    const number=String(row.iddocumento_electronico).padStart(7,'0');
    if(number.length>7) throw new BadRequestException('Se agotó la numeración fiscal');
    await query('UPDATE documento_electronico SET numero=$1 WHERE iddocumento_electronico=$2',[number,row.iddocumento_electronico]);
    return {...row,numero:number};
  }
  @Get(':id/kude') async kude(@Param('id') id:string,@Res() res:any) {
    const doc=one((await query('SELECT * FROM documento_electronico WHERE iddocumento_electronico=$1 AND activo',[id])).rows,'Documento');
    if(doc.estado!=='aprobado'||!doc.xml_firmado) throw new BadRequestException('KuDE disponible solo para documentos aprobados');
    const s=doc.datos as FiscalData;
    const qr=doc.xml_firmado.match(/<dCarQR>([^<]+)<\/dCarQR>/)?.[1]?.replaceAll('&amp;','&');
    const pdf=new PDFDocument({size:'A4',margin:42});
    res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename="kude-${doc.cdc}.pdf"`);pdf.pipe(res);
    pdf.fontSize(17).text(s.hotel.razon_social||s.hotel.nombre).fontSize(9).moveDown(.5).text(`RUC: ${s.hotel.ruc}    Timbrado: ${s.hotel.timbrado}`).text(s.hotel.direccion||'');
    pdf.moveDown().fontSize(14).text(doc.tipo==='factura'?'FACTURA ELECTRÓNICA':'NOTA DE CRÉDITO ELECTRÓNICA').fontSize(10).text(`${s.hotel.establecimiento}-${s.hotel.punto_expedicion}-${doc.numero}`).text(`CDC: ${doc.cdc}`).text(`Estado SIFEN: APROBADO`).moveDown();
    pdf.text(`Cliente: ${s.cliente.nombre} ${s.cliente.apellido||''}`).text(`RUC/Documento: ${s.cliente.ruc||s.cliente.documento||'—'}`).moveDown();
    pdf.fontSize(9).text('DESCRIPCIÓN',42,pdf.y,{continued:true,width:330}).text('CANT.',{continued:true,width:60}).text('TOTAL Gs.',{width:110,align:'right'});
    pdf.moveTo(42,pdf.y).lineTo(553,pdf.y).stroke();
    for(const item of s.items) { const total=BigInt(item.cantidad)*BigInt(item.monto_unitario_gs); pdf.text(item.descripcion,42,pdf.y+7,{continued:true,width:330}).text(String(item.cantidad),{continued:true,width:60}).text(total.toLocaleString('es-PY'),{width:110,align:'right'}); }
    pdf.moveDown().fontSize(12).text(`TOTAL: Gs. ${BigInt(doc.total_gs).toLocaleString('es-PY')}`,{align:'right'});
    if(qr) { const image=await QRCode.toDataURL(qr); pdf.image(image,42,pdf.y+15,{width:100}); pdf.moveDown(8); }
    pdf.fontSize(8).text('KuDE: representación gráfica del documento electrónico aprobado por SIFEN. Verifique el CDC en el portal de la DNIT.',42,730,{width:510});
    pdf.end();
  }
  private async log(id:unknown,type:string,detail:string,u:Actor) { await query('INSERT INTO evento_documento(fk_iddocumento_electronico,tipo,detalle,creado_por) VALUES($1,$2,$3,$4)',[id,type,detail,u.nombre]); }
}
