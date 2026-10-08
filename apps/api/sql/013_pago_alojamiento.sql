-- NULL preserves legacy payments without an attribution.
ALTER TABLE pago ADD COLUMN IF NOT EXISTS monto_alojamiento_gs BIGINT;
ALTER TABLE pago ADD CONSTRAINT pago_monto_alojamiento_valido
  CHECK (monto_alojamiento_gs IS NULL OR
    (monto_alojamiento_gs >= 0 AND monto_alojamiento_gs <= monto_gs));
CREATE INDEX IF NOT EXISTS pago_alojamiento_fecha_idx ON pago(fecha_creado, fk_idforma_pago)
  WHERE activo AND NOT anulado AND fk_idreserva IS NOT NULL AND fk_idventa IS NULL;
