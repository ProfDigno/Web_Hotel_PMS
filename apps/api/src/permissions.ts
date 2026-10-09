import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth';
import { query, transaction } from './db';
import { EVENTS, ROLES } from './permission-catalog';

const admin=(req:any)=>{if(req.user.rol!=='administracion')throw new ForbiddenException('Solo Administración puede configurar permisos');};

@Controller('api/permisos') @UseGuards(AuthGuard)
export class PermissionsController {
  @Get('mios') async mine(@Req() req:any){
    const rows=(await query<{evento:string}>('SELECT evento FROM rol_evento WHERE rol=$1 AND habilitado ORDER BY evento',[req.user.rol])).rows;
    return {rol:req.user.rol,eventos:rows.map(row=>row.evento)};
  }

  @Get('matriz') async matrix(@Req() req:any){
    admin(req);
    const rows=(await query<{rol:string;evento:string;habilitado:boolean}>('SELECT rol,evento,habilitado FROM rol_evento ORDER BY rol,evento')).rows;
    return {roles:ROLES,eventos:EVENTS.map(({key,group,label})=>({clave:key,grupo:group,nombre:label})),permisos:rows};
  }

  @Patch('roles/:rol/eventos/:evento') async setEvent(@Param('rol') rol:string,@Param('evento') evento:string,@Body() body:any,@Req() req:any){
    admin(req);
    if(!ROLES.includes(rol as any)||!EVENTS.some(e=>e.key===evento))throw new BadRequestException('Rol o evento inválido');
    if(typeof body.habilitado!=='boolean')throw new BadRequestException('habilitado debe ser verdadero o falso');
    if(rol==='administracion'&&evento==='settings.permissions'&&!body.habilitado)throw new BadRequestException('El acceso de Administración a Permisos debe permanecer habilitado');
    return transaction(async tx=>{
      const old=(await tx.query('SELECT habilitado FROM rol_evento WHERE rol=$1 AND evento=$2 FOR UPDATE',[rol,evento])).rows[0];
      if(!old)throw new BadRequestException('Permiso inexistente');
      const row=(await tx.query('UPDATE rol_evento SET habilitado=$3 WHERE rol=$1 AND evento=$2 RETURNING rol,evento,habilitado',[rol,evento,body.habilitado])).rows[0];
      await tx.query('INSERT INTO auditoria(fk_idusuario,accion,entidad,identificador,detalle,creado_por) VALUES($1,$2,$3,$4,$5,$6)',[req.user.idusuario,'configurar','rol_evento',`${rol}:${evento}`,JSON.stringify({antes:old.habilitado,despues:row.habilitado}),req.user.nombre]);
      return row;
    });
  }
}
