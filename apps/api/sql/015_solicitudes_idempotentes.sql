CREATE TABLE IF NOT EXISTS solicitud_idempotente (
  solicitud_id uuid PRIMARY KEY,
  fk_idusuario bigint NOT NULL REFERENCES usuario(idusuario),
  firma text NOT NULL,
  respuesta jsonb,
  fecha_creado timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS solicitud_idempotente_fecha_idx
  ON solicitud_idempotente(fecha_creado);
