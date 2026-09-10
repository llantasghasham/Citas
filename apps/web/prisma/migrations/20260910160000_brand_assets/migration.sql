-- El logo y el icono de la pestana, subidos en vez de pegados como direccion.
--
-- Los bytes viven aqui y no en el disco por la misma razon que "Render" y que
-- la foto de perfil: un despliegue copia el codigo y se lleva por delante lo
-- que se hubiera dejado al lado.
CREATE TABLE "BrandAsset" (
  "kind" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "type" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "BrandAsset_pkey" PRIMARY KEY ("kind")
);
