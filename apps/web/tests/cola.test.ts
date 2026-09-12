import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type { ActType } from '../src/generated/prisma/enums';
import { controlDb } from '../src/lib/db/client';
import { tenantScope } from '../src/lib/db/tenant';
import {
  cancelScheduled,
  deleteConnection,
  listFailed,
  queueEventInvitations,
  retryFailed,
} from '../src/lib/whatsapp/connections';
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
    await controlDb().whatsappMessage.deleteMany({});
    await controlDb().whatsappConnection.deleteMany({});
  });

  const connection = async (cap = 200): Promise<string> => {
    const row = await controlDb().whatsappConnection.create({
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
    await controlDb().whatsappMessage.createMany({
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
    assert.equal((await controlDb().whatsappMessage.findFirstOrThrow()).status, 'processing');
  });

  it('el tope diario se respeta aunque todos lo pidan a la vez', async () => {
    const id = await connection(3);
    await queue(id, 8);

    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, i) => claimNext(id, `w${i}`, day, 3)),
    );
    assert.equal(claims.filter((m) => m !== undefined).length, 3);
    const row = await controlDb().whatsappConnection.findUniqueOrThrow({ where: { id } });
    assert.equal(row.sentToday, 3);
  });

  it('una cola vacía no gasta el cupo del día a base de mirarla', async () => {
    const id = await connection(5);
    assert.equal(await claimNext(id, 'w', day, 5), undefined);
    const row = await controlDb().whatsappConnection.findUniqueOrThrow({ where: { id } });
    assert.equal(row.sentToday, 0);
  });

  it('morir a mitad deja el mensaje EN DUDA, no lo reenvía', async () => {
    const id = await connection();
    await queue(id, 1);
    const claimed = await claimNext(id, 'el-que-se-muere', day, 200);
    assert.ok(claimed !== undefined);

    // El proceso murió: el arriendo vence sin que nadie suelte la fila.
    await controlDb().whatsappMessage.updateMany({
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    assert.equal(await reclaimExpired(), 1);

    const row = await controlDb().whatsappMessage.findFirstOrThrow();
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
    const row = await controlDb().whatsappMessage.findFirstOrThrow();
    assert.equal(row.providerMessageId, 'WA-123');
  });

  it('un fallo devuelve el hueco del cupo', async () => {
    const id = await connection();
    await queue(id, 1);
    const mine = await claimNext(id, 'w', day, 200);
    assert.ok(mine !== undefined);
    assert.equal((await controlDb().whatsappConnection.findUniqueOrThrow({ where: { id } })).sentToday, 1);

    await markFailed(mine.id, 'w', id, day, 'no tiene WhatsApp');
    assert.equal((await controlDb().whatsappConnection.findUniqueOrThrow({ where: { id } })).sentToday, 0);
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
    assert.equal(await controlDb().whatsappMessage.count(), 3, 'se marca, no se borra');
    assert.equal(await controlDb().whatsappMessage.count({ where: { status: 'processing' } }), 1);
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
    assert.equal(await controlDb().whatsappMessage.count({ where: { status: 'queued' } }), 2);
  });
  /**
   * Quitar un número es lo NORMAL: a un número lo cierran y la oficina conecta
   * otro. Y hasta ahora eso se llevaba por delante el registro entero de a quién
   * se le había escrito — que es justo lo que se mira cuando alguien pregunta si
   * a un invitado le llegó su invitación.
   */
  describe('quitar el número no borra lo que ya se mandó', () => {
    it('lo enviado se queda, sin número, y lo que quedaba en cola se cancela', async () => {
      const scope = tenantScope(fixture.get().tenantId);
      const prisma = controlDb();
      const connectionId = await connection();
      const eventId = await makeEvent(fixture.get().tenantId, [
        { name: 'Rami', phone: '+96170111222' },
        { name: 'Nour', phone: '+96170111333' },
      ]);
      await queueEventInvitations(scope, eventId, connectionId, () => 'hola', fixture.get().userId);

      // Uno sale de verdad; el otro se queda en la cola.
      const claimed = await claimNext(connectionId, 'w1', day, 200);
      assert.ok(claimed !== undefined);
      assert.equal(await markSent(claimed.id, 'w1', 'wamid.1'), true);

      assert.equal(await deleteConnection(scope, connectionId, fixture.get().userId), true);

      // El número se fue.
      assert.equal(await prisma.whatsappConnection.count({ where: { id: connectionId } }), 0);

      // Los mensajes NO. Es el registro de lo que se mandó.
      const quedan = await prisma.whatsappMessage.findMany({
        where: { eventId },
        select: { status: true, connectionId: true, toPhone: true },
        orderBy: { toPhone: 'asc' },
      });
      assert.equal(quedan.length, 2, 'quitar el número se llevó el histórico');
      assert.ok(quedan.every((row) => row.connectionId === null));
      assert.deepEqual(
        quedan.map((row) => row.status).sort(),
        ['canceled', 'sent'],
        'lo enviado tiene que seguir enviado y lo que quedaba en cola, cancelado',
      );
    });

    it('lo que se quedó sin número no se puede reencolar', async () => {
      const scope = tenantScope(fixture.get().tenantId);
      const connectionId = await connection();
      const eventId = await makeEvent(fixture.get().tenantId, [
        { name: 'Rami', phone: '+96170111222' },
      ]);
      await queueEventInvitations(scope, eventId, connectionId, () => 'hola', fixture.get().userId);

      const claimed = await claimNext(connectionId, 'w1', day, 200);
      assert.ok(claimed !== undefined);
      await markFailed(claimed.id, 'w1', connectionId, day, 'se cayó');
      await controlDb().whatsappMessage.updateMany({
        where: { id: claimed.id },
        data: { status: 'failed', tries: 3 },
      });

      assert.equal((await listFailed(scope, eventId)).length, 1);
      await deleteConnection(scope, connectionId, fixture.get().userId);

      // Reencolarlo lo dejaría en la cola para siempre: el repartidor pide
      // trabajo POR conexión, y esa fila ya no cuelga de ninguna.
      assert.equal(await retryFailed(scope, eventId, fixture.get().userId), 0);
      const row = await controlDb().whatsappMessage.findFirst({
        where: { eventId },
        select: { status: true },
      });
      assert.equal(row?.status, 'failed');
    });
  });
});

describe('los recordatorios', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  beforeEach(async () => {
    const prisma = controlDb();
    await prisma.whatsappMessage.deleteMany({});
    await prisma.whatsappConnection.deleteMany({});
    await prisma.rsvp.deleteMany({});
    await prisma.guest.deleteMany({ where: { token: { startsWith: 'test-' } } });
    await prisma.event.deleteMany({ where: { venueName: { startsWith: 'Prueba' } } });
  });

  it('dos repasos a la vez no escriben dos veces al mismo invitado', async () => {
    const prisma = controlDb();
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
    const prisma = controlDb();
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
    const prisma = controlDb();
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
    await controlDb().whatsappMessage.deleteMany({});
    await controlDb().whatsappConnection.deleteMany({});
  });

  it('dos «Enviar» a la vez encolan UNA sola vez a cada invitado', async () => {
    const prisma = controlDb();
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
    const prisma = controlDb();
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

  it('el ACTO entra en la clave, y son DOS índices porque dos nulos no chocan', async () => {
    // Una revisión externa leyó la migración de `queue_no_duplicates` —donde el
    // índice todavía era `(eventId, guestId, kind)`— y avisó de que el mismo
    // invitado no podría recibir la henna Y la recepción. Tenía razón sobre ese
    // índice; lo que no vio es que una migración posterior lo sustituye. Esta
    // prueba existe para que eso se responda con la BASE y no con un archivo:
    // escribe directamente en la tabla, así que quien acepta o rechaza es el
    // índice, no una lectura previa del código.
    const prisma = controlDb();
    const tenantId = fixture.get().tenantId;
    const eventId = await makeEvent(tenantId, [{ name: 'Rami', phone: '+96170222222' }]);
    const conexion = await prisma.whatsappConnection.create({
      data: { tenantId, name: `N-${Math.random().toString(36).slice(2, 8)}`, status: 'connected' },
      select: { id: true },
    });
    const invitado = await prisma.guest.findFirstOrThrow({ where: { eventId } });

    const acto = async (type: ActType, date: string): Promise<string> => {
      const row = await prisma.eventAct.create({
        data: {
          eventId, type, date, time: '20:00', timezone: 'Asia/Beirut',
          venueName: 'Prueba', venueAddress: 'Beirut', venueMapUrl: 'https://m.example',
        },
        select: { id: true },
      });
      return row.id;
    };
    const henna = await acto('henna', '2026-11-13');
    const recepcion = await acto('reception', '2026-11-14');

    const base = {
      tenantId,
      connectionId: conexion.id,
      eventId,
      guestId: invitado.id,
      toPhone: '+96170222222',
      body: 'hola',
      status: 'queued',
      kind: 'invitation',
    };

    // 1. Dos actos distintos, el mismo invitado y el mismo `kind`: los dos pasan.
    await prisma.whatsappMessage.create({ data: { ...base, actId: henna } });
    await prisma.whatsappMessage.create({ data: { ...base, actId: recepcion } });

    // 2. El mismo acto dos veces, no.
    await assert.rejects(prisma.whatsappMessage.create({ data: { ...base, actId: henna } }));

    // 3. Y el recordatorio de ese mismo acto sí, porque `kind` sigue en la clave.
    await prisma.whatsappMessage.create({ data: { ...base, actId: henna, kind: 'reminder' } });

    // 4. «La celebración entera» es `actId` nulo, y NO choca con los de acto:
    //    en PostgreSQL dos nulos no son iguales, así que ese caso lo cubre el
    //    SEGUNDO índice parcial. Sin él, se podrían encolar cien.
    await prisma.whatsappMessage.create({ data: { ...base, actId: null } });
    await assert.rejects(prisma.whatsappMessage.create({ data: { ...base, actId: null } }));

    assert.equal(await prisma.whatsappMessage.count({ where: { eventId } }), 4);

    // 5. Y el freno es solo para lo que sigue VIVO: lo que ya salió no impide
    //    volver a escribirle. Si lo impidiera, un reenvío después de una boda
    //    sería imposible para siempre.
    await prisma.whatsappMessage.updateMany({ where: { eventId }, data: { status: 'sent' } });
    await prisma.whatsappMessage.create({ data: { ...base, actId: henna } });
    assert.equal(await prisma.whatsappMessage.count({ where: { eventId } }), 5);
  });
});
