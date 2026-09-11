import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { getPrisma } from '../src/lib/db/client';
import { tenantScope } from '../src/lib/db/tenant';
import { cancelScheduled, listFailed, queueEventInvitations, retryFailed } from '../src/lib/whatsapp/connections';
import { queueDueReminders } from '../src/lib/whatsapp/reminders';
import { claimNext, markFailed, markSent, reclaimExpired } from '../../whatsapp/src/db';

import { HAS_DB, makeEvent, withDatabase } from './helpers';

/**
 * La cola de WhatsApp. Todo lo de aquí es concurrencia, así que va contra
 * PostgreSQL de verdad: lo que se prueba lo hace la base.
 */
describe('la cola de WhatsApp', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  const day = new Date().toISOString().slice(0, 10);

  // Cada prueba empieza con la cola vacía. Sin esto, las filas de una se cuelan
  // en la siguiente y lo que falla no es el código sino el orden de ejecución.
  beforeEach(async () => {
    await getPrisma().whatsappMessage.deleteMany({});
    await getPrisma().whatsappConnection.deleteMany({});
  });

  const connection = async (cap = 200): Promise<string> => {
    const row = await getPrisma().whatsappConnection.create({
      data: {
        tenantId: fixture.get().tenantId,
        name: `N-${Math.random().toString(36).slice(2, 8)}`,
        status: 'connected',
        dailyCap: cap,
        sentToday: 0,
        sentDay: day,
      },
    });
    return row.id;
  };

  const queue = async (connectionId: string, count: number, extra = {}): Promise<void> => {
    await getPrisma().whatsappMessage.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        tenantId: fixture.get().tenantId,
        connectionId,
        toPhone: `+9617000${String(i).padStart(4, '0')}`,
        body: `mensaje ${i}`,
        ...extra,
      })),
    });
  };

  it('dos repartidores sobre una sola fila: se la lleva uno', async () => {
    const id = await connection();
    await queue(id, 1);

    const both = await Promise.all([
      claimNext(id, 'worker-A', day, 200),
      claimNext(id, 'worker-B', day, 200),
    ]);
    assert.equal(both.filter((m) => m !== undefined).length, 1);
    assert.equal((await getPrisma().whatsappMessage.findFirstOrThrow()).status, 'processing');
  });

  it('el tope diario se respeta aunque todos lo pidan a la vez', async () => {
    const id = await connection(3);
    await queue(id, 8);

    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, i) => claimNext(id, `w${i}`, day, 3)),
    );
    assert.equal(claims.filter((m) => m !== undefined).length, 3);
    const row = await getPrisma().whatsappConnection.findUniqueOrThrow({ where: { id } });
    assert.equal(row.sentToday, 3);
  });

  it('una cola vacía no gasta el cupo del día a base de mirarla', async () => {
    const id = await connection(5);
    assert.equal(await claimNext(id, 'w', day, 5), undefined);
    const row = await getPrisma().whatsappConnection.findUniqueOrThrow({ where: { id } });
    assert.equal(row.sentToday, 0);
  });

  it('morir a mitad deja el mensaje EN DUDA, no lo reenvía', async () => {
    const id = await connection();
    await queue(id, 1);
    const claimed = await claimNext(id, 'el-que-se-muere', day, 200);
    assert.ok(claimed !== undefined);

    // El proceso murió: el arriendo vence sin que nadie suelte la fila.
    await getPrisma().whatsappMessage.updateMany({
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    assert.equal(await reclaimExpired(), 1);

    const row = await getPrisma().whatsappMessage.findFirstOrThrow();
    assert.equal(row.status, 'sent_unknown');
    assert.equal(await claimNext(id, 'otro', day, 200), undefined, 'no se vuelve a coger');
  });

  it('solo escribe el resultado quien tiene el arriendo', async () => {
    const id = await connection();
    await queue(id, 1);
    const mine = await claimNext(id, 'dueño', day, 200);
    assert.ok(mine !== undefined);

    assert.equal(await markSent(mine.id, 'intruso', null), false);
    assert.equal(await markSent(mine.id, 'dueño', 'WA-123'), true);
    const row = await getPrisma().whatsappMessage.findFirstOrThrow();
    assert.equal(row.providerMessageId, 'WA-123');
  });

  it('un fallo devuelve el hueco del cupo', async () => {
    const id = await connection();
    await queue(id, 1);
    const mine = await claimNext(id, 'w', day, 200);
    assert.ok(mine !== undefined);
    assert.equal((await getPrisma().whatsappConnection.findUniqueOrThrow({ where: { id } })).sentToday, 1);

    await markFailed(mine.id, 'w', id, day, 'no tiene WhatsApp');
    assert.equal((await getPrisma().whatsappConnection.findUniqueOrThrow({ where: { id } })).sentToday, 0);
  });

  it('cancelar no toca lo que ya está saliendo, y no borra el rastro', async () => {
    const id = await connection();
    const eventId = await makeEvent(fixture.get().tenantId);
    const later = new Date(Date.now() + 2 * 3600 * 1000);
    await queue(id, 2, { eventId, scheduledAt: later });
    await queue(id, 1, {
      eventId,
      scheduledAt: later,
      status: 'processing',
      claimedBy: 'w',
      leaseUntil: new Date(Date.now() + 60000),
    });

    const cancelled = await cancelScheduled(tenantScope(fixture.get().tenantId), eventId, fixture.get().userId);
    assert.equal(cancelled, 2);
    assert.equal(await getPrisma().whatsappMessage.count(), 3, 'se marca, no se borra');
    assert.equal(await getPrisma().whatsappMessage.count({ where: { status: 'processing' } }), 1);
  });

  it('lo dudoso sale en la pantalla y se puede reintentar', async () => {
    const id = await connection();
    const eventId = await makeEvent(fixture.get().tenantId);
    await queue(id, 1, { eventId, status: 'sent_unknown', error: 'se cayó a mitad' });
    await queue(id, 1, { eventId, status: 'failed', error: 'no tiene WhatsApp', tries: 3 });

    const failed = await listFailed(tenantScope(fixture.get().tenantId), eventId);
    assert.equal(failed.length, 2);
    assert.ok(failed.some((f) => f.status === 'sent_unknown'));

    assert.equal(await retryFailed(tenantScope(fixture.get().tenantId), eventId, fixture.get().userId), 2);
    assert.equal(await getPrisma().whatsappMessage.count({ where: { status: 'queued' } }), 2);
  });
});

describe('los recordatorios', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  beforeEach(async () => {
    const prisma = getPrisma();
    await prisma.whatsappMessage.deleteMany({});
    await prisma.whatsappConnection.deleteMany({});
    await prisma.rsvp.deleteMany({});
    await prisma.guest.deleteMany({ where: { token: { startsWith: 'test-' } } });
    await prisma.event.deleteMany({ where: { venueName: { startsWith: 'Prueba' } } });
  });

  it('dos repasos a la vez no escriben dos veces al mismo invitado', async () => {
    const prisma = getPrisma();
    await prisma.setting.upsert({
      where: { key: 'NEXT_PUBLIC_SITE_URL' },
      update: { value: 'https://citas.posxml.com' },
      create: { key: 'NEXT_PUBLIC_SITE_URL', value: 'https://citas.posxml.com' },
    });
    await prisma.whatsappConnection.create({
      data: { tenantId: fixture.get().tenantId, name: 'R', status: 'connected', isDefault: true },
    });
    const eventId = await makeEvent(
      fixture.get().tenantId,
      Array.from({ length: 12 }, (_, i) => ({ name: `Inv ${i}`, phone: `+9617020${String(i).padStart(4, '0')}` })),
      2,
    );
    await prisma.event.update({ where: { id: eventId }, data: { reminderDaysBefore: 3 } });

    const [a, b] = await Promise.all([queueDueReminders(), queueDueReminders()]);
    assert.equal(a.queued + b.queued, 12);

    const perGuest = await prisma.whatsappMessage.groupBy({ by: ['guestId'], _count: { _all: true } });
    assert.deepEqual(perGuest.filter((g) => g._count._all > 1), []);
    await prisma.setting.deleteMany({ where: { key: 'NEXT_PUBLIC_SITE_URL' } });
  });

  it('no se le escribe a quien ya contestó', async () => {
    const prisma = getPrisma();
    await prisma.setting.upsert({
      where: { key: 'NEXT_PUBLIC_SITE_URL' },
      update: { value: 'https://citas.posxml.com' },
      create: { key: 'NEXT_PUBLIC_SITE_URL', value: 'https://citas.posxml.com' },
    });
    await prisma.whatsappConnection.create({
      data: { tenantId: fixture.get().tenantId, name: 'R2', status: 'connected', isDefault: true },
    });
    const eventId = await makeEvent(
      fixture.get().tenantId,
      Array.from({ length: 10 }, (_, i) => ({ name: `G ${i}`, phone: `+9617030${String(i).padStart(4, '0')}` })),
      2,
    );
    await prisma.event.update({ where: { id: eventId }, data: { reminderDaysBefore: 3 } });

    const answered = await prisma.guest.findMany({ where: { eventId }, take: 4, select: { id: true } });
    for (const guest of answered) {
      await prisma.rsvp.create({ data: { guestId: guest.id, status: 'attending', party: 1 } });
    }

    assert.equal((await queueDueReminders()).queued, 6);
    await prisma.setting.deleteMany({ where: { key: 'NEXT_PUBLIC_SITE_URL' } });
  });

  it('sin número conectado no marca a nadie: se reintenta después', async () => {
    const prisma = getPrisma();
    await prisma.setting.upsert({
      where: { key: 'NEXT_PUBLIC_SITE_URL' },
      update: { value: 'https://citas.posxml.com' },
      create: { key: 'NEXT_PUBLIC_SITE_URL', value: 'https://citas.posxml.com' },
    });
    const eventId = await makeEvent(
      fixture.get().tenantId,
      [{ name: 'Solo', phone: '+96170409999' }],
      2,
    );
    await prisma.event.update({ where: { id: eventId }, data: { reminderDaysBefore: 3 } });

    assert.equal((await queueDueReminders()).queued, 0);
    assert.equal(await prisma.guest.count({ where: { eventId, remindedAt: { not: null } } }), 0);
    await prisma.setting.deleteMany({ where: { key: 'NEXT_PUBLIC_SITE_URL' } });
  });
});

/**
 * Encolar dos veces a la vez.
 *
 * Llegó por un informe externo y era cierto: el código lee qué hay ya en cola y
 * luego escribe, y entre las dos cosas cabe otra petición. Dos operadores
 * pulsando «Enviar» a la vez y cada invitado recibía DOS mensajes.
 */
describe('encolar sin duplicar', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  beforeEach(async () => {
    await getPrisma().whatsappMessage.deleteMany({});
    await getPrisma().whatsappConnection.deleteMany({});
  });

  it('dos «Enviar» a la vez encolan UNA sola vez a cada invitado', async () => {
    const prisma = getPrisma();
    const tenantId = fixture.get().tenantId;
    const eventId = await makeEvent(tenantId, [
      { name: 'Ana', phone: '+96170111111' },
      { name: 'Beto', phone: '+96170222222' },
    ]);
    const conexion = await prisma.whatsappConnection.create({
      data: { tenantId, name: `N-${Math.random().toString(36).slice(2, 8)}`, status: 'connected' },
      select: { id: true },
    });
    const scope = tenantScope(tenantId);
    const mensaje = (): string => 'hola';

    const [uno, dos] = await Promise.all([
      queueEventInvitations(scope, eventId, conexion.id, mensaje, fixture.get().userId),
      queueEventInvitations(scope, eventId, conexion.id, mensaje, fixture.get().userId),
    ]);

    const filas = await prisma.whatsappMessage.findMany({ where: { eventId } });
    assert.equal(filas.length, 2, 'dos invitados, dos mensajes');

    // Y el recuento que se devuelve es el que de VERDAD se escribió: decirle a
    // quien pulsó el botón que se encolaron doscientos cuando se encolaron cero
    // sería mentirle.
    const total =
      ('queued' in uno ? uno.queued : 0) + ('queued' in dos ? dos.queued : 0);
    assert.equal(total, 2);
  });

  it('el recordatorio SÍ cabe junto a la invitación', async () => {
    // El mismo invitado recibe los dos. Por eso el índice va por `kind`: sin esa
    // columna, lo que evita el doble envío habría impedido el recordatorio.
    const prisma = getPrisma();
    const tenantId = fixture.get().tenantId;
    const eventId = await makeEvent(tenantId, [{ name: 'Ana', phone: '+96170111111' }]);
    const conexion = await prisma.whatsappConnection.create({
      data: { tenantId, name: `N-${Math.random().toString(36).slice(2, 8)}`, status: 'connected' },
      select: { id: true },
    });
    const invitado = await prisma.guest.findFirstOrThrow({ where: { eventId } });

    const base = {
      tenantId,
      connectionId: conexion.id,
      eventId,
      guestId: invitado.id,
      toPhone: '+96170111111',
      body: 'hola',
      status: 'queued',
    };
    await prisma.whatsappMessage.create({ data: { ...base, kind: 'invitation' } });
    await prisma.whatsappMessage.create({ data: { ...base, kind: 'reminder' } });

    assert.equal(await prisma.whatsappMessage.count({ where: { eventId } }), 2);

    // Pero una segunda invitación en cola, no.
    await assert.rejects(prisma.whatsappMessage.create({ data: { ...base, kind: 'invitation' } }));
  });
});
