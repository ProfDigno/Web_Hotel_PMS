import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

test('esquema, auditoría y bloqueo de doble reserva', { skip: !process.env.TEST_DATABASE_URL && 'Requiere TEST_DATABASE_URL con una base de pruebas' }, async()=>{
  const client=new Client({connectionString:process.env.TEST_DATABASE_URL});
  await client.connect();
  const schema=`pms_test_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema},public`);
    await client.query(readFileSync(join(__dirname,'../sql/001_init.sql'),'utf8'));
    const tables=(await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE'",[schema])).rows.map(x=>x.table_name);
    assert.ok(tables.length>=10);
    for(const table of tables){
      const columns=(await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[schema,table])).rows.map(x=>x.column_name);
      for(const name of [`id${table}`,'fecha_creado','creado_por','activo']) assert.ok(columns.includes(name),`${table} carece de ${name}`);
    }
    const type=(await client.query("INSERT INTO tipo_habitacion(nombre,capacidad,creado_por) VALUES('Doble',2,'Prueba') RETURNING idtipo_habitacion")).rows[0];
    const room=(await client.query("INSERT INTO habitacion(numero,fk_idtipo_habitacion,creado_por) VALUES('101',$1,'Prueba') RETURNING idhabitacion",[type.idtipo_habitacion])).rows[0];
    const customer=(await client.query("INSERT INTO cliente(nombre,creado_por) VALUES('Ana','Prueba') RETURNING idcliente")).rows[0];
    const reservation=(await client.query("INSERT INTO reserva(fk_idcliente,fecha_entrada,fecha_salida,creado_por) VALUES($1,'2026-10-10','2026-10-13','Prueba') RETURNING idreserva",[customer.idcliente])).rows[0];
    await client.query("INSERT INTO reserva_habitacion(fk_idreserva,fk_idhabitacion,fecha_entrada,fecha_salida,tarifa_noche_gs,creado_por) VALUES($1,$2,'2026-10-10','2026-10-13',300000,'Prueba')",[reservation.idreserva,room.idhabitacion]);
    await assert.rejects(()=>client.query("INSERT INTO reserva_habitacion(fk_idreserva,fk_idhabitacion,fecha_entrada,fecha_salida,tarifa_noche_gs,creado_por) VALUES($1,$2,'2026-10-12','2026-10-14',300000,'Prueba')",[reservation.idreserva,room.idhabitacion]),(error:any)=>error.code==='23P01');
    await client.query("INSERT INTO reserva_habitacion(fk_idreserva,fk_idhabitacion,fecha_entrada,fecha_salida,tarifa_noche_gs,creado_por) VALUES($1,$2,'2026-10-13','2026-10-14',300000,'Prueba')",[reservation.idreserva,room.idhabitacion]);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
