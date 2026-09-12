-- El directorio: los proveedores, sus traducciones, quién los administra, sus
-- categorías, sus contactos, sus imágenes y su moderación.
--
-- Todo en el plano de CONTROL. Y ninguna clave foránea hacia lo privado de una
-- boda: ni `Guest`, ni `Rsvp`, ni `GuestPreference`, ni `CheckIn`, ni `Table`,
-- ni `GuestActRsvp`. `db:check` lo comprueba contra `pg_constraint`, no a ojo.

CREATE TYPE "ProviderStatus" AS ENUM ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'archived');
CREATE TYPE "ProviderRole" AS ENUM ('PROVIDER_ADMIN', 'PROVIDER_EDITOR');
CREATE TYPE "Governorate" AS ENUM ('beirut', 'mount_lebanon', 'north', 'akkar', 'bekaa', 'baalbek_hermel', 'south', 'nabatieh');
CREATE TYPE "MediaKind" AS ENUM ('image', 'video');
CREATE TYPE "MediaStatus" AS ENUM ('pending_review', 'approved', 'rejected', 'hidden');
CREATE TYPE "MediaHiddenReason" AS ENUM ('copyright', 'moderation', 'provider');
CREATE TYPE "ReportReason" AS ENUM ('false_info', 'scam', 'offensive', 'wrong_number', 'closed', 'copyright');
CREATE TYPE "ReportStatus" AS ENUM ('new', 'reviewing', 'upheld', 'dismissed');

CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "rejectedNote" TEXT,
    "publishedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "governorate" "Governorate" NOT NULL,
    "district" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "addressPublic" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "capacity" INTEGER,
    "since" INTEGER,
    "priceFrom" INTEGER,
    "priceCurrency" "Currency",
    "mainLocale" TEXT NOT NULL DEFAULT 'ar',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Provider_slug_key" ON "Provider"("slug");
CREATE INDEX "Provider_status_publishedAt_idx" ON "Provider"("status", "publishedAt");
CREATE INDEX "Provider_governorate_district_status_idx" ON "Provider"("governorate", "district", "status");

-- El mapa sin dirección pública no existe: los dos van juntos, y es la base
-- quien lo impide. Publicar por descuido las coordenadas de la casa de quien
-- hace pasteles desde su cocina no se arregla después.
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_map_needs_address"
    CHECK (("lat" IS NULL AND "lng" IS NULL) OR "addressPublic" IS NOT NULL);

CREATE TABLE "ProviderTranslation" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "services" TEXT[],
    CONSTRAINT "ProviderTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderTranslation_providerId_locale_key" ON "ProviderTranslation"("providerId", "locale");

CREATE TABLE "ProviderMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "role" "ProviderRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderMembership_userId_providerId_key" ON "ProviderMembership"("userId", "providerId");
CREATE INDEX "ProviderMembership_providerId_role_idx" ON "ProviderMembership"("providerId", "role");

CREATE TABLE "ProviderCategoryLink" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ProviderCategoryLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderCategoryLink_providerId_category_key" ON "ProviderCategoryLink"("providerId", "category");
CREATE INDEX "ProviderCategoryLink_category_providerId_idx" ON "ProviderCategoryLink"("category", "providerId");

-- UNA categoría principal por proveedor, y lo impide la BASE. Con dos, el
-- listado lo enseñaría dos veces y nadie sabría en cuál de las dos buscarlo.
CREATE UNIQUE INDEX "ProviderCategoryLink_one_primary"
    ON "ProviderCategoryLink"("providerId") WHERE "isPrimary";

CREATE TABLE "ProviderContact" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    CONSTRAINT "ProviderContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderContact_providerId_channel_key" ON "ProviderContact"("providerId", "channel");

CREATE TABLE "ProviderMedia" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL DEFAULT 'image',
    "objectKey" TEXT,
    "thumbKey" TEXT,
    "externalUrl" TEXT,
    "mimeType" TEXT,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "altText" TEXT,
    "status" "MediaStatus" NOT NULL DEFAULT 'pending_review',
    "hiddenReason" "MediaHiddenReason",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    CONSTRAINT "ProviderMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderMedia_objectKey_key" ON "ProviderMedia"("objectKey");
CREATE UNIQUE INDEX "ProviderMedia_thumbKey_key" ON "ProviderMedia"("thumbKey");
CREATE INDEX "ProviderMedia_providerId_sortOrder_idx" ON "ProviderMedia"("providerId", "sortOrder");
CREATE INDEX "ProviderMedia_status_createdAt_idx" ON "ProviderMedia"("status", "createdAt");

-- Una imagen tiene llave; un vídeo tiene dirección. Nunca las dos, nunca
-- ninguna. Una fila a medias es un hueco roto en el perfil de alguien.
ALTER TABLE "ProviderMedia" ADD CONSTRAINT "ProviderMedia_image_or_video"
    CHECK (
      ("kind" = 'image' AND "objectKey" IS NOT NULL AND "externalUrl" IS NULL)
      OR
      ("kind" = 'video' AND "externalUrl" IS NOT NULL AND "objectKey" IS NULL)
    );

-- Y oculta sin motivo no se puede: `hidden` a secas no dice si fue una
-- reclamación de derechos sin resolver o si la escondió el propio proveedor, y
-- se resuelven y se notifican distinto.
ALTER TABLE "ProviderMedia" ADD CONSTRAINT "ProviderMedia_hidden_needs_reason"
    CHECK (("status" <> 'hidden') OR "hiddenReason" IS NOT NULL);

CREATE TABLE "ProviderReview" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "mediaId" TEXT,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderReview_providerId_createdAt_idx" ON "ProviderReview"("providerId", "createdAt");

CREATE TABLE "ProviderReport" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "mediaId" TEXT,
    "reason" "ReportReason" NOT NULL,
    "message" TEXT,
    "reporterEmail" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'new',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderReport_providerId_status_createdAt_idx" ON "ProviderReport"("providerId", "status", "createdAt");
CREATE INDEX "ProviderReport_status_createdAt_idx" ON "ProviderReport"("status", "createdAt");

-- Una reclamación de derechos SIN correo de quien la pone no entra. Sin alguien
-- a quien responder no hay reclamación: hay un botón para tumbar las fotos de un
-- competidor desde un formulario anónimo.
ALTER TABLE "ProviderReport" ADD CONSTRAINT "ProviderReport_copyright_needs_email"
    CHECK ("reason" <> 'copyright' OR "reporterEmail" IS NOT NULL);

-- ---------------------------------------------------------- la sesión, y su ámbito

ALTER TABLE "Session" ADD COLUMN "providerId" TEXT;
CREATE INDEX "Session_providerId_idx" ON "Session"("providerId");

-- Una sesión es de una oficina, de un proveedor, o de ninguna de las dos (el
-- superadministrador). NUNCA de las dos a la vez.
--
-- Esto no es una comprobación de más: es lo único que impide que quien
-- administra un salón y además trabaja en una oficina acabe con una sesión que
-- vale para los dos sitios, y con ella leyendo la lista de invitados de una boda
-- desde el panel de su negocio.
ALTER TABLE "Session" ADD CONSTRAINT "Session_one_scope"
    CHECK ("tenantId" IS NULL OR "providerId" IS NULL);

-- ---------------------------------------------------------------- claves foráneas

ALTER TABLE "ProviderTranslation" ADD CONSTRAINT "ProviderTranslation_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderMembership" ADD CONSTRAINT "ProviderMembership_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderMembership" ADD CONSTRAINT "ProviderMembership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderCategoryLink" ADD CONSTRAINT "ProviderCategoryLink_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderContact" ADD CONSTRAINT "ProviderContact_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderMedia" ADD CONSTRAINT "ProviderMedia_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderReview" ADD CONSTRAINT "ProviderReview_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderReport" ADD CONSTRAINT "ProviderReport_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Borrar un proveedor cierra sus sesiones, como borrar una oficina cierra las
-- suyas.
ALTER TABLE "Session" ADD CONSTRAINT "Session_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
