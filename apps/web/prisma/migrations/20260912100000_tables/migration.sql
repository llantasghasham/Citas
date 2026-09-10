-- Las mesas del salón, y en cuál se sienta cada invitado.

CREATE TABLE "Table" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 10,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- Con el evento dentro, para que la clave foránea de Guest pueda apuntar aquí
-- y la base impida sentar a alguien en la mesa de otra boda.
CREATE UNIQUE INDEX "Table_id_eventId_key" ON "Table"("id", "eventId");
-- Dos «Mesa 1» en la misma boda es un error de dedo.
CREATE UNIQUE INDEX "Table_eventId_name_key" ON "Table"("eventId", "name");
CREATE INDEX "Table_eventId_position_idx" ON "Table"("eventId", "position");

ALTER TABLE "Table"
    ADD CONSTRAINT "Table_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Guest" ADD COLUMN "tableId" TEXT;
CREATE INDEX "Guest_tableId_idx" ON "Guest"("tableId");

-- La clave lleva el evento DENTRO: así la base impide sentar a un invitado en
-- la mesa de otra boda, no solo el código.
--
-- `NO ACTION` y no `SET NULL`: `SET NULL` sobre una clave compuesta pone a nulo
-- TODAS sus columnas, y `eventId` no admite nulo — quitar una mesa reventaba.
-- (`SET NULL ("tableId")` existe desde PostgreSQL 15, pero atar el proyecto a
-- esa versión por una comodidad no compensa.) Así que al quitar una mesa se
-- levanta primero a quien esté en ella, en la misma transacción, y esta clave
-- es la red que avisa si alguien se lo salta.
--
-- `NO ACTION` y no `RESTRICT`: se comprueba al FINAL de la orden, y por eso
-- borrar un evento sigue funcionando — sus mesas y sus invitados se van en la
-- misma orden. `RESTRICT` comprueba fila a fila y lo habría impedido.
ALTER TABLE "Guest"
    ADD CONSTRAINT "Guest_tableId_eventId_fkey"
    FOREIGN KEY ("tableId", "eventId") REFERENCES "Table"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;
