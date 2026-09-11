-- Comprobar el certificado del servidor de correo.
--
-- Encendido por defecto y a propósito: apagarlo deja que alguien en medio lea
-- la contraseña del buzón y todo el correo. Existe solo porque hay servidores
-- con certificado propio donde la conexión falla por eso y no por otra cosa.
ALTER TABLE "SinpeAccount" ADD COLUMN "verifyCertificate" BOOLEAN NOT NULL DEFAULT true;
