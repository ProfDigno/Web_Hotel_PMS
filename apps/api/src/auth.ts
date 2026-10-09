import { Body, Controller, CanActivate, ConflictException, ExecutionContext, Get, Injectable, Patch, Post, Req, UnauthorizedException, ForbiddenException, UseGuards, BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { query } from './db';
import { required } from './common';
import { ROUTE_EVENTS } from './permission-catalog';

export type Actor = { idusuario: string; nombre: string; email: string; rol: 'administracion'|'recepcion'|'caja'|'limpieza' };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {
    this.jwt ||= new JwtService({ secret: process.env.JWT_SECRET || 'development-only-change-me' });
    this.reflector ||= new Reflector();
  }
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = String(req.headers.authorization || '').replace(/^Bearer /i, '');
    if (!token) throw new UnauthorizedException('Iniciá sesión');
    let payload: { sub: string };
    try { payload = await this.jwt.verifyAsync(token); }
    catch { throw new UnauthorizedException('Sesión vencida'); }
    const user = (await query<Actor>('SELECT idusuario,nombre,email,rol FROM usuario WHERE idusuario=$1 AND activo', [payload.sub])).rows[0];
    if (!user) throw new UnauthorizedException('Usuario inactivo');
    req.user = user;
    const controller=context.getClass().name,handler=context.getHandler().name;
    // Every signed-in user can check the shift and open its cash box.
    if(controller==='PmsController'&&(handler==='cashStatus'||handler==='openCash'))return true;
    if(['POST','PUT','PATCH','DELETE'].includes(String(req.method||'GET').toUpperCase())){
      const opened=(await query<{abierta:boolean}>('SELECT EXISTS(SELECT 1 FROM caja WHERE activo AND cerrada_en IS NULL) AS abierta')).rows[0].abierta;
      if(!opened)throw new ConflictException({statusCode:409,code:'CAJA_CERRADA',message:'Abrí una caja antes de continuar'});
    }
    if(controller==='AuthController'||controller==='PermissionsController')return true;
    const requiredEvents=ROUTE_EVENTS[controller]?.[handler];
    if(!requiredEvents)throw new ForbiddenException('Evento de acceso no configurado');
    const grants=(await query<{evento:string}>('SELECT evento FROM rol_evento WHERE rol=$1 AND habilitado AND evento=ANY($2::text[])',[user.rol,requiredEvents])).rows;
    if(!grants.length)throw new ForbiddenException('Sin permiso para esta operación');
    req.events=new Set(grants.map(row=>row.evento));
    return true;
  }
}

@Controller('api/auth')
export class AuthController {
  constructor(private jwt: JwtService) {
    this.jwt ||= new JwtService({ secret: process.env.JWT_SECRET || 'development-only-change-me' });
  }
  @Post('login')
  async login(@Body() body: any) {
    const email = required(body.email, 'email').toLowerCase();
    const result = await query<Actor & { clave_hash: string }>('SELECT idusuario,nombre,email,rol,clave_hash FROM usuario WHERE email=$1 AND activo', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(String(body.password || ''), user.clave_hash))) throw new UnauthorizedException('Credenciales inválidas');
    const { clave_hash, ...actor } = user;
    return { token: await this.jwt.signAsync({ sub: user.idusuario }), usuario: actor };
  }
  @Get('me') @UseGuards(AuthGuard)
  me(@Req() req: any) { return req.user; }
  @Patch('password') @UseGuards(AuthGuard)
  async password(@Req() req:any,@Body() body:any) {
    const next=required(body.nueva,'contraseña nueva');
    if(next.length<10) throw new BadRequestException('La contraseña debe tener al menos 10 caracteres');
    const row=(await query<{clave_hash:string}>('SELECT clave_hash FROM usuario WHERE idusuario=$1',[req.user.idusuario])).rows[0];
    if(!row||!(await bcrypt.compare(String(body.actual||''),row.clave_hash))) throw new UnauthorizedException('Contraseña actual incorrecta');
    await query('UPDATE usuario SET clave_hash=$1 WHERE idusuario=$2',[await bcrypt.hash(next,12),req.user.idusuario]);
    return {ok:true};
  }
}
