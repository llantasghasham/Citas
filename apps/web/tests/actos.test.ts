import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { agendaFor, publicActs } from '../src/lib/acts/access';
import { answerAct, summarise } from '../src/lib/acts/rsvp';
import { controlDb } from '../src/lib/db/client';
import { tenantScope } from '../src/lib/db/tenant';

import { HAS_DB, makeEvent, withDatabase } from './helpers';

/**
 * Los actos, sus audiencias y quién puede responder a qué.
 *
 * Esto decide si la henna íntima de una familia aparece en la pantalla de un
 * compañero de trabajo. No hay una forma suave de equivocarse aquí: no enseñar
 * de menos se arregla con una llamada; enseñar de más no se arregla.
 */
describe('quién ve qué acto', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  const scope = () => tenantScope(fixture.get().tenantId);

  let eventId = '';
  let henna = '';
  let recepcion = '';
  let familia = '';
  let trabajo = '';

  const invitado = async (name: string, token: string, maxParty = 1): Promise<{ id: string; maxParty: number }> => {
    const row = await controlDb().guest.create({
      data: { eventId, name, locale: 'ar', token, maxParty },
      select: { id: true, maxParty: true },
    });
    return row;
  };

  const enGrupo = async (guestId: string, segmentId: string): Promise<void> => {
    await controlDb().guestSegment.create({ data: { guestId, segmentId, eventId } });
  };

  beforeEach(async () => {
    const prisma = controlDb();
    eventId = await makeEvent(fixture.get().tenantId);

    // Una henna privada y una recepción pública: los dos casos que importan.
    const h = await prisma.eventAct.create({
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
      },
      select: { id: true },
    });
    const r = await prisma.eventAct.create({
      data: {
        eventId,
        type: 'reception',
        order: 1,
        date: '2026-07-04',
        time: '20:00',
        timezone: 'Asia/Beirut',
        venueName: 'Salon',
        venueAddress: 'Beirut',
        venueMapUrl: 'https://m.example',
        visibility: 'public',
        isMain: true,
      },
      select: { id: true },
    });
    henna = h.id;
    recepcion = r.id;

    const f = await prisma.audienceSegment.create({
      data: { eventId, key: 'familia', name: 'Familia' },
      select: { id: true },
    });
    const t = await prisma.audienceSegment.create({
      data: { eventId, key: 'trabajo', name: 'Trabajo' },
      select: { id: true },
    });
    familia = f.id;
    trabajo = t.id;

    await prisma.actAudience.create({ data: { actId: henna, segmentId: familia, eventId } });
  });

  it('la familia ve la henna; el de trabajo, no', async () => {
    const tia = await invitado('Tía', `test-actos-${Date.now()}-1`);
    const colega = await invitado('Colega', `test-actos-${Date.now()}-2`);
    await enGrupo(tia.id, familia);
    await enGrupo(colega.id, trabajo);

    const suya = await agendaFor(scope(), eventId, tia);
    const deel = await agendaFor(scope(), eventId, colega);

    assert.deepEqual(suya.map((act) => act.id).sort(), [henna, recepcion].sort());
    // La recepción es pública, así que la ve; la henna no aparece en absoluto.
    assert.deepEqual(deel.map((act) => act.id), [recepcion]);
  });

  it('quien no está en ningún grupo solo ve lo público', async () => {
    const nadie = await invitado('Nadie', `test-actos-${Date.now()}-3`);
    const agenda = await agendaFor(scope(), eventId, nadie);
    assert.deepEqual(agenda.map((act) => act.id), [recepcion]);
  });

  it('«deny» gana sobre «allow»', async () => {
    const prisma = controlDb();
    const primo = await invitado('Primo', `test-actos-${Date.now()}-4`);
    await enGrupo(primo.id, familia);
    await enGrupo(primo.id, trabajo);
    // «Toda la familia menos los de trabajo» se escribe así, y no enumerando a
    // los demás uno por uno.
    await prisma.actAudience.create({
      data: { actId: henna, segmentId: trabajo, eventId, mode: 'deny' },
    });

    const agenda = await agendaFor(scope(), eventId, primo);
    assert.deepEqual(agenda.map((act) => act.id), [recepcion]);
  });

  it('una exclusión con nombre gana sobre el grupo', async () => {
    const tio = await invitado('Tío', `test-actos-${Date.now()}-5`);
    await enGrupo(tio.id, familia);
    await controlDb().guestActInvite.create({
      data: { guestId: tio.id, actId: henna, eventId, excluded: true },
    });

    const agenda = await agendaFor(scope(), eventId, tio);
    assert.deepEqual(agenda.map((act) => act.id), [recepcion]);
  });

  it('una invitación con nombre invita aunque no esté en ningún grupo, y un «deny» no la tumba', async () => {
    const prisma = controlDb();
    const amiga = await invitado('Amiga', `test-actos-${Date.now()}-6`);
    await enGrupo(amiga.id, trabajo);
    await prisma.actAudience.create({
      data: { actId: henna, segmentId: trabajo, eventId, mode: 'deny' },
    });
    // Quien escribió el nombre lo escribió sabiendo lo que había.
    await prisma.guestActInvite.create({
      data: { guestId: amiga.id, actId: henna, eventId, maxParty: 3 },
    });

    const agenda = await agendaFor(scope(), eventId, amiga);
    const suHenna = agenda.find((act) => act.id === henna);
    assert.ok(suHenna !== undefined, 'la invitación con nombre no invitó');
    // Y el tope de ESTE acto manda sobre el del invitado.
    assert.equal(suHenna.maxParty, 3);
    assert.equal(agenda.find((act) => act.id === recepcion)?.maxParty, 1);
  });

  it('la página pública solo enseña lo público', async () => {
    const publicos = await publicActs(scope(), eventId);
    assert.deepEqual(publicos.map((act) => act.id), [recepcion]);
  });

  it('el acto de otra boda no entra en la agenda de nadie', async () => {
    const otroEvento = await makeEvent(fixture.get().tenantId);
    await controlDb().eventAct.create({
      data: {
        eventId: otroEvento,
        type: 'ceremony',
        date: '2026-09-01',
        time: '18:00',
        timezone: 'Asia/Beirut',
        venueName: 'Otra',
        venueAddress: 'Beirut',
        venueMapUrl: 'https://m.example',
        visibility: 'public',
      },
    });

    const tia = await invitado('Tía', `test-actos-${Date.now()}-7`);
    await enGrupo(tia.id, familia);
    const agenda = await agendaFor(scope(), eventId, tia);
    assert.deepEqual(agenda.map((act) => act.id).sort(), [henna, recepcion].sort());
  });
});

describe('responder acto por acto', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  const scope = () => tenantScope(fixture.get().tenantId);

  let eventId = '';
  let henna = '';
  let recepcion = '';
  let familia = '';

  beforeEach(async () => {
    const prisma = controlDb();
    eventId = await makeEvent(fixture.get().tenantId);
    const h = await prisma.eventAct.create({
      data: {
        eventId, type: 'henna', order: 0, date: '2026-07-02', time: '20:00',
        timezone: 'Asia/Beirut', venueName: 'Casa', venueAddress: 'Beirut',
        venueMapUrl: 'https://m.example',
      },
      select: { id: true },
    });
    const r = await prisma.eventAct.create({
      data: {
        eventId, type: 'reception', order: 1, date: '2026-07-04', time: '20:00',
        timezone: 'Asia/Beirut', venueName: 'Salon', venueAddress: 'Beirut',
        venueMapUrl: 'https://m.example', isMain: true,
      },
      select: { id: true },
    });
    henna = h.id;
    recepcion = r.id;
    const f = await prisma.audienceSegment.create({
      data: { eventId, key: 'familia', name: 'Familia' },
      select: { id: true },
    });
    familia = f.id;
    await prisma.actAudience.create({ data: { actId: henna, segmentId: familia, eventId } });
    await prisma.actAudience.create({ data: { actId: recepcion, segmentId: familia, eventId } });
  });

  const familiar = async (maxParty = 4): Promise<{ id: string; maxParty: number }> => {
    const prisma = controlDb();
    const guest = await prisma.guest.create({
      data: { eventId, name: 'Rami', locale: 'ar', token: `test-actos-r-${Date.now()}`, maxParty },
      select: { id: true, maxParty: true },
    });
    await prisma.guestSegment.create({ data: { guestId: guest.id, segmentId: familia, eventId } });
    return guest;
  };

  it('a la ceremonia sí y a la henna no: dos respuestas, no una', async () => {
    const guest = await familiar();
    assert.deepEqual(
      await answerAct(scope(), eventId, guest, recepcion, { status: 'attending', party: 4 }),
      { ok: true },
    );
    assert.deepEqual(
      await answerAct(scope(), eventId, guest, henna, { status: 'declined', party: 1 }),
      { ok: true },
    );

    const agenda = await agendaFor(scope(), eventId, guest);
    assert.equal(agenda.find((act) => act.id === recepcion)?.reply?.status, 'attending');
    assert.equal(agenda.find((act) => act.id === henna)?.reply?.status, 'declined');

    // Y el resumen de siempre sigue existiendo, con lo que dice el principal.
    const resumen = await controlDb().rsvp.findUnique({ where: { guestId: guest.id } });
    assert.equal(resumen?.status, 'attending');
    assert.equal(resumen?.party, 4);
  });

  it('no se puede responder a un acto al que no se está invitado', async () => {
    const prisma = controlDb();
    const colega = await prisma.guest.create({
      data: { eventId, name: 'Colega', locale: 'ar', token: `test-actos-c-${Date.now()}` },
      select: { id: true, maxParty: true },
    });
    // Ni con el id del acto en la mano: la pantalla no es un permiso.
    assert.deepEqual(
      await answerAct(scope(), eventId, colega, henna, { status: 'attending', party: 1 }),
      { ok: false, reason: 'not_invited' },
    );
    assert.equal(await prisma.guestActRsvp.count({ where: { actId: henna } }), 0);
  });

  it('el tope de acompañantes es POR ACTO', async () => {
    const guest = await familiar(4);
    await controlDb().guestActInvite.create({
      data: { guestId: guest.id, actId: henna, eventId, maxParty: 1 },
    });
    // Cuatro en la recepción, uno en la henna. Quien trae acompañante a la
    // recepción no lo trae por eso a la henna.
    assert.deepEqual(
      await answerAct(scope(), eventId, guest, recepcion, { status: 'attending', party: 4 }),
      { ok: true },
    );
    assert.deepEqual(
      await answerAct(scope(), eventId, guest, henna, { status: 'attending', party: 2 }),
      { ok: false, reason: 'party' },
    );
  });

  it('pasado el plazo de ESE acto ya no se contesta, y el otro sigue abierto', async () => {
    const guest = await familiar();
    await controlDb().eventAct.update({
      where: { id: henna },
      data: { rsvpDeadline: new Date(Date.now() - 60_000) },
    });

    assert.deepEqual(
      await answerAct(scope(), eventId, guest, henna, { status: 'attending', party: 1 }),
      { ok: false, reason: 'closed' },
    );
    assert.deepEqual(
      await answerAct(scope(), eventId, guest, recepcion, { status: 'attending', party: 2 }),
      { ok: true },
    );
  });

  it('la pantalla vieja sigue viendo lo que veía', async () => {
    const guest = await familiar();
    await answerAct(scope(), eventId, guest, recepcion, { status: 'attending', party: 3 });
    const antes = await controlDb().rsvp.findUnique({ where: { guestId: guest.id } });
    assert.equal(antes?.party, 3);

    // Cambiar de idea en el principal cambia el resumen; tocar otro acto no.
    await answerAct(scope(), eventId, guest, henna, { status: 'attending', party: 1 });
    const despues = await controlDb().rsvp.findUnique({ where: { guestId: guest.id } });
    assert.equal(despues?.party, 3, 'una respuesta a otro acto movió el resumen');
  });
});

describe('el resumen se calcula, no se escribe', () => {
  const acto = (isMain: boolean) => ({ isMain });

  it('manda el acto principal cuando hay respuesta suya', () => {
    assert.deepEqual(
      summarise([
        { status: 'attending', party: 1, message: null, act: acto(false) },
        { status: 'declined', party: 1, message: 'no puedo', act: acto(true) },
      ]),
      { status: 'declined', party: 1, message: 'no puedo' },
    );
  });

  it('sin principal, viene quien viene a algo, con el grupo MÁS GRANDE', () => {
    // Contar el más grande y no el último es lo que hace que las mesas no se
    // queden cortas.
    assert.deepEqual(
      summarise([
        { status: 'attending', party: 4, message: 'somos cuatro', act: acto(false) },
        { status: 'attending', party: 1, message: null, act: acto(false) },
      ]),
      { status: 'attending', party: 4, message: 'somos cuatro' },
    );
  });

  it('sin nadie que venga, no se inventa un sí', () => {
    assert.equal(
      summarise([{ status: 'declined', party: 1, message: null, act: acto(false) }])?.status,
      'declined',
    );
    assert.equal(summarise([]), null);
  });
});
