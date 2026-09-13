-- La publicacion de una fiesta: una COPIA, no una marca en el evento.
--
-- Es la decision mas importante del diseno del directorio y conviene tenerla
-- escrita donde se aplica. Lo facil habria sido `isPublic`, `publicSlug` y
-- `publicTitle` DENTRO de `Event`: la boda privada y su cara publica en la misma
-- fila. Entonces lo unico que separaria la lista de invitados de la calle seria
-- que ninguna consulta publica se olvide de un `where isPublic = true` — y una
-- red que depende de que nadie se olvide no es una red. Es exactamente el modelo
-- que este proyecto ya rechazo para las oficinas.
--
-- Asi que es una tabla aparte con SOLO lo que se publica, escrita por una accion
-- explicita de quien organiza. Lo que se gana:
--
--   · La consulta publica NO PUEDE llegar a Guest, Rsvp, GuestPreference ni
--     CheckIn: no hay clave foranea que lleve, y con el reparto en `fleet` esas
--     tablas ni siquiera estan en esta base.
--   · Despublicar es BORRAR una fila, no confiar en que un `where` filtre.
--   · Corregir el evento privado no cambia solo lo ya publicado. Si la boda
--     cambia de salon, la pagina publica no se entera hasta que alguien lo
--     decide — que es lo correcto para algo que ya se indexo y se compartio.
--
-- El coste es que hay que copiar. Es el coste de no poder equivocarse.

CREATE TYPE "ListingDateMode" AS ENUM ('exact', 'month', 'season', 'hidden');
CREATE TYPE "ListingContactMode" AS ENUM ('none', 'form', 'whatsapp');

CREATE TABLE "PublicListing" (
  "id"     TEXT NOT NULL,
  "slug"   TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'ar',

  -- El mismo juego de estados que un proveedor, y se reutiliza su tipo a
  -- proposito: significan lo mismo, los mira la misma cola y los decide la misma
  -- persona. Dos enums identicos con nombres distintos es como acaban
  -- divergiendo.
  "status" "ProviderStatus" NOT NULL DEFAULT 'draft',

  "title"       TEXT NOT NULL,
  "description" TEXT,
  -- La portada, en el almacen de objetos. Nula mientras no haya bucket.
  "coverKey" TEXT,

  "eventType" "EventType" NOT NULL,

  -- La fecha EXACTA de una fiesta que aun no ha ocurrido es una invitacion a que
  -- aparezca gente. Por defecto se publica el mes.
  "dateMode" "ListingDateMode" NOT NULL DEFAULT 'month',
  "date"     TIMESTAMP(3),

  "governorate" "Governorate" NOT NULL,
  "district"    TEXT NOT NULL,
  "city"        TEXT NOT NULL,
  -- Solo si el salon lo autoriza. Que se celebrara alli es informacion suya.
  "venueName" TEXT,

  "contactMode" "ListingContactMode" NOT NULL DEFAULT 'none',

  -- SIN clave foranea, y no se consulta nunca desde lo publico: sirve para que
  -- el panel de la oficina sepa que su boda tiene publicacion, y para nada mas.
  "sourceEventId" TEXT,
  "tenantId"      TEXT,

  -- La fiesta NO es de la oficina. Sin autorizacion registrada —quien, cuando y
  -- CON QUE TEXTO, igual que el permiso de WhatsApp— no se publica.
  "authorizedBy"   TEXT,
  "authorizedAt"   TIMESTAMP(3),
  "authorizationText" TEXT,

  "submittedAt"  TIMESTAMP(3),
  "reviewedAt"   TIMESTAMP(3),
  "rejectedNote" TEXT,
  "publishedAt"  TIMESTAMP(3),

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PublicListing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicListing_slug_key" ON "PublicListing"("slug");
CREATE INDEX "PublicListing_status_publishedAt_idx" ON "PublicListing"("status", "publishedAt");
CREATE INDEX "PublicListing_governorate_status_idx" ON "PublicListing"("governorate", "status");
CREATE INDEX "PublicListing_sourceEventId_idx" ON "PublicListing"("sourceEventId");

-- La fecha exacta solo existe cuando se publica exacta. Guardarla «por si acaso»
-- con el modo en `month` es guardar el dia de la boda de alguien que pidio que
-- no se publicara.
ALTER TABLE "PublicListing"
  ADD CONSTRAINT "PublicListing_date_mode"
  CHECK (
    ("dateMode" = 'exact' AND "date" IS NOT NULL)
    OR ("dateMode" <> 'exact' AND "date" IS NULL)
  );

-- Y salir del borrador EXIGE la autorizacion entera. Lo comprueba la base y no
-- solo el codigo: una fila escrita a mano tampoco puede saltarselo.
ALTER TABLE "PublicListing"
  ADD CONSTRAINT "PublicListing_needs_authorization"
  CHECK (
    "status" = 'draft'
    OR ("authorizedBy" IS NOT NULL AND "authorizedAt" IS NOT NULL
        AND "authorizationText" IS NOT NULL AND length(btrim("authorizationText")) > 0)
  );

-- Quien participo, y con que papel.
CREATE TABLE "PublicListingProvider" (
  "id"         TEXT NOT NULL,
  "listingId"  TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "role"       TEXT NOT NULL,
  -- Un salon puede no querer salir en la boda de otro. Hasta que lo confirme, no
  -- aparece.
  "approvedByProvider" BOOLEAN NOT NULL DEFAULT false,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PublicListingProvider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicListingProvider_listing_provider_key"
  ON "PublicListingProvider"("listingId", "providerId");
CREATE INDEX "PublicListingProvider_providerId_idx" ON "PublicListingProvider"("providerId");

ALTER TABLE "PublicListingProvider"
  ADD CONSTRAINT "PublicListingProvider_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "PublicListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PublicListingProvider"
  ADD CONSTRAINT "PublicListingProvider_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
