import { BadRequestException, CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { from, lastValueFrom, Observable } from 'rxjs';
import { transaction } from './db';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  intercept(context:ExecutionContext,next:CallHandler):Observable<unknown>{
    const request=context.switchToHttp().getRequest();
    const method=String(request.method||'').toUpperCase();
    const key=request.headers['idempotency-key'];
    if(!['POST','PUT','PATCH','DELETE'].includes(method)||request.path==='/api/auth/login'||!key) return next.handle();
    if(typeof key!=='string'||!UUID.test(key)) throw new BadRequestException('Clave de solicitud inválida');
    if(!request.user?.idusuario) return next.handle();

    // SIFEN may take 90 seconds and must not run with an open database transaction.
    // Its routes check the document and SIFEN state before sending again.
    if(/^\/api\/facturas\/\d+\/(emitir|consultar|reintentar)$/.test(request.path)) return next.handle();

    const signature=createHash('sha256').update(JSON.stringify({
      actor:request.user.idusuario,method,path:request.path,body:request.body??null,
    })).digest('hex');
    return from(transaction(async tx=>{
      const inserted=await tx.query(
        'INSERT INTO solicitud_idempotente(solicitud_id,fk_idusuario,firma) VALUES($1,$2,$3) ON CONFLICT (solicitud_id) DO NOTHING RETURNING solicitud_id',
        [key,request.user.idusuario,signature],
      );
      if(!inserted.rowCount){
        const previous=(await tx.query('SELECT firma,respuesta FROM solicitud_idempotente WHERE solicitud_id=$1',[key])).rows[0];
        if(!previous||previous.firma!==signature) throw new ConflictException('La clave de solicitud corresponde a otra operación');
        return previous.respuesta;
      }
      const result=await lastValueFrom(next.handle());
      const response=JSON.parse(JSON.stringify(result??null));
      await tx.query('UPDATE solicitud_idempotente SET respuesta=$2 WHERE solicitud_id=$1',[key,response]);
      return response;
    }));
  }
}
