BEGIN;
ALTER TABLE pago ADD COLUMN IF NOT EXISTS fecha_anulado TIMESTAMPTZ;
ALTER TABLE pago ADD COLUMN IF NOT EXISTS anulado_por TEXT;
ALTER TABLE pago ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT;
ALTER TABLE caja ADD COLUMN IF NOT EXISTS cierre_totales JSONB;
ALTER TABLE caja ADD COLUMN IF NOT EXISTS cierre_reconstruido BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS caja_detalle (
  idcaja_detalle BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idcaja BIGINT NOT NULL REFERENCES caja(idcaja) ON DELETE RESTRICT,
  fk_idpago BIGINT NOT NULL UNIQUE REFERENCES pago(idpago) ON DELETE RESTRICT,
  fecha_movimiento TIMESTAMPTZ NOT NULL,
  descripcion TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  monto_gs BIGINT NOT NULL CHECK (monto_gs > 0),
  metodo TEXT NOT NULL CHECK (metodo IN ('efectivo','tarjeta','transferencia')),
  anulado BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_anulado TIMESTAMPTZ,
  anulado_por TEXT,
  motivo_anulacion TEXT,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS caja_detalle_caja_fecha ON caja_detalle(fk_idcaja,fecha_movimiento DESC);

INSERT INTO caja_detalle(fk_idcaja,fk_idpago,fecha_movimiento,descripcion,tipo,monto_gs,metodo,anulado,fecha_anulado,anulado_por,motivo_anulacion,fecha_creado,creado_por,activo)
SELECT fk_idcaja,idpago,fecha_creado,
  CASE WHEN clase='devolucion' THEN 'Devolución de reserva #' ELSE 'Pago de reserva #' END || fk_idreserva || COALESCE(' · ' || NULLIF(referencia,''),''),
  CASE WHEN clase='devolucion' THEN 'egreso' ELSE 'ingreso' END,monto_gs,metodo,anulado,fecha_anulado,anulado_por,motivo_anulacion,fecha_creado,creado_por,activo
FROM pago WHERE fk_idcaja IS NOT NULL ON CONFLICT(fk_idpago) DO NOTHING;

CREATE OR REPLACE FUNCTION caja_totales(p_id BIGINT) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object(
    'ingresos_gs',COALESCE(SUM(monto_gs) FILTER(WHERE tipo='ingreso'),0)::text,
    'egresos_gs',COALESCE(SUM(monto_gs) FILTER(WHERE tipo='egreso'),0)::text,
    'neto_gs',COALESCE(SUM(CASE WHEN tipo='egreso' THEN -monto_gs ELSE monto_gs END),0)::text,
    'efectivo_gs',COALESCE(SUM(CASE WHEN tipo='egreso' THEN -monto_gs ELSE monto_gs END) FILTER(WHERE metodo='efectivo'),0)::text,
    'tarjeta_gs',COALESCE(SUM(CASE WHEN tipo='egreso' THEN -monto_gs ELSE monto_gs END) FILTER(WHERE metodo='tarjeta'),0)::text,
    'transferencia_gs',COALESCE(SUM(CASE WHEN tipo='egreso' THEN -monto_gs ELSE monto_gs END) FILTER(WHERE metodo='transferencia'),0)::text)
  FROM caja_detalle WHERE fk_idcaja=p_id AND activo AND NOT anulado
$$;
UPDATE caja SET cierre_totales=caja_totales(idcaja),cierre_reconstruido=TRUE WHERE cerrada_en IS NOT NULL AND cierre_totales IS NULL;

CREATE OR REPLACE FUNCTION sincronizar_pago_caja() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.anulado AND NOT NEW.anulado THEN RAISE EXCEPTION 'No se puede revertir una anulación'; END IF;
    IF OLD.fk_idcaja IS DISTINCT FROM NEW.fk_idcaja OR OLD.fk_idreserva IS DISTINCT FROM NEW.fk_idreserva OR OLD.monto_gs IS DISTINCT FROM NEW.monto_gs OR OLD.metodo IS DISTINCT FROM NEW.metodo OR OLD.clase IS DISTINCT FROM NEW.clase THEN
      RAISE EXCEPTION 'No se puede modificar el origen ni el importe de un pago registrado';
    END IF;
  END IF;
  IF NEW.fk_idcaja IS NOT NULL THEN
    PERFORM 1 FROM caja WHERE idcaja=NEW.fk_idcaja FOR UPDATE;
    IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM caja WHERE idcaja=NEW.fk_idcaja AND activo AND cerrada_en IS NULL) THEN
      RAISE EXCEPTION 'La caja está cerrada';
    END IF;
    INSERT INTO caja_detalle(fk_idcaja,fk_idpago,fecha_movimiento,descripcion,tipo,monto_gs,metodo,anulado,fecha_anulado,anulado_por,motivo_anulacion,fecha_creado,creado_por,activo)
    VALUES(NEW.fk_idcaja,NEW.idpago,NEW.fecha_creado,
      CASE WHEN NEW.clase='devolucion' THEN 'Devolución de reserva #' ELSE 'Pago de reserva #' END || NEW.fk_idreserva || COALESCE(' · ' || NULLIF(NEW.referencia,''),''),
      CASE WHEN NEW.clase='devolucion' THEN 'egreso' ELSE 'ingreso' END,NEW.monto_gs,NEW.metodo,NEW.anulado,NEW.fecha_anulado,NEW.anulado_por,NEW.motivo_anulacion,NEW.fecha_creado,NEW.creado_por,NEW.activo)
    ON CONFLICT(fk_idpago) DO UPDATE SET anulado=EXCLUDED.anulado,fecha_anulado=EXCLUDED.fecha_anulado,anulado_por=EXCLUDED.anulado_por,motivo_anulacion=EXCLUDED.motivo_anulacion,activo=EXCLUDED.activo;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pago_caja_sincronizacion ON pago;
CREATE TRIGGER pago_caja_sincronizacion AFTER INSERT OR UPDATE ON pago FOR EACH ROW EXECUTE FUNCTION sincronizar_pago_caja();
COMMIT;
