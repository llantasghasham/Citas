-- El tope de diez imágenes por proveedor, impedido por la BASE.
--
-- Estaba escrito en el código: contar dentro de una transacción con la fila del
-- proveedor bloqueada. Y la prueba que decía comprobarlo pasaba IGUAL con el
-- bloqueo quitado — así que no probaba nada, y lo único que sostenía el tope era
-- que Prisma resulta que serializa esas transacciones hoy. Eso no es una
-- garantía: es una casualidad de una versión.
--
-- Un tope de diez filas no lo expresa un índice único... salvo que se le dé un
-- NÚMERO a cada hueco. Eso es lo que hace `slot`: cada imagen ocupa uno del cero
-- al nueve, único por proveedor. La undécima no tiene dónde ponerse, y dos
-- subidas simultáneas que eligieran el mismo hueco chocan contra el índice —
-- una gana, la otra reintenta y, si no queda ninguno, se le dice que no caben.
--
-- `slot` NO es el orden en que se ven. Son dos cosas y por eso son dos columnas:
-- `sortOrder` se INTERCAMBIA al subir y bajar una foto, y con un índice único
-- encima ese intercambio tendría que pasar por un valor temporal para no chocar
-- consigo mismo — la misma razón por la que el `order` de un acto no lo lleva.
-- Un hueco, en cambio, no se reordena nunca: se ocupa y se suelta.

ALTER TABLE "ProviderMedia" ADD COLUMN "slot" INTEGER;

-- Lo que ya existiera se coloca en huecos, por antigüedad. Hoy no hay nada en
-- producción, pero una migración que solo funciona con la tabla vacía es una
-- migración que falla la primera vez que se aplica de verdad.
WITH numeradas AS (
  SELECT "id",
         row_number() OVER (PARTITION BY "providerId" ORDER BY "sortOrder", "createdAt") - 1 AS n
    FROM "ProviderMedia"
   WHERE "kind" = 'image'
)
UPDATE "ProviderMedia" m
   SET "slot" = numeradas.n
  FROM numeradas
 WHERE m."id" = numeradas."id"
   AND numeradas.n < 10;

-- Lo que no cupiera (no debería haber nada) se va: una fila de imagen sin hueco
-- no podría existir bajo la restricción de abajo.
DELETE FROM "ProviderMedia" WHERE "kind" = 'image' AND "slot" IS NULL;

-- Una imagen ocupa un hueco del 0 al 9; un vídeo no ocupa ninguno.
ALTER TABLE "ProviderMedia"
  ADD CONSTRAINT "ProviderMedia_slot_shape"
  CHECK (
    ("kind" = 'image' AND "slot" IS NOT NULL AND "slot" >= 0 AND "slot" < 10)
    OR ("kind" = 'video' AND "slot" IS NULL)
  );

-- Y el hueco es de UNO. Esto es el tope.
CREATE UNIQUE INDEX "ProviderMedia_slot_key"
  ON "ProviderMedia" ("providerId", "slot")
  WHERE "kind" = 'image';
