ALTER TABLE pago ADD COLUMN IF NOT EXISTS solicitud_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS pago_solicitud_id_unica
  ON pago(fk_idreserva, solicitud_id)
  WHERE solicitud_id IS NOT NULL;
