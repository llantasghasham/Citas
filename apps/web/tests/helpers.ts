import { randomBytes } from 'node:crypto';
import { after, before } from 'node:test';

import { controlDb } from '../src/lib/db/client';

/**
 * Lo común a las pruebas que tocan la base.
 *
 * Se ejecutan contra PostgreSQL DE VERDAD y no contra un doble, a propósito:
 * casi todo lo que se prueba aquí —bloqueos de fila, `SKIP LOCKED`, índices
 * únicos parciales, claves foráneas compuestas— lo hace la base, no el código.
 * Un doble que no las implemente daría verde a los mismos fallos que estas
 * pruebas existen para atrapar.
 *
 * Sin `DATABASE_URL` no fallan: se saltan. Alguien que solo mira el código no
 * tiene por qué levantar una base para comprobar que compila.
 *
 * Los archivos se ejecutan EN SERIE (`--test-concurrency=1`). Comparten una
 * sola base y cada uno la deja limpia al empezar: en paralelo se pisan entre
 * ellos y lo que falla no es el código sino quién llegó antes.
 */
export const HAS_DB = (process.env['DATABASE_URL'] ?? '').length > 0;

/**
 * La llave de cifrado, para la suite y solo para la suite.
 *
 * Hay pruebas que firman o cifran —el código de la puerta, la sesión de
 * WhatsApp, las contraseñas de servicio— y sin llave revientan con «No
 * encryption key», que es lo CORRECTO en producción: la llave vive fuera de la
 * base y no puede haber un valor de respaldo, porque un respaldo lo tendría
 * todo el mundo.
 *
 * En una suite, en cambio, esa misma excepción son veinte fallos rojos que no
 * dicen «te falta una variable» sino que parecen código roto — y quien los mira
 * se pone a buscar en el sitio equivocado. Así que aquí se acuña una llave AL
 * VUELO, distinta en cada ejecución y que no se guarda en ningún sitio: no
 * puede descifrar nada de nadie, y firmar con ella y comprobar con ella dentro
 * del mismo proceso es exactamente lo que estas pruebas necesitan.
 *
 * Si el entorno trae una, manda la del entorno: correr la suite contra la
 * llave de verdad tiene que seguir siendo posible.
 */
if (
  (process.env['CITAS_SECRET_KEY'] ?? '').length === 0 &&
  (process.env['CITAS_SECRET_KEY_FILE'] ?? '').length === 0
) {
  process.env['CITAS_SECRET_KEY'] = randomBytes(32).toString('base64');
}

/**
 * Y lo mismo con el token que comparten la web y el servicio de WhatsApp.
 *
 * La cola se prueba entera —reclamar con `SKIP LOCKED`, el cupo diario, el
 * arriendo— y nada de eso sale del proceso: ninguna prueba llama al servicio.
 * Pero el módulo se niega a cargarse sin el token, con razón: un servicio que
 * arranca sin él es un servicio que manda desde el WhatsApp de un cliente sin
 * pedirle nada a nadie. En la suite eso eran nueve fallos rojos que decían
 * «falta una variable» en un sitio donde nadie la busca.
 */
if ((process.env['WHATSAPP_GATEWAY_TOKEN'] ?? '').length === 0) {
  process.env['WHATSAPP_GATEWAY_TOKEN'] = randomBytes(24).toString('hex');
}

/**
 * Y si no la hay, se DICE, en grande.
 *
 * Saltarse una prueba en silencio es peor que no tenerla: quien ejecuta la
 * suite ve «0 fallos» y se queda tranquilo, sin enterarse de que lo que de
 * verdad protege el dinero y el aislamiento entre oficinas no llegó a correr.
 * Ya pasó: un informe externo contó sesenta y seis pruebas donde hay ciento y
 * pico, y la diferencia era exactamente esto.
 */
if (!HAS_DB) {
  console.error(
    '\n' +
      '  ╭──────────────────────────────────────────────────────────────────╮\n' +
      '  │  SIN DATABASE_URL                                                │\n' +
      '  │                                                                  │\n' +
      '  │  Las pruebas que tocan PostgreSQL NO se han ejecutado: el cobro,  │\n' +
      '  │  el aislamiento entre oficinas, la cola de WhatsApp, las mesas    │\n' +
      '  │  y el acceso. Lo que corre sin base es una PARTE.                 │\n' +
      '  │                                                                  │\n' +
      '  │  Para ejecutarlas todas:                                         │\n' +
      '  │    DATABASE_URL=postgresql://... npm test --workspace @citas/web  │\n' +
      '  ╰──────────────────────────────────────────────────────────────────╯\n',
  );
}

export interface Fixture {
  tenantId: string;
  otherTenantId: string;
  userId: string;
}

/** Deja la base como estaba antes de cada archivo, y al terminar. */
export async function clean(): Promise<void> {
  const prisma = controlDb();
  await prisma.whatsappMessage.deleteMany({});
  await prisma.whatsappConnection.deleteMany({});
  await prisma.sinpeMovement.deleteMany({});
  await prisma.sinpeAccount.deleteMany({});
  await prisma.paymentEvent.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.rsvp.deleteMany({});
  // Levantar antes de quitar las mesas: la clave foránea de `Guest` lleva el
  // evento dentro y no admite que quede alguien apuntando a una mesa borrada.
  await prisma.guest.updateMany({ where: { tableId: { not: null } }, data: { tableId: null } });
  await prisma.table.deleteMany({});
  await prisma.guest.deleteMany({ where: { token: { startsWith: 'test-' } } });
  await prisma.event.deleteMany({ where: { venueName: { startsWith: 'Prueba' } } });
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'order.' } } });
  // El directorio: se va entero, y con él sus membresías, traducciones,
  // categorías, contactos, imágenes y denuncias por la cascada. Va ANTES de los
  // usuarios porque una membresía cuelga de los dos.
  await prisma.provider.deleteMany({});
  await prisma.user.deleteMany({ where: { email: { startsWith: 'prueba-' } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: 'prov-' } } });
  await prisma.tenant.deleteMany({ where: { subdomain: { startsWith: 'prueba-' } } });
}

export function withDatabase(): { get: () => Fixture } {
  let fixture: Fixture;

  before(async () => {
    await clean();
    const prisma = controlDb();
    const tenant = await prisma.tenant.findFirstOrThrow({
      where: { isRoot: true },
      select: { id: true },
    });
    const user = await prisma.user.findFirstOrThrow({
      where: { isSuperadmin: true },
      select: { id: true },
    });
    const other = await prisma.tenant.create({
      data: { name: 'Otra oficina', subdomain: 'prueba-b', slug: 'prueba-b' },
    });
    fixture = { tenantId: tenant.id, otherTenantId: other.id, userId: user.id };
  });

  after(async () => {
    await clean();
    await controlDb().$disconnect();
  });

  return { get: () => fixture };
}

/** Un evento de prueba, con los invitados que se le pidan. */
export async function makeEvent(
  tenantId: string,
  guests: { name: string; phone: string | null }[] = [],
  daysAway = 30,
): Promise<string> {
  const event = await controlDb().event.create({
    data: {
      tenantId,
      type: 'wedding',
      channel: 'self_service',
      date: new Date(Date.now() + daysAway * 86400000).toISOString().slice(0, 10),
      time: '19:00',
      timezone: 'Asia/Beirut',
      venueName: 'Prueba',
      venueAddress: 'Beirut',
      venueMapUrl: 'https://maps.example',
      guests: {
        create: guests.map((guest, index) => ({
          name: guest.name,
          phone: guest.phone,
          locale: 'ar' as const,
          token: `test-${Date.now()}-${index}`,
        })),
      },
    },
    select: { id: true },
  });
  return event.id;
}
