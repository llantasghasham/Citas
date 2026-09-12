import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { calendarFor, type CalendarSubject } from '../src/lib/calendar/agenda';
import { sequenceFrom } from '../src/lib/calendar/ics';
import { controlDb } from '../src/lib/db/client';
import { tenantScope } from '../src/lib/db/tenant';
import { getDictionary } from '../src/lib/dictionary';

import { HAS_DB, makeEvent, withDatabase } from './helpers';

/**
 * El calendario de una celebración con varios actos.
 *
 * Lo que se juega aquí son dos cosas distintas y las dos caras. Una es la
 * agenda: quien descarga el archivo se lleva a su móvil los actos a los que
 * está invitado, y NO los de otro — una henna íntima que salga en el `.ics` de
 * un compañero de trabajo ya no se puede volver a esconder. La otra es que
 * corregir la hora de un acto corrija la cita que esa persona ya guardó, en vez
 * de dejarle dos citas en el mismo día.
 */
describe('el calendario de varios actos', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  const scope = () => tenantScope(fixture.get().tenantId);

  let eventId = '';
  let henna = '';
  let recepcion = '';
  let familia = '';

  const subject = (): CalendarSubject => ({
    eventName: 'Boda',
    honorees: 'Karim · Layla',
    actTypeNames: getDictionary('es').actTypes,
    message: 'Le esperamos',
    url: 'https://citas.posxml.com/i/prueba',
    legacy: {
      uid: 'version-vieja@citas',
      date: '2026-07-04',
      time: '19:00',
      timeZone: 'Asia/Beirut',
      location: 'Prueba, Beirut',
    },
  });

  /** Las líneas de un tipo, ya desplegadas de VEVENT en VEVENT. */
  const lines = (ics: string, prefix: string): string[] =>
    ics.split('\r\n').filter((line) => line.startsWith(prefix));

  const ok = (result: Awaited<ReturnType<typeof calendarFor>>): string => {
    assert.equal(result.ok, true, 'el calendario no se pudo escribir');
    return result.ok ? result.ics : '';
  };

  const invitado = async (
    name: string,
    token: string,
    segmentId?: string,
  ): Promise<{ id: string; token: string }> => {
    const guest = await controlDb().guest.create({
      data: { eventId, name, locale: 'ar', token },
      select: { id: true, token: true },
    });
    if (segmentId !== undefined) {
      await controlDb().guestSegment.create({ data: { guestId: guest.id, segmentId, eventId } });
    }
    return guest;
  };

  beforeEach(async () => {
    const prisma = controlDb();
    eventId = await makeEvent(fixture.get().tenantId);

    // Una henna privada de la familia y una recepción pública: los dos casos.
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
        venueName: 'Le Royal; piso 2',
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
    familia = f.id;
    await prisma.actAudience.create({ data: { actId: henna, segmentId: familia, eventId } });
  });

  it('un VEVENT por acto, y no uno solo con la fecha del evento', async () => {
    const tia = await invitado('Tía', `test-cal-${Date.now()}-1`, familia);
    const ics = ok(await calendarFor(scope(), eventId, subject(), { guestToken: tia.token }));

    assert.equal(lines(ics, 'BEGIN:VEVENT').length, 2);
    assert.equal(lines(ics, 'END:VEVENT').length, 2);
    assert.equal(lines(ics, 'BEGIN:VCALENDAR').length, 1, 'un solo calendario, no dos pegados');
    // El nombre de cada acto sale de su tipo, en el idioma de la invitación.
    assert.ok(ics.includes('SUMMARY:Henna — Karim · Layla'), ics);
  });

  it('el invitado ve SUS actos; quien no está en el grupo no ve la henna', async () => {
    const tia = await invitado('Tía', `test-cal-${Date.now()}-2`, familia);
    const colega = await invitado('Colega', `test-cal-${Date.now()}-3`);

    const suyo = ok(await calendarFor(scope(), eventId, subject(), { guestToken: tia.token }));
    const deel = ok(await calendarFor(scope(), eventId, subject(), { guestToken: colega.token }));
    // Y sin token no hay invitado: solo lo público, que es lo que se lleva quien
    // reenvía el enlace a un grupo entero.
    const publico = ok(await calendarFor(scope(), eventId, subject()));

    assert.equal(lines(suyo, 'BEGIN:VEVENT').length, 2);
    assert.equal(lines(deel, 'BEGIN:VEVENT').length, 1, 'la henna ajena se coló');
    assert.ok(!deel.includes('Casa'), 'la sede de la henna se coló');
    assert.equal(lines(publico, 'BEGIN:VEVENT').length, 1);
    assert.ok(!publico.includes('Casa'));
  });

  it('un token de otra boda no abre la agenda de esta', async () => {
    const otro = await makeEvent(fixture.get().tenantId);
    const ajeno = await controlDb().guest.create({
      data: { eventId: otro, name: 'Ajeno', locale: 'ar', token: `test-cal-${Date.now()}-4` },
      select: { token: true },
    });

    // No es un error: es que no es un invitado de este evento, así que se lleva
    // lo mismo que cualquiera con el enlace.
    const ics = ok(await calendarFor(scope(), eventId, subject(), { guestToken: ajeno.token }));
    assert.equal(lines(ics, 'BEGIN:VEVENT').length, 1);
    assert.ok(!ics.includes('Casa'));
  });

  it('el UID no se mueve al corregir el acto, y el SEQUENCE dice qué versión es', async () => {
    const antes = ok(await calendarFor(scope(), eventId, subject()));
    const otraVez = ok(await calendarFor(scope(), eventId, subject()));
    assert.deepEqual(lines(antes, 'UID:'), lines(otraVez, 'UID:'), 'el UID cambió sin tocar nada');
    assert.deepEqual(lines(antes, 'SEQUENCE:'), lines(otraVez, 'SEQUENCE:'), 'y el SEQUENCE tampoco');

    const corregido = await controlDb().eventAct.update({
      where: { id: recepcion },
      data: { time: '21:00' },
      select: { updatedAt: true },
    });
    const despues = ok(await calendarFor(scope(), eventId, subject()));

    // Un calendario actualiza POR UID: si cambiara, el invitado no vería una
    // corrección sino una cita nueva, con la vieja al lado para siempre.
    assert.deepEqual(lines(despues, 'UID:'), lines(antes, 'UID:'));
    assert.ok(despues.includes('DTSTART:20260704T180000Z'), despues);
    // Y el número que decide cuál de las dos versiones manda sale de la marca de
    // tiempo de la fila, que solo avanza. Se comprueba contra la fila y no con un
    // reloj de por medio: dos escrituras en el mismo segundo no probarían nada.
    assert.deepEqual(lines(despues, 'SEQUENCE:'), [
      `SEQUENCE:${sequenceFrom(corregido.updatedAt)}`,
    ]);
    assert.ok(
      sequenceFrom(corregido.updatedAt) > sequenceFrom(new Date(corregido.updatedAt.getTime() - 1000)),
      'el SEQUENCE no sube con el tiempo: el cliente se quedaría con la hora vieja',
    );
  });

  it('escapa el punto y coma del salón, que rompía el archivo entero', async () => {
    // `'\;'` en JavaScript es un punto y coma a secas: no se escapaba nada, y
    // «Le Royal; piso 2» partía la línea en dos.
    const ics = ok(await calendarFor(scope(), eventId, subject()));
    const location = lines(ics, 'LOCATION:');
    assert.equal(location.length, 1);
    assert.ok(location[0]?.includes('Le Royal\\; piso 2'), location[0]);

    // Y ni un punto y coma ni una coma sueltos en ningún valor de texto.
    const sueltos = ics
      .split('\r\n')
      .filter((line) => /^(SUMMARY|LOCATION|DESCRIPTION):/.test(line))
      .filter((line) => /(?<!\\)[;,]/.test(line.slice(line.indexOf(':') + 1)));
    assert.deepEqual(sueltos, []);
  });

  it('cada acto con SU zona: la misma hora de reloj son dos instantes', async () => {
    // La fiesta previa en Costa Rica y la boda en Beirut no es raro en este
    // mercado: ocho horas de diferencia entre dos actos del mismo evento.
    await controlDb().eventAct.update({
      where: { id: henna },
      data: { timezone: 'America/Costa_Rica', date: '2026-07-04', time: '20:00' },
    });
    const tia = await invitado('Tía', `test-cal-${Date.now()}-5`, familia);
    const ics = ok(await calendarFor(scope(), eventId, subject(), { guestToken: tia.token }));

    assert.ok(ics.includes('DTSTART:20260705T020000Z'), 'la henna de Costa Rica');
    assert.ok(ics.includes('DTSTART:20260704T170000Z'), 'la recepción de Beirut');
  });

  it('la hora de fin que cruza la medianoche acaba al día siguiente', async () => {
    await controlDb().eventAct.update({
      where: { id: recepcion },
      data: { time: '23:00', endTime: '01:00' },
    });
    const ics = ok(await calendarFor(scope(), eventId, subject()));

    assert.ok(ics.includes('DTSTART:20260704T200000Z'), ics);
    // Sin esto el DTEND quedaría veintidós horas ANTES que el DTSTART.
    assert.ok(ics.includes('DTEND:20260704T220000Z'), ics);
  });

  it('una fecha que no existe se rechaza, no se corre al mes siguiente', async () => {
    // Se escribe a mano porque el editor ya no la deja pasar; las filas viejas
    // se publicaron antes de que eso se comprobara.
    await controlDb().eventAct.update({ where: { id: recepcion }, data: { date: '2026-02-30' } });
    assert.deepEqual(await calendarFor(scope(), eventId, subject()), {
      ok: false,
      reason: 'invalid_date',
    });
  });

  it('un evento sin actos sigue dando el VEVENT de siempre', async () => {
    // Hay bodas repartidas desde antes de que existieran los actos, y en la
    // agenda de sus invitados esa cita ya está guardada con ese UID.
    const viejo = await makeEvent(fixture.get().tenantId);
    const ics = ok(await calendarFor(scope(), viejo, subject()));

    assert.equal(lines(ics, 'BEGIN:VEVENT').length, 1);
    assert.deepEqual(lines(ics, 'UID:'), ['UID:version-vieja@citas']);
    assert.ok(ics.includes('SUMMARY:Boda — Karim · Layla'), ics);
    assert.ok(ics.includes('DTSTART:20260704T160000Z'), ics);
  });
});
