ALTER TABLE venta_item
  ADD COLUMN precio_compra_unitario_gs BIGINT;

UPDATE venta_item vi
SET precio_compra_unitario_gs = p.precio_compra
FROM producto p
WHERE p.idproducto = vi.fk_idproducto;

ALTER TABLE venta_item
  ALTER COLUMN precio_compra_unitario_gs SET NOT NULL,
  ADD CONSTRAINT venta_item_precio_compra_unitario_gs_check
    CHECK (precio_compra_unitario_gs >= 0);
