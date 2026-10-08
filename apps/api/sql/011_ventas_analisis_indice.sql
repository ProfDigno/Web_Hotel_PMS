CREATE INDEX IF NOT EXISTS venta_analisis_fecha
  ON venta(fecha_creado)
  WHERE activo AND NOT anulado;
