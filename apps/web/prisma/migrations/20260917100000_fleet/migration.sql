-- Una base de datos por oficina.
--
-- Hasta aquí todas las oficinas vivían en la misma base y lo que las separaba
-- era el filtro por `tenantId` que el código no se olvida de poner. Esto lo
-- cambia de sitio: cada oficina pasa a tener SU base de datos, y entonces lo
-- que impide que una vea a otra deja de ser el cuidado de quien escribe la
-- consulta y pasa a ser que dos bases de PostgreSQL no se consultan entre sí.
--
-- Esta migración solo prepara el terreno: apunta dónde vive cada oficina y crea
-- el directorio de lo público. Mover las filas es `npm run db:split`, y el
-- reparto no cambia hasta que `TENANCY=fleet`.

ALTER TABLE "Tenant" ADD COLUMN "databaseName" TEXT;
CREATE UNIQUE INDEX "Tenant_databaseName_key" ON "Tenant"("databaseName");

-- El directorio de lo que se sirve SIN oficina. Con una base por oficina, un
-- slug público ya no se puede resolver mirando: hay que saber en qué base está.
-- Esto lo dice, y no dice nada más — ni el evento, ni la fecha, ni los novios.
CREATE TABLE "PublicSlug" (
    "slug"      TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicSlug_pkey" PRIMARY KEY ("slug")
);
CREATE INDEX "PublicSlug_tenantId_idx" ON "PublicSlug"("tenantId");
ALTER TABLE "PublicSlug" ADD CONSTRAINT "PublicSlug_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GuestToken" (
    "token"     TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuestToken_pkey" PRIMARY KEY ("token")
);
CREATE INDEX "GuestToken_tenantId_idx" ON "GuestToken"("tenantId");
ALTER TABLE "GuestToken" ADD CONSTRAINT "GuestToken_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
