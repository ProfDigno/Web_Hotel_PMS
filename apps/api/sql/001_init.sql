CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS hotel (
  idhotel BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL, ruc TEXT, razon_social TEXT, direccion TEXT, telefono TEXT,
  establecimiento TEXT, punto_expedicion TEXT, timbrado TEXT, actividad_economica TEXT,
  departamento_codigo INTEGER, distrito_codigo INTEGER, ciudad_codigo INTEGER,
  email TEXT, fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS hotel_unico_activo ON hotel (activo) WHERE activo;

CREATE TABLE IF NOT EXISTS usuario (
  idusuario BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL, email TEXT NOT NULL UNIQUE, clave_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('administracion','recepcion','caja','limpieza')),
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS tipo_habitacion (
  idtipo_habitacion BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE, capacidad INTEGER NOT NULL CHECK (capacidad > 0), descripcion TEXT,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS habitacion (
  idhabitacion BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE, piso TEXT, fk_idtipo_habitacion BIGINT NOT NULL REFERENCES tipo_habitacion(idtipo_habitacion),
  estado_limpieza TEXT NOT NULL DEFAULT 'limpia' CHECK (estado_limpieza IN ('limpia','sucia','en_limpieza','inspeccion')),
  fuera_servicio BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS tarifa (
  idtarifa BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL, fk_idtipo_habitacion BIGINT NOT NULL REFERENCES tipo_habitacion(idtipo_habitacion),
  fecha_inicio DATE NOT NULL, fecha_fin DATE NOT NULL, monto_gs BIGINT NOT NULL CHECK (monto_gs >= 0),
  iva_tasa SMALLINT NOT NULL DEFAULT 10 CHECK (iva_tasa IN (0,5,10)),
  CHECK (fecha_fin > fecha_inicio),
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS cliente (
  idcliente BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL, apellido TEXT, tipo_documento TEXT, documento TEXT, ruc TEXT,
  email TEXT, telefono TEXT, direccion TEXT, pais TEXT DEFAULT 'Paraguay',
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS cliente_documento_idx ON cliente(documento);
CREATE TABLE IF NOT EXISTS reserva (
  idreserva BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idcliente BIGINT NOT NULL REFERENCES cliente(idcliente),
  fecha_entrada DATE NOT NULL, fecha_salida DATE NOT NULL,
  estado TEXT NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('confirmada','en_casa','finalizada','cancelada','no_show')),
  adultos INTEGER NOT NULL DEFAULT 1 CHECK (adultos > 0), ninos INTEGER NOT NULL DEFAULT 0 CHECK (ninos >= 0),
  origen TEXT NOT NULL DEFAULT 'directa', observaciones TEXT,
  CHECK (fecha_salida > fecha_entrada),
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS reserva_habitacion (
  idreserva_habitacion BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idreserva BIGINT NOT NULL REFERENCES reserva(idreserva),
  fk_idhabitacion BIGINT NOT NULL REFERENCES habitacion(idhabitacion),
  fecha_entrada DATE NOT NULL, fecha_salida DATE NOT NULL,
  tarifa_noche_gs BIGINT NOT NULL CHECK (tarifa_noche_gs >= 0),
  estado TEXT NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('confirmada','en_casa','finalizada','cancelada','no_show')),
  CHECK (fecha_salida > fecha_entrada),
  CONSTRAINT reserva_habitacion_sin_solape EXCLUDE USING gist
    (fk_idhabitacion WITH =, daterange(fecha_entrada,fecha_salida,'[)') WITH &&)
    WHERE (activo AND estado IN ('confirmada','en_casa')),
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS movimiento (
  idmovimiento BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idreserva BIGINT NOT NULL REFERENCES reserva(idreserva),
  tipo TEXT NOT NULL CHECK (tipo IN ('alojamiento','extra','ajuste','descuento')),
  descripcion TEXT NOT NULL, cantidad INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  monto_unitario_gs BIGINT NOT NULL CHECK (monto_unitario_gs >= 0),
  iva_tasa SMALLINT NOT NULL DEFAULT 10 CHECK (iva_tasa IN (0,5,10)),
  fecha_servicio DATE NOT NULL, anulado BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS caja (
  idcaja BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idusuario_apertura BIGINT NOT NULL REFERENCES usuario(idusuario),
  fk_idusuario_cierre BIGINT REFERENCES usuario(idusuario),
  abierta_en TIMESTAMPTZ NOT NULL DEFAULT now(), cerrada_en TIMESTAMPTZ,
  monto_inicial_gs BIGINT NOT NULL DEFAULT 0 CHECK (monto_inicial_gs >= 0),
  monto_cierre_gs BIGINT CHECK (monto_cierre_gs >= 0),
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS caja_unica_abierta ON caja ((cerrada_en IS NULL)) WHERE cerrada_en IS NULL AND activo;
CREATE TABLE IF NOT EXISTS pago (
  idpago BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idreserva BIGINT NOT NULL REFERENCES reserva(idreserva),
  fk_idcaja BIGINT REFERENCES caja(idcaja),
  metodo TEXT NOT NULL CHECK (metodo IN ('efectivo','tarjeta','transferencia')),
  clase TEXT NOT NULL DEFAULT 'pago' CHECK (clase IN ('pago','devolucion')),
  monto_gs BIGINT NOT NULL CHECK (monto_gs > 0), referencia TEXT, anulado BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS tarea_limpieza (
  idtarea_limpieza BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idhabitacion BIGINT NOT NULL REFERENCES habitacion(idhabitacion),
  fk_idusuario_asignado BIGINT REFERENCES usuario(idusuario),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_progreso','completada')),
  prioridad TEXT NOT NULL DEFAULT 'normal' CHECK (prioridad IN ('normal','alta')),
  nota TEXT, completada_en TIMESTAMPTZ,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS documento_electronico (
  iddocumento_electronico BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idreserva BIGINT NOT NULL REFERENCES reserva(idreserva),
  fk_iddocumento_referencia BIGINT REFERENCES documento_electronico(iddocumento_electronico),
  tipo TEXT NOT NULL CHECK (tipo IN ('factura','nota_credito')),
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','firmado','enviado','pendiente','aprobado','rechazado')),
  cdc TEXT UNIQUE, numero TEXT, xml TEXT, xml_firmado TEXT, xml_respuesta TEXT, kude TEXT,
  datos JSONB,
  codigo_respuesta TEXT, mensaje_respuesta TEXT, total_gs BIGINT NOT NULL CHECK (total_gs >= 0),
  intento INTEGER NOT NULL DEFAULT 0, ultima_consulta TIMESTAMPTZ,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS factura_unica_reserva ON documento_electronico(fk_idreserva) WHERE tipo='factura' AND activo;
CREATE UNIQUE INDEX IF NOT EXISTS nota_credito_unica_referencia ON documento_electronico(fk_iddocumento_referencia) WHERE tipo='nota_credito' AND activo;
CREATE TABLE IF NOT EXISTS evento_documento (
  idevento_documento BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_iddocumento_electronico BIGINT NOT NULL REFERENCES documento_electronico(iddocumento_electronico),
  tipo TEXT NOT NULL, detalle TEXT, respuesta TEXT,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS auditoria (
  idauditoria BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idusuario BIGINT REFERENCES usuario(idusuario),
  accion TEXT NOT NULL, entidad TEXT NOT NULL, identificador TEXT, detalle JSONB,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
