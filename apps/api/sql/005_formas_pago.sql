BEGIN;
CREATE TABLE IF NOT EXISTS forma_pago (
  idforma_pago BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE CHECK (btrim(nombre)<>''),
  descripcion TEXT,
  es_efectivo BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS forma_pago_nombre_normalizado ON forma_pago(lower(btrim(nombre)));
ALTER TABLE pago ADD COLUMN IF NOT EXISTS fk_idforma_pago BIGINT REFERENCES forma_pago(idforma_pago) ON DELETE RESTRICT;
ALTER TABLE caja_detalle ADD COLUMN IF NOT EXISTS fk_idforma_pago BIGINT REFERENCES forma_pago(idforma_pago) ON DELETE RESTRICT;
DROP TRIGGER IF EXISTS pago_caja_sincronizacion ON pago;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='pago' AND column_name='metodo') THEN
    INSERT INTO forma_pago(nombre,es_efectivo,creado_por) VALUES
      ('Efectivo',TRUE,'Migración'),('Tarjeta',FALSE,'Migración'),('Transferencia',FALSE,'Migración')
      ON CONFLICT DO NOTHING;
    UPDATE pago p SET fk_idforma_pago=f.idforma_pago FROM forma_pago f
      WHERE p.fk_idforma_pago IS NULL AND lower(f.nombre)=p.metodo;
  END IF;
END $$;
UPDATE caja_detalle d SET fk_idforma_pago=p.fk_idforma_pago FROM pago p
  WHERE p.idpago=d.fk_idpago AND d.fk_idforma_pago IS NULL;
ALTER TABLE pago ALTER COLUMN fk_idforma_pago SET NOT NULL;
ALTER TABLE caja_detalle ALTER COLUMN fk_idforma_pago SET NOT NULL;
CREATE INDEX IF NOT EXISTS pago_forma_pago ON pago(fk_idforma_pago);
CREATE INDEX IF NOT EXISTS caja_detalle_forma_pago ON caja_detalle(fk_idforma_pago);

CREATE OR REPLACE FUNCTION caja_totales(p_id BIGINT) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object(
    'ingresos_gs',COALESCE(SUM(d.monto_gs) FILTER(WHERE d.tipo='ingreso'),0)::text,
    'egresos_gs',COALESCE(SUM(d.monto_gs) FILTER(WHERE d.tipo='egreso'),0)::text,
    'neto_gs',COALESCE(SUM(CASE WHEN d.tipo='egreso' THEN -d.monto_gs ELSE d.monto_gs END),0)::text,
    'efectivo_gs',COALESCE(SUM(CASE WHEN d.tipo='egreso' THEN -d.monto_gs ELSE d.monto_gs END) FILTER(WHERE f.es_efectivo),0)::text,
    'no_efectivo_gs',COALESCE(SUM(CASE WHEN d.tipo='egreso' THEN -d.monto_gs ELSE d.monto_gs END) FILTER(WHERE NOT f.es_efectivo),0)::text)
  FROM caja_detalle d JOIN forma_pago f ON f.idforma_pago=d.fk_idforma_pago
  WHERE d.fk_idcaja=p_id AND d.activo AND NOT d.anulado
$$;

CREATE OR REPLACE FUNCTION proteger_forma_pago() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.es_efectivo IS DISTINCT FROM NEW.es_efectivo AND EXISTS(SELECT 1 FROM pago WHERE fk_idforma_pago=OLD.idforma_pago) THEN
    RAISE EXCEPTION 'No se puede cambiar la clasificación de una forma de pago utilizada' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS forma_pago_clasificacion ON forma_pago;
CREATE TRIGGER forma_pago_clasificacion BEFORE UPDATE ON forma_pago FOR EACH ROW EXECUTE FUNCTION proteger_forma_pago();

CREATE OR REPLACE FUNCTION sincronizar_pago_caja() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.anulado AND NOT NEW.anulado THEN RAISE EXCEPTION 'No se puede revertir una anulación'; END IF;
    IF OLD.fk_idcaja IS DISTINCT FROM NEW.fk_idcaja OR OLD.fk_idreserva IS DISTINCT FROM NEW.fk_idreserva OR OLD.monto_gs IS DISTINCT FROM NEW.monto_gs OR OLD.fk_idforma_pago IS DISTINCT FROM NEW.fk_idforma_pago OR OLD.clase IS DISTINCT FROM NEW.clase THEN
      RAISE EXCEPTION 'No se puede modificar el origen ni el importe de un pago registrado';
    END IF;
  ELSE
    PERFORM 1 FROM forma_pago WHERE idforma_pago=NEW.fk_idforma_pago AND activo FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La forma de pago no existe o está inactiva' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.fk_idcaja IS NOT NULL THEN
    PERFORM 1 FROM caja WHERE idcaja=NEW.fk_idcaja FOR UPDATE;
    IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM caja WHERE idcaja=NEW.fk_idcaja AND activo AND cerrada_en IS NULL) THEN
      RAISE EXCEPTION 'La caja está cerrada';
    END IF;
    INSERT INTO caja_detalle(fk_idcaja,fk_idpago,fecha_movimiento,descripcion,tipo,monto_gs,fk_idforma_pago,anulado,fecha_anulado,anulado_por,motivo_anulacion,fecha_creado,creado_por,activo)
    VALUES(NEW.fk_idcaja,NEW.idpago,NEW.fecha_creado,
      CASE WHEN NEW.clase='devolucion' THEN 'Devolución de reserva #' ELSE 'Pago de reserva #' END || NEW.fk_idreserva || COALESCE(' · ' || NULLIF(NEW.referencia,''),''),
      CASE WHEN NEW.clase='devolucion' THEN 'egreso' ELSE 'ingreso' END,NEW.monto_gs,NEW.fk_idforma_pago,NEW.anulado,NEW.fecha_anulado,NEW.anulado_por,NEW.motivo_anulacion,NEW.fecha_creado,NEW.creado_por,NEW.activo)
    ON CONFLICT(fk_idpago) DO UPDATE SET anulado=EXCLUDED.anulado,fecha_anulado=EXCLUDED.fecha_anulado,anulado_por=EXCLUDED.anulado_por,motivo_anulacion=EXCLUDED.motivo_anulacion,activo=EXCLUDED.activo;
  END IF;
  RETURN NEW;
END $$;
ALTER TABLE pago DROP COLUMN IF EXISTS metodo;
ALTER TABLE caja_detalle DROP COLUMN IF EXISTS metodo;
CREATE TRIGGER pago_caja_sincronizacion AFTER INSERT OR UPDATE ON pago FOR EACH ROW EXECUTE FUNCTION sincronizar_pago_caja();
COMMIT;
