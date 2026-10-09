# PMS hotelero · Paraguay

Aplicación web para la operación de un hotel. Incluye calendario de reservas, recepción, habitaciones y tarifas, huéspedes, limpieza, cuenta por reserva, pagos y caja, ventas y compras de productos, proveedores, inventario, tablero, ocupación, usuarios y un flujo de documentos electrónicos SIFEN. La interfaz funciona en computadora y teléfono.

## Requisitos

- Node.js 22 o superior y npm.
- PostgreSQL 16 o superior. `docker-compose.yml` ofrece una base local opcional.
- Para probar SIFEN: certificado habilitado, contraseña, CSC, identificador CSC y parámetros reales del emisor provistos por la DNIT.

## Base PostgreSQL

Copie `.env.example` como `.env` y cambie `POSTGRES_PASSWORD` y la contraseña dentro de `DATABASE_URL` por el mismo valor privado antes del primer arranque. Si usa un servidor PostgreSQL existente, configure `DATABASE_URL` con sus propios datos y omita Docker.

## Primer arranque

En la raíz del proyecto:

```powershell
Copy-Item .env.example .env
Copy-Item config/sifen.params.example.json config/sifen.params.json
docker compose up -d postgres
npm install
npm run db:migrate
npm run admin:create -w apps/api
npm run dev
```

Antes de crear el administrador, cambie `JWT_SECRET`, `ADMIN_EMAIL` y `ADMIN_PASSWORD` en `.env`. Si PostgreSQL ya está instalado, configure `DATABASE_URL` y omita Docker. La web se abre en `http://localhost:3000` y la API en `http://localhost:3000/api`. Ambas comparten un servidor y un puerto (configurable con `PORT` o `API_PORT` en `.env`).

Para compilar y verificar:

```powershell
npm run build
npm test
```

La prueba de restricciones PostgreSQL necesita una base **descartable** adicional:

```powershell
$env:TEST_DATABASE_URL='postgres://postgres:postgres@localhost:5432/hotel_pms_test'
npm test
```

El test ejecuta el esquema sobre esa base. No use la base de trabajo como `TEST_DATABASE_URL`.

## Configuración inicial

1. Entre con el administrador y abra la caja inicial. Mientras esté cerrada, el sistema solo mostrará esa acción.
2. Cargue los datos del hotel, incluido RUC y timbrado.
3. Cree tipos de habitación, habitaciones y tarifas.
4. Cree usuarios y asigne administración, recepción, caja o limpieza. Ajuste sus permisos en **Configuración → Permisos**.
5. Registre huéspedes y reservas.

Todas las tablas tienen `fecha_creado`, `creado_por` y `activo`. Las claves usan `idnombretabla` y `fk_idnombretabla`; los importes se guardan como enteros `BIGINT` y la API los devuelve como texto. Las fechas operativas se interpretan en `America/Asuncion`. PostgreSQL impide dos asignaciones activas superpuestas para una misma habitación.

## SIFEN

La configuración de ejemplo en `config/sifen.params.example.json` es solo una plantilla. Complete el archivo local `config/sifen.params.json`, los datos fiscales del hotel y estas variables de `.env`: `SIFEN_CERT_PATH`, `SIFEN_CERT_PASSWORD`, `SIFEN_CSC`, `SIFEN_CSC_ID`, `SIFEN_PARAMS_PATH`. Mantenga `SIFEN_ENV=test` durante la homologación. Producción requiere además `SIFEN_PRODUCTION_ENABLED=true`. El sistema prepara una instantánea de la cuenta, genera y firma el XML, agrega QR, envía el documento, consulta su estado, guarda respuestas y ofrece el KuDE cuando figure aprobado. También puede preparar una nota de crédito de una factura aprobada.

**La integración fiscal no está homologada ni lista para producción.** En este entorno faltan credenciales y acceso a SIFEN; no se verificaron XML, respuesta, rechazo, demora, reintento, nota de crédito ni diseño legal del KuDE contra los servicios de prueba. La numeración, datos del emisor, reglas tributarias y representación del KuDE deben revisarse con el Manual Técnico vigente y un especialista tributario antes de usar comprobantes reales. Las dependencias comunitarias usadas para SIFEN presentan avisos de seguridad en `npm audit` y deben actualizarse o sustituirse antes de exponer la emisión a Internet.

Documentación oficial: [Manual Técnico y notas de la DNIT](https://www.dnit.gov.py/web/e-kuatia/documentacion-tecnica).

## Estructura

- `apps/api`: API REST NestJS, migración SQL y pruebas.
- `apps/web`: interfaz React y Vite.
- `config`: plantilla de parámetros SIFEN.

La web pública de reservas, agencias, grupos, comandas de cocina, CRM y múltiples hoteles quedan fuera de esta primera versión.

## Inicio rápido en Windows

Hacé doble clic en `iniciar-pms.bat`. Iniciará la API y la interfaz web en una sola ventana. Abrí `http://localhost:3000` (o el puerto configurado en `.env`). También podés ejecutar `npm run dev` desde la raíz. Para usar la versión compilada, ejecutá `npm run build` y luego `npm start`.

## Instalación del VPS

La producción está en `/opt/hotel-pms`, con una base PostgreSQL `hotel_pms` independiente de la base local de desarrollo. El servicio `hotel-pms` escucha en `127.0.0.1:3000` mediante `HOST=127.0.0.1`; nginx publica la aplicación por el puerto 80. Los secretos están en `/opt/hotel-pms/.env` y no deben agregarse a Git. Lavadero Racing quedó deshabilitado, pero se conservaron su servicio, sus archivos y su base `bdlavadero_racing`. Para la versión **v0.2.0**, seguir también las [notas de actualización](RELEASE_NOTES_0.2.0.md), incluida la migración de permisos.

Para publicar una nueva versión, primero compilá y probá en local, luego enviá los cambios a la rama `main`. En el VPS, como `root`:

```sh
cd /opt/hotel-pms
umask 077
runuser -u postgres -- pg_dump -Fc hotel_pms > "/root/hotel-pms-$(date +%Y%m%d-%H%M%S).dump"
runuser -u hotel-pms -- git pull --ff-only
runuser -u hotel-pms -- npm ci --no-audit --no-fund
runuser -u hotel-pms -- npm run build
runuser -u hotel-pms -- npm run db:migrate
systemctl restart hotel-pms
systemctl is-active hotel-pms
curl -fsS -o /dev/null http://127.0.0.1:3000/
```

La copia de la base es anterior a las migraciones y permite recuperar los datos si una actualización falla. La base local no se sincroniza con producción. La IP pública usa HTTP y transmite credenciales y datos sin cifrado; conviene configurar HTTPS.


## Gastos y caja

El menú **Gasto** incluye **Gasto**, **Gasto tipo** y **Análisis Gasto**. Los accesos para consultar, registrar, anular y analizar se configuran por rol en **Configuración → Permisos**.

Cada gasto requiere tipo activo, fecha hasta hoy, descripción, importe entero positivo en guaraníes y forma de pago activa. Se registra un único egreso en la caja abierta. La fecha del gasto puede ser anterior; la caja conserva el momento de registro. Las correcciones se hacen anulando con motivo y registrando un nuevo gasto.

La anulación también está disponible después del cierre: conserva el comprobante y los totales originales, mostrando el ajuste posterior. Los tipos y formas de pago inactivos siguen apareciendo en el historial y los filtros.

El análisis muestra total, cantidad, promedios, efectivo y no efectivo; gráficos diarios, por tipo y forma de pago, y los diez mayores gastos. Los anulados se resumen por separado. El período inicial es el mes actual y cada consulta admite hasta 3660 días.

La migración `016_gastos.sql` agrega `gasto_tipo`, `gasto` y el vínculo `caja_detalle.fk_idgasto`, sin convertir gastos en pagos de reservas o ventas. Aplicar con `npm run db:migrate` antes de usar esta versión.

Para ejecutar las pruebas contra una base temporal creada y eliminada automáticamente:

```powershell
node apps/api/scripts/test-isolated.mjs
# Solo el módulo de gastos:
node apps/api/scripts/test-isolated.mjs src/expenses.test.ts
```
