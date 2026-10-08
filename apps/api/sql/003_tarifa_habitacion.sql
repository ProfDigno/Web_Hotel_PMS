ALTER TABLE habitacion ADD COLUMN IF NOT EXISTS fk_idtarifa BIGINT;

UPDATE habitacion h
SET fk_idtarifa = (
  SELECT t.idtarifa
  FROM tarifa t
  WHERE t.fk_idtipo_habitacion = h.fk_idtipo_habitacion AND t.activo
  ORDER BY t.fecha_inicio DESC, t.idtarifa DESC
  LIMIT 1
)
WHERE h.fk_idtarifa IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='habitacion_fk_idtarifa_fkey') THEN
    ALTER TABLE habitacion ADD CONSTRAINT habitacion_fk_idtarifa_fkey FOREIGN KEY (fk_idtarifa) REFERENCES tarifa(idtarifa);
  END IF;
END $$;
