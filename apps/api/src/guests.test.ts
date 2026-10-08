import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import 'reflect-metadata';
import { applyMigrations } from './migration-runner';

test('historial del huésped: estados, paginación, habitaciones y permisos', {skip:!process.env.TEST_DATABASE_URL&&'Requiere TEST_DATABASE_URL'}, async()=>{
  const client=new Client({connectionString:process.env.TEST_DATABASE_URL});await client.connect();
  const schema='guests_test_'+Date.now();let db:typeof import('./db')|undefined;
  try {
    await client.query('CREATE SCHEMA '+schema);await client.query('SET search_path TO '+schema+',public');
    await applyMigrations(client);
    const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options','-c search_path='+schema+',public');process.env.DATABASE_URL=url.toString();
    db=await import('./db');const {PmsController}=await import('./pms');const controller=new PmsController();
    const guest=(await client.query("INSERT INTO cliente(nombre,apellido,creado_por) VALUES('Ana','Pérez','Prueba') RETURNING *")).rows[0];
    const other=(await client.query("INSERT INTO cliente(nombre,creado_por) VALUES('Luis','Prueba') RETURNING *")).rows[0];
    const empty=(await client.query("INSERT INTO cliente(nombre,creado_por) VALUES('Sin reservas','Prueba') RETURNING *")).rows[0];
    const inactive=(await client.query("INSERT INTO cliente(nombre,activo,creado_por) VALUES('Inactivo',FALSE,'Prueba') RETURNING *")).rows[0];
    const type=(await client.query("INSERT INTO tipo_habitacion(nombre,capacidad,creado_por) VALUES('Doble',2,'Prueba') RETURNING *")).rows[0];
    const floor=(await client.query("INSERT INTO piso(numero,nombre,creado_por) VALUES(1,'Primer piso','Prueba') RETURNING *")).rows[0];
    const rooms=[];
    for(const number of ['101','102'])rooms.push((await client.query("INSERT INTO habitacion(numero,fk_idpiso,fk_idtipo_habitacion,creado_por) VALUES($1,$2,$3,'Prueba') RETURNING *",[number,floor.idpiso,type.idtipo_habitacion])).rows[0]);
    const states=['confirmada','en_casa','finalizada','cancelada','no_show'],reservations:any[]=[];
    for(let i=0;i<25;i++){
      const start=new Date(Date.UTC(2026,0,1+i*2)).toISOString().slice(0,10),end=new Date(Date.UTC(2026,0,2+i*2)).toISOString().slice(0,10);
      const r=(await client.query("INSERT INTO reserva(fk_idcliente,fecha_entrada,fecha_salida,estado,creado_por) VALUES($1,$2,$3,$4,'Prueba') RETURNING *",[guest.idcliente,start,end,states[i%states.length]])).rows[0];
      reservations.push(r);
      for(const room of rooms)await client.query("INSERT INTO reserva_habitacion(fk_idreserva,fk_idhabitacion,fecha_entrada,fecha_salida,tarifa_noche_gs,estado,creado_por) VALUES($1,$2,$3,$4,100000,$5,'Prueba')",[r.idreserva,room.idhabitacion,start,end,r.estado]);
    }
    await client.query("INSERT INTO reserva(fk_idcliente,fecha_entrada,fecha_salida,creado_por) VALUES($1,'2026-06-01','2026-06-02','Prueba')",[other.idcliente]);
    await client.query("INSERT INTO reserva(fk_idcliente,fecha_entrada,fecha_salida,activo,creado_por) VALUES($1,'2026-07-01','2026-07-02',FALSE,'Prueba')",[guest.idcliente]);
    const first=await controller.clientReservations(guest.idcliente),second=await controller.clientReservations(guest.idcliente,'2');
    assert.equal(first.total,25);assert.equal(first.pagina,1);assert.equal(first.por_pagina,20);assert.equal(first.reservas.length,20);assert.equal(second.reservas.length,5);
    const all=[...first.reservas,...second.reservas];
    assert.deepEqual(all.map((r:any)=>r.idreserva),reservations.map(r=>r.idreserva).reverse());
    assert.deepEqual(new Set(all.map((r:any)=>r.estado)),new Set(states));
    assert.equal(new Set(all.map((r:any)=>r.idreserva)).size,25);
    assert.ok(all.every((r:any)=>r.habitaciones==='101, 102'&&typeof r.idreserva==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.fecha_entrada)));
    assert.equal((await controller.clientReservations(other.idcliente)).total,1);
    await client.query("INSERT INTO reserva(fk_idcliente,fecha_entrada,fecha_salida,creado_por) SELECT $1,'2026-08-01','2026-08-02','Prueba' FROM generate_series(1,305)",[other.idcliente]);
    assert.equal((await controller.reservations(undefined,' ana pérez ')).length,25);
    assert.equal((await controller.reservations('en_casa','Ana')).length,5);
    const byRoom=await controller.reservations(undefined,'02');
    assert.equal(byRoom.length,25);assert.ok(byRoom.every((r:any)=>r.habitaciones==='101, 102'));
    assert.deepEqual((await controller.reservations(undefined,'#'+reservations[0].idreserva)).map((r:any)=>r.idreserva),[reservations[0].idreserva]);
    assert.equal((await controller.reservations(undefined,'No existe nadie')).length,0);
    const paginated=await controller.reservations(undefined,undefined,'1');
    assert.equal(paginated.total,331);assert.equal(paginated.por_pagina,50);assert.equal(paginated.registros.length,50);
    const listed:any[]=[];
    for(let page=1;page<=7;page++){
      const result=await controller.reservations(undefined,undefined,String(page));
      assert.ok(result.registros.length<=50);listed.push(...result.registros);
    }
    const expected=(await client.query('SELECT idreserva FROM reserva WHERE activo ORDER BY idreserva DESC')).rows.map(r=>r.idreserva);
    assert.deepEqual(listed.map(r=>r.idreserva),expected);assert.equal(new Set(listed.map(r=>r.idreserva)).size,331);
    const filtered=await controller.reservations('en_casa','Ana','1');
    assert.equal(filtered.total,5);assert.ok(filtered.registros.every((r:any)=>r.estado==='en_casa'&&r.habitaciones==='101, 102'));
    assert.equal((await controller.reservations(undefined,'#'+reservations[0].idreserva,'1')).total,1);
    assert.equal((await controller.reservations(undefined,'No existe nadie','1')).total,0);
    assert.equal((await controller.reservations(undefined,undefined,'8')).registros.length,0);
    assert.ok(Array.isArray(await controller.reservations()));assert.equal((await controller.reservations()).length,300);
    // Boundary sizes and search must cover records beyond the legacy limit.
    for(const size of [0,1,50,51,101]){
      const name='Tamaño '+size;
      await client.query("INSERT INTO cliente(nombre,creado_por) SELECT $1,'Prueba' FROM generate_series(1,$2)",[name,size]);
      const a=await controller.clients(name,'1'),b=await controller.clients(name,'2'),c=await controller.clients(name,'3');
      assert.equal(a.total,size);assert.equal(a.por_pagina,50);assert.equal(a.registros.length,Math.min(size,50));
      assert.equal(b.registros.length,Math.min(50,Math.max(0,size-50)));assert.equal(c.registros.length,Math.max(0,size-100));
    }
    await client.query("INSERT INTO cliente(nombre,creado_por) SELECT 'Extra ' || n,'Prueba' FROM generate_series(1,210) n");
    const pagedGuests=await controller.clients(undefined,'1');
    const guestsList:any[]=[];
    for(let page=1;page<=Math.ceil(pagedGuests.total/50);page++)guestsList.push(...(await controller.clients(undefined,String(page))).registros);
    assert.deepEqual(guestsList.map(c=>c.idcliente),(await client.query('SELECT idcliente FROM cliente WHERE activo ORDER BY idcliente DESC')).rows.map(c=>c.idcliente));
    assert.equal((await controller.clients('Ana','1')).total,1);
    assert.ok(Array.isArray(await controller.clients()));assert.equal((await controller.clients()).length,200);
    for(const page of ['0','-1','1.5','abc','','1e2','9007199254740991']){
      await assert.rejects(()=>controller.clients(undefined,page),(e:any)=>e.getStatus()===400);
      await assert.rejects(()=>controller.reservations(undefined,undefined,page),(e:any)=>e.getStatus()===400);
    }
    assert.deepEqual(await controller.clientReservations(empty.idcliente),{reservas:[],total:0,pagina:1,por_pagina:20});
    assert.equal((await controller.clientReservations(guest.idcliente,'3')).reservas.length,0);
    for(const page of ['0','-1','1.5','abc','','1e2','9007199254740991'])await assert.rejects(()=>controller.clientReservations(guest.idcliente,page),(e:any)=>e.getStatus()===400);
    await assert.rejects(()=>controller.clientReservations('abc'),(e:any)=>e.getStatus()===400);
    await assert.rejects(()=>controller.clientReservations('999999'),(e:any)=>e.getStatus()===404);
    await assert.rejects(()=>controller.clientReservations(inactive.idcliente),(e:any)=>e.getStatus()===404);
    const {AuthGuard}=await import('./auth');const {JwtService}=await import('@nestjs/jwt');const {Reflector}=await import('@nestjs/core');
    const jwt=new JwtService({secret:'guests-test-secret'}),guard=new AuthGuard(jwt,new Reflector());
    for(const role of ['administracion','recepcion','caja','limpieza']){
      const user=(await client.query("INSERT INTO usuario(nombre,email,clave_hash,rol,creado_por) VALUES($1,$2,'hash',$1,'Prueba') RETURNING *",[role,role+'@guests.test'])).rows[0];
      const request={headers:{authorization:'Bearer '+await jwt.signAsync({sub:user.idusuario})}};
      for(const handler of [controller.clientReservations,controller.clients,controller.reservations]){
        const ctx={switchToHttp:()=>({getRequest:()=>request}),getHandler:()=>handler,getClass:()=>PmsController} as any;
        if(role==='limpieza')await assert.rejects(()=>guard.canActivate(ctx));else assert.equal(await guard.canActivate(ctx),true);
      }
      if(role==='administracion'){
        await controller.cancel(reservations[0].idreserva,{user});
        const updated=await controller.clientReservations(guest.idcliente,'2');
        assert.equal(updated.reservas.find((r:any)=>r.idreserva===reservations[0].idreserva).estado,'cancelada');
        assert.equal(updated.total,25);
      }
    }
  }finally{if(db)await db.pool.end();await client.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await client.end();}
});
