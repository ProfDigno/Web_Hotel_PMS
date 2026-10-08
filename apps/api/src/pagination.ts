import { BadRequestException } from '@nestjs/common';
import { positiveInt } from './common';
import { transaction } from './db';

export async function paginateList(sql:string,params:unknown[],pagina:string,idColumn:'idcliente'|'idreserva'|'idventa'|'idgasto'|'idcompra') {
  if(typeof pagina!=='string'||!/^\d+$/.test(pagina))throw new BadRequestException('Página debe ser un entero positivo');
  const page=positiveInt(pagina,'página'),pageSize=50,offset=(page-1)*pageSize;
  if(!Number.isSafeInteger(offset))throw new BadRequestException('Página fuera de rango');
  return transaction(async tx=>{
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const total=(await tx.query('SELECT count(*)::int AS total FROM ('+sql+') lista',params)).rows[0].total;
    const registros=(await tx.query('SELECT * FROM ('+sql+') lista ORDER BY '+idColumn+' DESC LIMIT 50 OFFSET $'+(params.length+1),[...params,offset])).rows;
    return {registros,total,pagina:page,por_pagina:pageSize};
  });
}
