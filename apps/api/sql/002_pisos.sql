CREATE TABLE IF NOT EXISTS piso (
  idpiso BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero INTEGER NOT NULL CHECK (numero > 0),
  nombre TEXT NOT NULL UNIQUE,
  fecha_creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE habitacion ADD COLUMN IF NOT EXISTS fk_idpiso BIGINT;

DO $$
DECLARE
  v_nombre TEXT;
  v_numero INTEGER;
  v_next INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='habitacion' AND column_name='piso'
  ) THEN
    FOR v_nombre IN
      SELECT DISTINCT COALESCE(NULLIF(btrim(piso), ''), 'Sin asignar')
      FROM habitacion
      WHERE fk_idpiso IS NULL
    LOOP
      IF v_nombre ~ '^[0-9]+$' AND v_nombre::INTEGER > 0 THEN
        v_numero := v_nombre::INTEGER;
      ELSE
        SELECT COALESCE(MAX(numero), 0) + 1 INTO v_next FROM piso;
        v_numero := v_next;
      END IF;
      WHILE EXISTS (SELECT 1 FROM piso WHERE numero = v_numero) LOOP
        v_numero := v_numero + 1;
      END LOOP;
      INSERT INTO piso(numero, nombre, creado_por)
      VALUES (v_numero, v_nombre, 'Migración')
      ON CONFLICT (nombre) DO NOTHING;
    END LOOP;

    UPDATE habitacion h
    SET fk_idpiso = p.idpiso
    FROM piso p
    WHERE h.fk_idpiso IS NULL
      AND p.nombre = COALESCE(NULLIF(btrim(h.piso), ''), 'Sin asignar');
  END IF;
END $$;

DO $$
DECLARE
  v_id BIGINT;
  v_numero INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM habitacion WHERE fk_idpiso IS NULL) THEN
    SELECT idpiso INTO v_id FROM piso WHERE nombre='Sin asignar' LIMIT 1;
    IF v_id IS NULL THEN
      SELECT COALESCE(MAX(numero),0)+1 INTO v_numero FROM piso;
      INSERT INTO piso(numero,nombre,creado_por) VALUES(v_numero,'Sin asignar','Migración') RETURNING idpiso INTO v_id;
    END IF;
    UPDATE habitacion SET fk_idpiso=v_id WHERE fk_idpiso IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='habitacion_fk_idpiso_fkey') THEN
    ALTER TABLE habitacion ADD CONSTRAINT habitacion_fk_idpiso_fkey FOREIGN KEY (fk_idpiso) REFERENCES piso(idpiso);
  END IF;
END $$;

ALTER TABLE habitacion ALTER COLUMN fk_idpiso SET NOT NULL;
ALTER TABLE habitacion DROP COLUMN IF EXISTS piso;
