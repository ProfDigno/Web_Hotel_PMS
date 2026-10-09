# Hotel PMS v0.2.0 · 9 de octubre de 2026

## Cambios

- Permisos por rol y evento para pantallas, formularios y operaciones de la API. Administración puede configurar la matriz y cambiar el rol o los datos de usuarios existentes.
- Monto y precio con separador de miles mientras se escriben; formas de pago como botones y diseño de pago de reservas reorganizado.
- Informes con filtros de período, indicadores y gráficos interactivos de ocupación, reservas, alojamiento, ventas, compras y gastos, respetando los permisos de cada rol.
- Inicio de turno con caja cerrada: cualquier usuario autenticado puede abrirla; las demás pantallas se ocultan y la API rechaza las escrituras hasta que haya una caja abierta.

## Actualización del VPS

Esta versión incorpora la migración `018_permisos_eventos.sql`. El código nuevo requiere la matriz de permisos, por lo que el servicio debe reiniciarse **después** de ejecutar `npm run db:migrate`. La migración conserva los accesos iniciales de los cuatro roles. No se deben copiar la base local, `.env` ni los parámetros privados de SIFEN al servidor.

En el VPS, como `root`, con el repositorio ubicado en `/opt/hotel-pms`:

```sh
cd /opt/hotel-pms
umask 077
runuser -u postgres -- pg_dump -Fc hotel_pms > "/root/hotel-pms-$(date +%Y%m%d-%H%M%S).dump"
runuser -u hotel-pms -- git pull --ff-only origin main
runuser -u hotel-pms -- npm ci --no-audit --no-fund
runuser -u hotel-pms -- npm run build
runuser -u hotel-pms -- npm run db:migrate
systemctl restart hotel-pms
systemctl is-active hotel-pms
curl -fsS -o /dev/null http://127.0.0.1:3000/
```

Después de iniciar sesión, comprobar que se muestra solo **Abrir caja** si no existe una caja abierta. Una vez abierta, revisar el menú permitido para el rol y los gráficos de Informes. Si ya existe una caja abierta, el sistema debe entrar directamente a la primera pantalla autorizada. Revisar `journalctl -u hotel-pms -n 100 --no-pager` si el servicio no inicia.

## Verificación previa

- `npm run build`: compila API e interfaz.
- `node apps/api/scripts/test-isolated.mjs`: crea una base descartable, ejecuta toda la suite y la elimina; requiere PostgreSQL local y el `DATABASE_URL` de `.env`.
- No se verificó la emisión real de SIFEN. Se mantiene la advertencia de homologación del README.
