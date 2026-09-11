import { after, before } from 'node:test';

import { getPrisma } from '../src/lib/db/client';

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

export interface Fixture {
  tenantId: string;
  otherTenantId: string;
  userId: string;
}

/** Deja la base como estaba antes de cada archivo, y al terminar. */
export async function clean(): Promise<void> {
  const prisma = getPrisma();
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
  await prisma.tenant.deleteMany({ where: { subdomain: { startsWith: 'prueba-' } } });
}

export function withDatabase(): { get: () => Fixture } {
  let fixture: Fixture;

  before(async () => {
    await clean();
    const prisma = getPrisma();
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
    await getPrisma().$disconnect();
  });

  return { get: () => fixture };
}

/** Un evento de prueba, con los invitados que se le pidan. */
export async function makeEvent(
  tenantId: string,
  guests: { name: string; phone: string | null }[] = [],
  daysAway = 30,
): Promise<string> {
  const event = await getPrisma().event.create({
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
