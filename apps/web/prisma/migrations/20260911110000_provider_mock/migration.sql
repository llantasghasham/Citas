-- `mock` es un proveedor propio, no «efectivo».
--
-- Se guardaba como `manual`, y esa mentira tenia coste: un cobro de prueba
-- quedaba indistinguible de uno recibido en mano, y al resolver cada pago por
-- el proveedor CON EL QUE SE ABRIO se habria tratado como dinero ya cobrado.
ALTER TYPE "PaymentProviderId" ADD VALUE IF NOT EXISTS 'mock';
