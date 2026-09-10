-- Idempotencia del cobro.
--
-- payUrl: la pagina del proveedor, guardada para poder REUTILIZARLA. Sin esto
-- un doble clic en «Pagar» abria dos cobranzas para el mismo pedido.
ALTER TABLE "Payment" ADD COLUMN "payUrl" TEXT;

-- UN solo cobro abierto por pedido y proveedor. Es un indice PARCIAL: los
-- pagados, fallidos y caducados pueden ser varios —son la historia del pedido—
-- pero pendiente no puede haber mas de uno.
--
-- Va en la base y no solo en el codigo a proposito: dos peticiones simultaneas
-- comprueban las dos que no hay ninguno y las dos lo crean. Quien lo impide de
-- verdad es esto.
CREATE UNIQUE INDEX "Payment_one_pending_per_order"
  ON "Payment" ("orderId", "provider")
  WHERE "status" = 'pending';
