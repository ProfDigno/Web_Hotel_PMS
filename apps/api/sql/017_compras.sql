CREATE TABLE proveedor (
  idproveedor BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  razon_social TEXT NOT NULL CHECK (btrim(razon_social)<>''),
  ruc TEXT NOT NULL CHECK (btrim(ruc)<>''),
  direccion TEXT NOT NULL CHECK (btrim(direccion)<>''),
  telefono TEXT NOT NULL CHECK (btrim(telefono)<>''),
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX proveedor_ruc_unico ON proveedor(lower(btrim(ruc)));

ALTER TABLE producto ADD COLUMN precio_compra_base_gs BIGINT;

CREATE TABLE compra (
  idcompra BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idproveedor BIGINT NOT NULL REFERENCES proveedor(idproveedor) ON DELETE RESTRICT,
  total_gs BIGINT NOT NULL CHECK (total_gs>0),
  anulado BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_anulado TIMESTAMPTZ, anulado_por TEXT, motivo_anulacion TEXT,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX compra_fecha ON compra(fecha_creado,idcompra);
CREATE INDEX compra_proveedor_fecha ON compra(fk_idproveedor,fecha_creado);

CREATE TABLE compra_item (
  idcompra_item BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idcompra BIGINT NOT NULL REFERENCES compra(idcompra) ON DELETE RESTRICT,
  fk_idproducto BIGINT NOT NULL REFERENCES producto(idproducto) ON DELETE RESTRICT,
  nombre_producto TEXT NOT NULL,
  cantidad INTEGER NOT NULL CHECK (cantidad>0),
  precio_unitario_gs BIGINT NOT NULL CHECK (precio_unitario_gs>=0),
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX compra_item_compra ON compra_item(fk_idcompra);
CREATE INDEX compra_item_producto ON compra_item(fk_idproducto,fk_idcompra);

CREATE TABLE compra_pago (
  idcompra_pago BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idcompra BIGINT NOT NULL REFERENCES compra(idcompra) ON DELETE RESTRICT,
  fk_idcaja BIGINT NOT NULL REFERENCES caja(idcaja) ON DELETE RESTRICT,
  fk_idforma_pago BIGINT NOT NULL REFERENCES forma_pago(idforma_pago) ON DELETE RESTRICT,
  monto_gs BIGINT NOT NULL CHECK (monto_gs>0),
  anulado BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_anulado TIMESTAMPTZ, anulado_por TEXT, motivo_anulacion TEXT,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX compra_pago_compra ON compra_pago(fk_idcompra);
CREATE INDEX compra_pago_caja ON compra_pago(fk_idcaja);

ALTER TABLE inventario_movimiento ADD COLUMN fk_idcompra_item BIGINT REFERENCES compra_item(idcompra_item) ON DELETE RESTRICT;
ALTER TABLE inventario_movimiento DROP CONSTRAINT inventario_movimiento_tipo_check;
ALTER TABLE inventario_movimiento ADD CONSTRAINT inventario_movimiento_tipo_check CHECK (tipo IN ('inicial','ajuste','venta','anulacion','compra','anulacion_compra'));
CREATE UNIQUE INDEX inventario_compra_item_tipo ON inventario_movimiento(fk_idcompra_item,tipo) WHERE fk_idcompra_item IS NOT NULL;

ALTER TABLE caja_detalle ADD COLUMN fk_idcompra BIGINT REFERENCES compra(idcompra) ON DELETE RESTRICT;
ALTER TABLE caja_detalle ADD COLUMN fk_idcompra_pago BIGINT UNIQUE REFERENCES compra_pago(idcompra_pago) ON DELETE RESTRICT;
ALTER TABLE caja_detalle DROP CONSTRAINT caja_detalle_origen;
ALTER TABLE caja_detalle ADD CONSTRAINT caja_detalle_origen CHECK (num_nonnulls(fk_idpago,fk_idgasto,fk_idcompra_pago)=1 AND ((fk_idcompra_pago IS NULL AND fk_idcompra IS NULL) OR (fk_idcompra_pago IS NOT NULL AND fk_idcompra IS NOT NULL)));
CREATE INDEX caja_detalle_compra ON caja_detalle(fk_idcompra);

CREATE FUNCTION validar_compra_pago() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE total BIGINT; pagado BIGINT;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.anulado AND NOT NEW.anulado THEN RAISE EXCEPTION 'No se puede revertir una anulación' USING ERRCODE='23514'; END IF;
    IF (to_jsonb(OLD)-ARRAY['anulado','fecha_anulado','anulado_por','motivo_anulacion']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['anulado','fecha_anulado','anulado_por','motivo_anulacion']) THEN
      RAISE EXCEPTION 'Un pago registrado se corrige mediante anulación de la compra' USING ERRCODE='23514';
    END IF;
    IF NEW.anulado AND (NULLIF(btrim(NEW.motivo_anulacion),'') IS NULL OR NEW.fecha_anulado IS NULL OR NEW.anulado_por IS NULL) THEN RAISE EXCEPTION 'La anulación requiere motivo, fecha y usuario' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT total_gs INTO total FROM compra WHERE idcompra=NEW.fk_idcompra AND activo AND NOT anulado FOR UPDATE;
    IF total IS NULL THEN RAISE EXCEPTION 'La compra no está vigente' USING ERRCODE='23514'; END IF;
    PERFORM 1 FROM caja WHERE idcaja=NEW.fk_idcaja AND activo AND cerrada_en IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Abrí una caja antes de pagar' USING ERRCODE='23514'; END IF;
    PERFORM 1 FROM forma_pago WHERE idforma_pago=NEW.fk_idforma_pago AND activo FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La forma de pago no existe o está inactiva' USING ERRCODE='23514'; END IF;
    SELECT COALESCE(SUM(monto_gs),0) INTO pagado FROM compra_pago WHERE fk_idcompra=NEW.fk_idcompra AND activo AND NOT anulado;
    IF pagado+NEW.monto_gs>total THEN RAISE EXCEPTION 'El pago supera el saldo de la compra' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER compra_pago_validacion BEFORE INSERT OR UPDATE ON compra_pago FOR EACH ROW EXECUTE FUNCTION validar_compra_pago();

CREATE FUNCTION sincronizar_compra_pago_caja() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO caja_detalle(fk_idcaja,fk_idcompra,fk_idcompra_pago,fecha_movimiento,descripcion,tipo,monto_gs,fk_idforma_pago,anulado,fecha_anulado,anulado_por,motivo_anulacion,fecha_creado,creado_por,activo)
  VALUES(NEW.fk_idcaja,NEW.fk_idcompra,NEW.idcompra_pago,NEW.fecha_creado,'Compra #'||NEW.fk_idcompra||' · Pago #'||NEW.idcompra_pago,'egreso',NEW.monto_gs,NEW.fk_idforma_pago,NEW.anulado,NEW.fecha_anulado,NEW.anulado_por,NEW.motivo_anulacion,NEW.fecha_creado,NEW.creado_por,NEW.activo)
  ON CONFLICT(fk_idcompra_pago) DO UPDATE SET anulado=EXCLUDED.anulado,fecha_anulado=EXCLUDED.fecha_anulado,anulado_por=EXCLUDED.anulado_por,motivo_anulacion=EXCLUDED.motivo_anulacion;
  RETURN NEW;
END $$;
CREATE TRIGGER compra_pago_caja_sincronizacion AFTER INSERT OR UPDATE ON compra_pago FOR EACH ROW EXECUTE FUNCTION sincronizar_compra_pago_caja();

CREATE OR REPLACE FUNCTION proteger_forma_pago() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.es_efectivo IS DISTINCT FROM NEW.es_efectivo AND
    (EXISTS(SELECT 1 FROM pago WHERE fk_idforma_pago=OLD.idforma_pago) OR EXISTS(SELECT 1 FROM gasto WHERE fk_idforma_pago=OLD.idforma_pago) OR EXISTS(SELECT 1 FROM compra_pago WHERE fk_idforma_pago=OLD.idforma_pago)) THEN
    RAISE EXCEPTION 'No se puede cambiar la clasificación de una forma de pago utilizada' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
