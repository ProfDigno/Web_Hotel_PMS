CREATE TABLE gasto_tipo (
  idgasto_tipo BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL CHECK (btrim(nombre)<>''),
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX gasto_tipo_nombre ON gasto_tipo(lower(btrim(nombre)));
CREATE TABLE gasto (
  idgasto BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idgasto_tipo BIGINT NOT NULL REFERENCES gasto_tipo(idgasto_tipo) ON DELETE RESTRICT,
  fecha_gasto DATE NOT NULL,
  descripcion TEXT NOT NULL CHECK (btrim(descripcion)<>''),
  monto_gs BIGINT NOT NULL CHECK (monto_gs>0),
  fk_idforma_pago BIGINT NOT NULL REFERENCES forma_pago(idforma_pago) ON DELETE RESTRICT,
  fk_idcaja BIGINT NOT NULL REFERENCES caja(idcaja) ON DELETE RESTRICT,
  anulado BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_anulado TIMESTAMPTZ, anulado_por TEXT, motivo_anulacion TEXT,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(), creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX gasto_fecha ON gasto(fecha_gasto,idgasto);
CREATE INDEX gasto_tipo_fecha ON gasto(fk_idgasto_tipo,fecha_gasto);
CREATE INDEX gasto_forma_fecha ON gasto(fk_idforma_pago,fecha_gasto);
ALTER TABLE caja_detalle ALTER COLUMN fk_idpago DROP NOT NULL;
ALTER TABLE caja_detalle ADD COLUMN fk_idgasto BIGINT UNIQUE REFERENCES gasto(idgasto) ON DELETE RESTRICT;
ALTER TABLE caja_detalle ADD CONSTRAINT caja_detalle_origen CHECK (num_nonnulls(fk_idpago,fk_idgasto)=1);

CREATE FUNCTION sincronizar_gasto_caja() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM caja WHERE idcaja=NEW.fk_idcaja FOR UPDATE;
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM caja WHERE idcaja=NEW.fk_idcaja AND activo AND cerrada_en IS NULL) THEN
      RAISE EXCEPTION 'La caja está cerrada' USING ERRCODE='23514';
    END IF;
    IF NEW.fecha_gasto>(now() AT TIME ZONE 'America/Asuncion')::date THEN
      RAISE EXCEPTION 'La fecha del gasto no puede ser futura' USING ERRCODE='23514';
    END IF;
    PERFORM 1 FROM gasto_tipo WHERE idgasto_tipo=NEW.fk_idgasto_tipo AND activo FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El tipo de gasto no existe o está inactivo' USING ERRCODE='23514'; END IF;
    PERFORM 1 FROM forma_pago WHERE idforma_pago=NEW.fk_idforma_pago AND activo FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La forma de pago no existe o está inactiva' USING ERRCODE='23514'; END IF;
  ELSE
    IF OLD.anulado AND NOT NEW.anulado THEN RAISE EXCEPTION 'No se puede revertir una anulación' USING ERRCODE='23514'; END IF;
    IF (to_jsonb(OLD)-ARRAY['anulado','fecha_anulado','anulado_por','motivo_anulacion']) IS DISTINCT FROM
       (to_jsonb(NEW)-ARRAY['anulado','fecha_anulado','anulado_por','motivo_anulacion']) THEN
      RAISE EXCEPTION 'Un gasto registrado se corrige mediante anulación' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.anulado AND (NULLIF(btrim(NEW.motivo_anulacion),'') IS NULL OR NEW.fecha_anulado IS NULL OR NEW.anulado_por IS NULL) THEN
    RAISE EXCEPTION 'La anulación requiere motivo, fecha y usuario' USING ERRCODE='23514';
  END IF;
  INSERT INTO caja_detalle(fk_idcaja,fk_idgasto,fecha_movimiento,descripcion,tipo,monto_gs,fk_idforma_pago,anulado,fecha_anulado,anulado_por,motivo_anulacion,fecha_creado,creado_por,activo)
  VALUES(NEW.fk_idcaja,NEW.idgasto,NEW.fecha_creado,'Gasto #'||NEW.idgasto||' · '||NEW.descripcion,'egreso',NEW.monto_gs,NEW.fk_idforma_pago,NEW.anulado,NEW.fecha_anulado,NEW.anulado_por,NEW.motivo_anulacion,NEW.fecha_creado,NEW.creado_por,NEW.activo)
  ON CONFLICT(fk_idgasto) DO UPDATE SET anulado=EXCLUDED.anulado,fecha_anulado=EXCLUDED.fecha_anulado,anulado_por=EXCLUDED.anulado_por,motivo_anulacion=EXCLUDED.motivo_anulacion;
  RETURN NEW;
END $$;
CREATE TRIGGER gasto_caja_sincronizacion AFTER INSERT OR UPDATE ON gasto FOR EACH ROW EXECUTE FUNCTION sincronizar_gasto_caja();

CREATE OR REPLACE FUNCTION proteger_forma_pago() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.es_efectivo IS DISTINCT FROM NEW.es_efectivo AND
    (EXISTS(SELECT 1 FROM pago WHERE fk_idforma_pago=OLD.idforma_pago) OR EXISTS(SELECT 1 FROM gasto WHERE fk_idforma_pago=OLD.idforma_pago)) THEN
    RAISE EXCEPTION 'No se puede cambiar la clasificación de una forma de pago utilizada' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
