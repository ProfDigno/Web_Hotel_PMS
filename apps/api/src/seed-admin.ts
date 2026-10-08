import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from './db';

async function main() {
  const email=process.env.ADMIN_EMAIL?.toLowerCase(),name=process.env.ADMIN_NAME,password=process.env.ADMIN_PASSWORD;
  if(!email||!name||!password||password.length<10) throw new Error('Configurá ADMIN_EMAIL, ADMIN_NAME y ADMIN_PASSWORD de al menos 10 caracteres');
  const count=await pool.query('SELECT COUNT(*)::int AS n FROM usuario');
  if(count.rows[0].n>0) throw new Error('Ya existen usuarios; creá los demás desde la aplicación');
  await pool.query("INSERT INTO usuario(nombre,email,clave_hash,rol,creado_por) VALUES($1,$2,$3,'administracion','SISTEMA')",[name,email,await bcrypt.hash(password,12)]);
  console.log('Administrador inicial creado');
}
main().then(()=>pool.end()).catch(async e=>{console.error(e.message);await pool.end();process.exit(1)});
