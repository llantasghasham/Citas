-- El histórico de mensajes sobrevive a que se quite el número.
--
-- `WhatsappMessage.connectionId` era NOT NULL con la clave foránea en CASCADE,
-- así que quitar un número de WhatsApp borraba todos los mensajes que habían
-- salido por él. Y quitar un número es lo NORMAL: a un número lo cierran y la
-- oficina conecta otro. Esa oficina perdía de golpe el registro entero de a
-- quién le había escrito y cuándo — que es exactamente lo que se mira cuando
-- alguien pregunta si a un invitado le llegó su invitación.
--
-- Contradecía además la regla que el propio modelo ya aplicaba al evento y al
-- invitado: borrarlos deja el mensaje con el campo a nulo, no lo borra, porque
-- el mensaje es el REGISTRO de lo que se mandó.
--
-- `NoAction` y no `SET NULL`: sobre una clave compuesta, `SET NULL` pondría a
-- nulo TODAS sus columnas, y `tenantId` no lo admite. Se desata a mano al quitar
-- el número, dentro de la misma transacción.

ALTER TABLE "WhatsappMessage" DROP CONSTRAINT "WhatsappMessage_connectionId_tenantId_fkey";
ALTER TABLE "WhatsappMessage" ALTER COLUMN "connectionId" DROP NOT NULL;
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_connectionId_tenantId_fkey"
    FOREIGN KEY ("connectionId", "tenantId") REFERENCES "WhatsappConnection"("id", "tenantId")
    ON DELETE NO ACTION ON UPDATE CASCADE
    DEFERRABLE INITIALLY DEFERRED;

-- Y la otra mitad, que es la trampa que este proyecto ya pisó dos veces: al
-- dejar de ser CASCADE, borrar una OFICINA pasaba a fallar. La cascada se lleva
-- sus conexiones, y los mensajes seguían apuntando a ellas sin que nada los
-- borrara — ni aun difiriendo la comprobación, porque diferir solo ayuda cuando
-- las filas que apuntan se borran también en la misma orden.
--
-- Así que el mensaje cuelga TAMBIÉN de su oficina, directamente. Quitar un
-- número deja el mensaje (es el registro); cerrar la oficina se lo lleva (ya no
-- hay a quién rendirle cuentas). Prisma no sabe declarar una clave foránea sobre
-- una columna que ya usan dos compuestas, así que vive aquí, como las diferidas.
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
