import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { agendaFor } from '../src/lib/acts/access';
import { actMetrics, actReport, coverage } from '../src/lib/acts/metrics';
import { answerAct } from '../src/lib/acts/rsvp';
import { controlDb } from '../src/lib/db/client';
import { tenantScope } from '../src/lib/db/tenant';
import { exportAct } from '../src/lib/export/acts';

import { HAS_DB, makeEvent, withDatabase } from './helpers';

/**
 * Los números de una boda en actos, y la lista que se le manda al salón.
 *
 * Aquí lo que se puede romper no es una pantalla: es que alguien monte ciento
 * ochenta sillas para doscientas veinte personas, o que a la henna entre quien
 * no estaba invitado porque la exportación contó por grupos en vez de por la
 * regla de verdad. Por eso lo que cuenta la métrica se compara contra lo que ve
 * el invitado (`agendaFor`) y no solo contra un número escrito a mano.
 */
describe('métricas por acto', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  const scope = () => tenantScope(fixture.get().tenantId);

  let eventId = '';
  let henna = '';
  let recepcion = '';
  let familia = '';
  let sequence = 0;

  /** Un acto de esta boda, con lo mínimo para existir. */
  const acto = async (
    type: 'henna' | 'reception',
    order: number,
    extra: { capacity?: number; visibility?: 'public' | 'segmented'; isMain?: boolean } = {},
  ): Promise<string> => {
    const row = await controlDb().eventAct.create({
      data: {
        eventId,
        type,
        order,
        date: '2026-07-0' + String(order + 2),
        time: '20:00',
        timezone: 'Asia/Beirut',
        venueName: 'Salon',
        venueAddress: 'Beirut',
        venueMapUrl: 'https://m.example',
        visibility: extra.visibility ?? 'segmented',
        ...(extra.capacity === undefined ? {} : { capacity: extra.capacity }),
        ...(extra.isMain === true ? { isMain: true } : {}),
      },
      select: { id: true },
    });
    return row.id;
  };

  const invitado = async (
    name: string,
    options: { segment?: string; phone?: string | null; email?: string | null; maxParty?: number } = {},
  ): Promise<{ id: string; maxParty: number }> => {
    sequence += 1;
    const guest = await controlDb().guest.create({
      data: {
        eventId,
        name,
        locale: 'ar',
        token: `test-metricas-${Date.now()}-${sequence}`,
        maxParty: options.maxParty ?? 4,
        phone: options.phone ?? null,
        email: options.email ?? null,
      },
      select: { id: true, maxParty: true },
    });
    if (options.segment !== undefined) {
      await controlDb().guestSegment.create({
        data: { guestId: guest.id, segmentId: options.segment, eventId },
      });
    }
    return guest;
  };

  const metricsOf = async (actId: string) => {
    const rows = await actMetrics(scope(), eventId);
    assert.ok(rows !== null, 'el evento es de esta oficina y devolvió nulo');
    const row = rows.find((candidate) => candidate.actId === actId);
    assert.ok(row !== undefined, 'el acto no salió en las métricas');
    return row;
  };

  beforeEach(async () => {
    eventId = await makeEvent(fixture.get().tenantId);
    // Las dos segmentadas a propósito: con un acto público TODO el mundo está
    // autorizado a algo, y eso tapa justo lo que la cobertura existe para ver.
    henna = await acto('henna', 0);
    recepcion = await acto('reception', 1, { isMain: true });

    const segment = await controlDb().audienceSegment.create({
      data: { eventId, key: 'familia', name: 'Familia' },
      select: { id: true },
    });
    familia = segment.id;
    await controlDb().actAudience.create({ data: { actId: henna, segmentId: familia, eventId } });
    await controlDb().actAudience.create({
      data: { actId: recepcion, segmentId: familia, eventId },
    });
  });

  it('cuenta quién entra, quién contestó qué y quién no ha dicho nada', async () => {
    const tia = await invitado('Tía', { segment: familia, phone: '+96170000001' });
    const primo = await invitado('Primo', { segment: familia, phone: '+96170000002' });
    const amiga = await invitado('Amiga', { segment: familia, phone: '+96170000003' });
    await invitado('Callado', { segment: familia, phone: '+96170000004' });

    await answerAct(scope(), eventId, tia, recepcion, { status: 'attending', party: 4 });
    await answerAct(scope(), eventId, primo, recepcion, { status: 'declined', party: 1 });
    await answerAct(scope(), eventId, amiga, recepcion, { status: 'tentative', party: 2 });

    const fiesta = await metricsOf(recepcion);
    assert.equal(fiesta.authorized, 4);
    assert.equal(fiesta.replied, 3);
    assert.equal(fiesta.attending, 1);
    assert.equal(fiesta.declined, 1);
    // El «quizá» no se reparte entre los otros dos ni se calla.
    assert.equal(fiesta.tentative, 1);
    assert.equal(fiesta.pending, 1);
    assert.equal(fiesta.seats, 4);

    // La henna la ve la misma familia y no ha contestado nadie: cuatro pueden
    // entrar, cuatro sin contestar, cero sillas.
    const noche = await metricsOf(henna);
    assert.equal(noche.authorized, 4);
    assert.equal(noche.replied, 0);
    assert.equal(noche.pending, 4);
    assert.equal(noche.seats, 0);
  });

  it('las sillas son la suma de «party», no cuánta gente contestó', async () => {
    const tia = await invitado('Tía', { segment: familia, phone: '+96170000011' });
    const primo = await invitado('Primo', { segment: familia, phone: '+96170000012' });
    await answerAct(scope(), eventId, tia, recepcion, { status: 'attending', party: 4 });
    await answerAct(scope(), eventId, primo, recepcion, { status: 'attending', party: 2 });

    const fiesta = await metricsOf(recepcion);
    // Dos respuestas, SEIS sillas. Contar cabezas es como se queda corto el
    // salón: quien confirmó por cuatro ocupa cuatro.
    assert.equal(fiesta.attending, 2);
    assert.equal(fiesta.seats, 6);
  });

  it('el aforo que se pasa se dice, y un aforo sin poner no se pasa nunca', async () => {
    const pequena = await acto('henna', 2, { capacity: 3 });
    await controlDb().actAudience.create({
      data: { actId: pequena, segmentId: familia, eventId },
    });
    const tia = await invitado('Tía', { segment: familia, phone: '+96170000021' });
    await answerAct(scope(), eventId, tia, pequena, { status: 'attending', party: 4 });

    const apretada = await metricsOf(pequena);
    assert.equal(apretada.seats, 4);
    assert.equal(apretada.capacity, 3);
    assert.equal(apretada.overCapacity, true, 'cuatro sillas en un salón de tres y no avisó');

    // La recepción no tiene aforo puesto: nulo es «no lo sé», no «cero».
    await answerAct(scope(), eventId, tia, recepcion, { status: 'attending', party: 4 });
    const fiesta = await metricsOf(recepcion);
    assert.equal(fiesta.capacity, null);
    assert.equal(fiesta.overCapacity, false);
  });

  it('una exclusión con nombre resta de «pueden entrar»', async () => {
    const tia = await invitado('Tía', { segment: familia, phone: '+96170000031' });
    await invitado('Primo', { segment: familia, phone: '+96170000032' });
    await controlDb().guestActInvite.create({
      data: { guestId: tia.id, actId: henna, eventId, excluded: true },
    });

    // Dos en la familia, uno excluido de la henna con nombre y apellido.
    assert.equal((await metricsOf(henna)).authorized, 1);
    assert.equal((await metricsOf(recepcion)).authorized, 2);
  });

  it('lo que cuenta la métrica es lo que ve el invitado', async () => {
    const tia = await invitado('Tía', { segment: familia, phone: '+96170000041' });
    const colega = await invitado('Colega', { phone: '+96170000042' });
    const amiga = await invitado('Amiga', { phone: '+96170000043' });
    // Una invitación con nombre invita aunque no esté en ningún grupo.
    await controlDb().guestActInvite.create({
      data: { guestId: amiga.id, actId: henna, eventId },
    });

    const rows = await actMetrics(scope(), eventId);
    assert.ok(rows !== null);
    const counted = rows.reduce((total, row) => total + row.authorized, 0);

    // La misma cuenta por el otro lado: acto por acto arriba, invitado por
    // invitado aquí. Si las dos formas de decidir se desvían, esto lo dice.
    let seen = 0;
    for (const guest of [tia, colega, amiga]) {
      seen += (await agendaFor(scope(), eventId, guest)).length;
    }
    assert.equal(counted, seen);
    assert.equal(counted, 3, 'la tía a los dos actos y la amiga solo a la henna');
  });
});

describe('la cobertura de una boda', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  const scope = () => tenantScope(fixture.get().tenantId);

  let eventId = '';
  let familia = '';
  let recepcion = '';
  let sequence = 0;

  const invitado = async (
    name: string,
    options: { segment?: string; phone?: string | null; email?: string | null } = {},
  ): Promise<{ id: string; maxParty: number }> => {
    sequence += 1;
    const guest = await controlDb().guest.create({
      data: {
        eventId,
        name,
        locale: 'ar',
        token: `test-cobertura-${Date.now()}-${sequence}`,
        maxParty: 4,
        phone: options.phone ?? null,
        email: options.email ?? null,
      },
      select: { id: true, maxParty: true },
    });
    if (options.segment !== undefined) {
      await controlDb().guestSegment.create({
        data: { guestId: guest.id, segmentId: options.segment, eventId },
      });
    }
    return guest;
  };

  beforeEach(async () => {
    eventId = await makeEvent(fixture.get().tenantId);
    const row = await controlDb().eventAct.create({
      data: {
        eventId,
        type: 'reception',
        order: 0,
        date: '2026-07-04',
        time: '20:00',
        timezone: 'Asia/Beirut',
        venueName: 'Salon',
        venueAddress: 'Beirut',
        venueMapUrl: 'https://m.example',
        visibility: 'segmented',
        isMain: true,
      },
      select: { id: true },
    });
    recepcion = row.id;
    const segment = await controlDb().audienceSegment.create({
      data: { eventId, key: 'familia', name: 'Familia' },
      select: { id: true },
    });
    familia = segment.id;
    await controlDb().actAudience.create({
      data: { actId: recepcion, segmentId: familia, eventId },
    });
  });

  it('quien no está en ningún grupo sale en la cobertura, con nombre', async () => {
    await invitado('Tía', { segment: familia, phone: '+96170000101' });
    await invitado('Huérfano', { phone: '+96170000102' });

    const vista = await coverage(scope(), eventId);
    assert.ok(vista !== null);
    assert.equal(vista.guests, 2);
    // No está en ningún grupo y no hay acto público: a este no lo va a poder
    // invitar nadie, y el recuento por sí solo no dice a quién llamar.
    assert.equal(vista.inNoAct.count, 1);
    assert.deepEqual(vista.inNoAct.sample.map((guest) => guest.name), ['Huérfano']);
  });

  it('sin teléfono y sin correo no hay por dónde avisar', async () => {
    await invitado('Tía', { segment: familia, phone: '+96170000111' });
    await invitado('Abuela', { segment: familia, email: 'abuela@example.com' });
    await invitado('Perdido', { segment: familia });

    const vista = await coverage(scope(), eventId);
    assert.ok(vista !== null);
    assert.equal(vista.unreachable.count, 1);
    assert.deepEqual(vista.unreachable.sample.map((guest) => guest.name), ['Perdido']);
  });

  it('estar invitado a algo y no haber contestado a nada es su propio caso', async () => {
    const tia = await invitado('Tía', { segment: familia, phone: '+96170000121' });
    await invitado('Callado', { segment: familia, phone: '+96170000122' });
    // Y uno que no está en ningún acto: ese NO es un callado, es un agujero.
    await invitado('Huérfano', { phone: '+96170000123' });
    await answerAct(scope(), eventId, tia, recepcion, { status: 'attending', party: 2 });

    const vista = await coverage(scope(), eventId);
    assert.ok(vista !== null);
    assert.equal(vista.silent.count, 1);
    assert.deepEqual(vista.silent.sample.map((guest) => guest.name), ['Callado']);
    assert.equal(vista.inNoAct.count, 1);
  });

  it('las dos vistas juntas dicen lo mismo que por separado', async () => {
    await invitado('Tía', { segment: familia, phone: '+96170000131' });
    await invitado('Huérfano', { phone: '+96170000132' });

    const informe = await actReport(scope(), eventId);
    assert.ok(informe !== null);
    assert.deepEqual(informe.acts, await actMetrics(scope(), eventId));
    assert.deepEqual(informe.coverage, await coverage(scope(), eventId));
  });
});

describe('la lista de un acto en hoja de cálculo', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  const scope = () => tenantScope(fixture.get().tenantId);

  let eventId = '';
  let henna = '';
  let familia = '';
  let sequence = 0;

  const invitado = async (
    name: string,
    options: { segment?: string; phone?: string | null } = {},
  ): Promise<{ id: string; maxParty: number }> => {
    sequence += 1;
    const guest = await controlDb().guest.create({
      data: {
        eventId,
        name,
        locale: 'ar',
        token: `test-csv-actos-${Date.now()}-${sequence}`,
        maxParty: 4,
        phone: options.phone ?? null,
      },
      select: { id: true, maxParty: true },
    });
    if (options.segment !== undefined) {
      await controlDb().guestSegment.create({
        data: { guestId: guest.id, segmentId: options.segment, eventId },
      });
    }
    return guest;
  };

  beforeEach(async () => {
    eventId = await makeEvent(fixture.get().tenantId);
    const row = await controlDb().eventAct.create({
      data: {
        eventId,
        type: 'henna',
        order: 0,
        date: '2026-07-02',
        time: '20:00',
        timezone: 'Asia/Beirut',
        venueName: 'Casa',
        venueAddress: 'Beirut',
        venueMapUrl: 'https://m.example',
        visibility: 'segmented',
        isMain: true,
      },
      select: { id: true },
    });
    henna = row.id;
    const segment = await controlDb().audienceSegment.create({
      data: { eventId, key: 'familia', name: 'Familia' },
      select: { id: true },
    });
    familia = segment.id;
    await controlDb().actAudience.create({ data: { actId: henna, segmentId: familia, eventId } });
  });

  it('lleva la marca de orden de bytes y neutraliza un nombre que empieza por «=»', async () => {
    // El formulario de confirmación es público a propósito: este nombre lo
    // puede escribir el propio invitado, y Excel lo EJECUTA al abrir el archivo.
    await invitado('=HYPERLINK("https://malo.example","Confirmar")', {
      segment: familia,
      phone: '+96170000201',
    });

    const hoja = await exportAct(scope(), eventId, henna);
    assert.ok(hoja !== null);
    assert.ok(hoja.csv.startsWith('﻿'), 'sin la marca de orden de bytes Excel rompe el árabe');
    assert.ok(
      hoja.csv.includes('"\'=HYPERLINK'),
      'el nombre entró sin apóstrofo: la hoja lo ejecuta al abrirla',
    );
    assert.ok(
      hoja.csv.includes('"name","phone","locale","segments","status","party","table"'),
      'la cabecera cambió sin que nadie lo dijera',
    );
  });

  it('una fila por invitado AUTORIZADO, con su grupo, su respuesta y su mesa', async () => {
    const tia = await invitado('Tía', { segment: familia, phone: '+96170000211' });
    await invitado('Colega', { phone: '+96170000212' });
    await answerAct(scope(), eventId, tia, henna, { status: 'attending', party: 3 });

    const mesa = await controlDb().table.create({
      data: { eventId, name: 'Mesa 1', seats: 10 },
      select: { id: true },
    });
    await controlDb().guest.update({ where: { id: tia.id }, data: { tableId: mesa.id } });

    const hoja = await exportAct(scope(), eventId, henna);
    assert.ok(hoja !== null);
    // El colega no está en ningún grupo y la henna es segmentada: no entra, y
    // por tanto no sale en la lista que se le manda al salón.
    assert.equal(hoja.rows, 1);
    assert.ok(!hoja.csv.includes('Colega'));

    // El teléfono sale con apóstrofo, y está bien: un E.164 empieza por «+» y
    // eso también lo ejecuta una hoja de cálculo. Es lo mismo que hace la
    // exportación de invitados de siempre.
    const fila = hoja.csv.trim().split('\r\n')[1];
    assert.equal(fila, '"Tía","\'+96170000211","ar","Familia","attending","3","Mesa 1"');
  });

  it('sin contestar, la celda se queda vacía y no se inventa un estado', async () => {
    await invitado('Callado', { segment: familia, phone: '+96170000221' });
    const hoja = await exportAct(scope(), eventId, henna);
    assert.ok(hoja !== null);
    assert.equal(
      hoja.csv.trim().split('\r\n')[1],
      '"Callado","\'+96170000221","ar","Familia","","",""',
    );
  });
});

describe('los actos de otra boda no se cuentan', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  it('un evento de otra oficina no devuelve nada, ni métricas ni cobertura ni CSV', async () => {
    const mine = tenantScope(fixture.get().tenantId);
    const theirs = tenantScope(fixture.get().otherTenantId);
    const eventId = await makeEvent(fixture.get().tenantId);
    const act = await controlDb().eventAct.create({
      data: {
        eventId,
        type: 'reception',
        date: '2026-07-04',
        time: '20:00',
        timezone: 'Asia/Beirut',
        venueName: 'Salon',
        venueAddress: 'Beirut',
        venueMapUrl: 'https://m.example',
        visibility: 'public',
      },
      select: { id: true },
    });

    // Con el id del evento Y el del acto en la mano: no se distingue de «no
    // existe», que es la respuesta correcta — lo contrario le diría a una
    // oficina qué bodas hay en otra.
    assert.equal(await actMetrics(theirs, eventId), null);
    assert.equal(await coverage(theirs, eventId), null);
    assert.equal(await actReport(theirs, eventId), null);
    assert.equal(await exportAct(theirs, eventId, act.id), null);

    // Y el acto de OTRA boda de la misma oficina tampoco: el id viene de un
    // formulario y un id suelto no autoriza nada.
    const otra = await makeEvent(fixture.get().tenantId);
    assert.equal(await exportAct(mine, otra, act.id), null);
    assert.ok(await exportAct(mine, eventId, act.id) !== null);
  });
});
