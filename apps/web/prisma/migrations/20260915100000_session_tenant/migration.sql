-- La sesión cuelga de su oficina.
--
-- No es un adorno: sin poder mirar el estado de la oficina al resolver la
-- sesión, suspender una no suspendía nada. Una sesión dura treinta días, así
-- que quien ya estaba dentro seguía trabajando hasta que se le ocurriera salir.

-- Filas que apuntan a una oficina que ya no existe. No las había cómo crear —no
-- había clave— pero un borrado antiguo pudo dejarlas.
UPDATE "Session" s SET "tenantId" = NULL
 WHERE s."tenantId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "Tenant" t WHERE t.id = s."tenantId");

CREATE INDEX IF NOT EXISTS "Session_tenantId_idx" ON "Session"("tenantId");

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
