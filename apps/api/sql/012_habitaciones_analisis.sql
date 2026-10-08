ALTER TABLE reserva ADD COLUMN IF NOT EXISTS fecha_checkin TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS habitacion_disponibilidad_historial (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fk_idhabitacion BIGINT NOT NULL REFERENCES habitacion(idhabitacion),
  vigente_desde TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  activo BOOLEAN NOT NULL,
  fuera_servicio BOOLEAN NOT NULL,
  fk_idtipo_habitacion BIGINT NOT NULL REFERENCES tipo_habitacion(idtipo_habitacion)
);
CREATE INDEX IF NOT EXISTS habitacion_disponibilidad_fecha_idx
  ON habitacion_disponibilidad_historial(fk_idhabitacion,vigente_desde DESC,id DESC);

INSERT INTO habitacion_disponibilidad_historial(fk_idhabitacion,activo,fuera_servicio,fk_idtipo_habitacion)
SELECT h.idhabitacion,h.activo,h.fuera_servicio,h.fk_idtipo_habitacion
FROM habitacion h WHERE NOT EXISTS (
  SELECT 1 FROM habitacion_disponibilidad_historial x WHERE x.fk_idhabitacion=h.idhabitacion
);

CREATE OR REPLACE FUNCTION registrar_disponibilidad_habitacion() RETURNS trigger AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.activo IS DISTINCT FROM OLD.activo
    OR NEW.fuera_servicio IS DISTINCT FROM OLD.fuera_servicio
    OR NEW.fk_idtipo_habitacion IS DISTINCT FROM OLD.fk_idtipo_habitacion THEN
    INSERT INTO habitacion_disponibilidad_historial(fk_idhabitacion,activo,fuera_servicio,fk_idtipo_habitacion)
    VALUES(NEW.idhabitacion,NEW.activo,NEW.fuera_servicio,NEW.fk_idtipo_habitacion);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS habitacion_registrar_disponibilidad ON habitacion;
CREATE TRIGGER habitacion_registrar_disponibilidad
AFTER INSERT OR UPDATE OF activo,fuera_servicio,fk_idtipo_habitacion ON habitacion
FOR EACH ROW EXECUTE FUNCTION registrar_disponibilidad_habitacion();

CREATE INDEX IF NOT EXISTS reserva_fecha_creado_estado_idx ON reserva(fecha_creado,estado) WHERE activo;
CREATE INDEX IF NOT EXISTS reserva_habitacion_fechas_idx ON reserva_habitacion(fecha_entrada,fecha_salida) WHERE activo;
