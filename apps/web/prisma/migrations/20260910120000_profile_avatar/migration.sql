-- Perfil completo: la foto como ARCHIVO subido y la zona horaria de cada persona.
--
-- Los bytes viven aqui y no en el disco por la misma razon que la tabla
-- "Render": un despliegue copia el codigo y se lleva por delante cualquier
-- archivo que se hubiera dejado al lado.
ALTER TABLE "User" ADD COLUMN "avatarData" BYTEA;
ALTER TABLE "User" ADD COLUMN "avatarType" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarVersion" TEXT;
ALTER TABLE "User" ADD COLUMN "timezone" TEXT;
