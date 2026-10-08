CREATE TABLE categoria_producto (
  idcategoria_producto BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL CHECK (btrim(nombre) <> ''),
  orden INTEGER NOT NULL UNIQUE,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX categoria_producto_nombre ON categoria_producto(lower(btrim(nombre)));

CREATE TABLE producto (
  idproducto BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idcategoria_producto BIGINT NOT NULL REFERENCES categoria_producto(idcategoria_producto),
  nombre TEXT NOT NULL CHECK (btrim(nombre) <> ''),
  precio_venta BIGINT NOT NULL CHECK (precio_venta >= 0),
  precio_compra BIGINT NOT NULL CHECK (precio_compra >= 0),
  stock_actual INTEGER NOT NULL DEFAULT 0,
  stock_minimo INTEGER NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  descontar_stock BOOLEAN NOT NULL DEFAULT TRUE,
  es_vender BOOLEAN NOT NULL DEFAULT TRUE,
  es_comprar BOOLEAN NOT NULL DEFAULT FALSE,
  es_cocina BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX producto_categoria ON producto(fk_idcategoria_producto);

CREATE TABLE venta (
  idventa BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idreserva BIGINT REFERENCES reserva(idreserva),
  fk_idhabitacion BIGINT REFERENCES habitacion(idhabitacion),
  destino TEXT NOT NULL CHECK (destino IN ('restaurante','habitacion')),
  total_gs BIGINT NOT NULL CHECK (total_gs >= 0),
  pagado_inicial_gs BIGINT NOT NULL CHECK (pagado_inicial_gs >= 0),
  anulado BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_anulado TIMESTAMPTZ, anulado_por TEXT, motivo_anulacion TEXT,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (pagado_inicial_gs <= total_gs),
  CHECK (fk_idhabitacion IS NULL OR fk_idreserva IS NOT NULL)
);
CREATE INDEX venta_reserva ON venta(fk_idreserva);

CREATE TABLE venta_item (
  idventa_item BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idventa BIGINT NOT NULL REFERENCES venta(idventa),
  fk_idproducto BIGINT NOT NULL REFERENCES producto(idproducto),
  fk_idmovimiento BIGINT REFERENCES movimiento(idmovimiento),
  nombre_producto TEXT NOT NULL,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario_gs BIGINT NOT NULL CHECK (precio_unitario_gs >= 0),
  pago_inicial TEXT NOT NULL CHECK (pago_inicial IN ('pagado','pendiente')),
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX venta_item_venta ON venta_item(fk_idventa);

CREATE TABLE inventario_movimiento (
  idinventario_movimiento BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idproducto BIGINT NOT NULL REFERENCES producto(idproducto),
  fk_idventa_item BIGINT REFERENCES venta_item(idventa_item),
  tipo TEXT NOT NULL CHECK (tipo IN ('inicial','ajuste','venta','anulacion')),
  cantidad_anterior INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  cantidad_nueva INTEGER NOT NULL,
  motivo TEXT NOT NULL,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (cantidad_nueva = cantidad_anterior + delta)
);
CREATE INDEX inventario_producto_fecha ON inventario_movimiento(fk_idproducto,fecha_creado DESC);

ALTER TABLE pago ALTER COLUMN fk_idreserva DROP NOT NULL;
ALTER TABLE pago ADD COLUMN fk_idventa BIGINT REFERENCES venta(idventa);
ALTER TABLE pago ADD CONSTRAINT pago_origen_requerido CHECK (fk_idreserva IS NOT NULL OR fk_idventa IS NOT NULL);
CREATE INDEX pago_venta ON pago(fk_idventa);

CREATE OR REPLACE FUNCTION sincronizar_pago_caja() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.anulado AND NOT NEW.anulado THEN RAISE EXCEPTION 'No se puede revertir una anulación'; END IF;
    IF OLD.fk_idcaja IS DISTINCT FROM NEW.fk_idcaja OR OLD.fk_idreserva IS DISTINCT FROM NEW.fk_idreserva OR OLD.fk_idventa IS DISTINCT FROM NEW.fk_idventa OR OLD.monto_gs IS DISTINCT FROM NEW.monto_gs OR OLD.fk_idforma_pago IS DISTINCT FROM NEW.fk_idforma_pago OR OLD.clase IS DISTINCT FROM NEW.clase THEN
      RAISE EXCEPTION 'No se puede modificar el origen ni el importe de un pago registrado';
    END IF;
  ELSE
    PERFORM 1 FROM forma_pago WHERE idforma_pago=NEW.fk_idforma_pago AND activo FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La forma de pago no existe o está inactiva' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.fk_idcaja IS NOT NULL THEN
    PERFORM 1 FROM caja WHERE idcaja=NEW.fk_idcaja FOR UPDATE;
    IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM caja WHERE idcaja=NEW.fk_idcaja AND activo AND cerrada_en IS NULL) THEN RAISE EXCEPTION 'La caja está cerrada'; END IF;
    INSERT INTO caja_detalle(fk_idcaja,fk_idpago,fecha_movimiento,descripcion,tipo,monto_gs,fk_idforma_pago,anulado,fecha_anulado,anulado_por,motivo_anulacion,fecha_creado,creado_por,activo)
    VALUES(NEW.fk_idcaja,NEW.idpago,NEW.fecha_creado,
      CASE WHEN NEW.fk_idventa IS NOT NULL THEN (CASE WHEN NEW.clase='devolucion' THEN 'Devolución de venta #' ELSE 'Venta #' END) || NEW.fk_idventa
        ELSE (CASE WHEN NEW.clase='devolucion' THEN 'Devolución de reserva #' ELSE 'Pago de reserva #' END) || NEW.fk_idreserva END || COALESCE(' · ' || NULLIF(NEW.referencia,''),''),
      CASE WHEN NEW.clase='devolucion' THEN 'egreso' ELSE 'ingreso' END,NEW.monto_gs,NEW.fk_idforma_pago,NEW.anulado,NEW.fecha_anulado,NEW.anulado_por,NEW.motivo_anulacion,NEW.fecha_creado,NEW.creado_por,NEW.activo)
    ON CONFLICT(fk_idpago) DO UPDATE SET anulado=EXCLUDED.anulado,fecha_anulado=EXCLUDED.fecha_anulado,anulado_por=EXCLUDED.anulado_por,motivo_anulacion=EXCLUDED.motivo_anulacion,activo=EXCLUDED.activo;
  END IF;
  RETURN NEW;
END $$;
