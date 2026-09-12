import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { agendaFor } from '../src/lib/acts/access';
import {
  readTranslations,
  resolveActNames,
  setTranslation,
  type NameableAct,
} from '../src/lib/acts/translations';
import { calendarFor, type CalendarSubject } from '../src/lib/calendar/agenda';
import { controlDb } from '../src/lib/db/client';
import { tenantScope } from '../src/lib/db/tenant';
import { getDictionary } from '../src/lib/dictionary';

import { HAS_DB, makeEvent, withDatabase } from './helpers';

/**
 * El acto escrito en el idioma de QUIEN lo lee.
 *
 * Una boda de Beirut tiene invitados que leen árabe y primos que leen inglés.
 * Hasta que `ActTranslation` se enchufó, los dos veían el mismo texto: `label`
 * es uno solo. Lo que se comprueba aquí es que la prioridad es la que se
 * documentó, que una traducción vacía no tapa el nombre bueno, que un acto de
 * otra boda no se traduce desde esta — y lo más importante de todo: que
 * TRADUCIR NO CONCEDE PERMISOS. El idioma es cómo se lee un acto, nunca quién
 * entra en él.
 */
describe('el acto en el idioma de quien lo lee', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  const scope = () => tenantScope(fixture.get().tenantId);

  let eventId = '';
  let otroEvento = '';
  let henna = '';
  let cena = '';
  let familia = '';

  /** La forma mínima que pide `resolveActNames`, tal y como sale de la agenda. */
  const lista = (): NameableAct[] => [
    { id: henna, type: 'henna', label: 'Noche de henna', venueName: 'Casa', venueAddress: 'Beirut' },
    { id: cena, type: 'dinner', label: null, venueName: 'Salon', venueAddress: 'Beirut' },
  ];

  const invitado = async (
    name: string,
    token: string,
  ): Promise<{ id: string; maxParty: number; token: string }> => {
    const row = await controlDb().guest.create({
      data: { eventId, name, locale: 'en', token, maxParty: 1 },
      select: { id: true, maxParty: true, token: true },
    });
    return row;
  };

  const enGrupo = async (guestId: string): Promise<void> => {
    await controlDb().guestSegment.create({ data: { guestId, segmentId: familia, eventId } });
  };

  beforeEach(async () => {
    const prisma = controlDb();
    eventId = await makeEvent(fixture.get().tenantId);
    otroEvento = await makeEvent(fixture.get().tenantId);

    // Una henna con el nombre que le da ESA familia, y una cena sin nombre
    // propio: los dos escalones de la prioridad que hay que distinguir.
    const h = await prisma.eventAct.create({
      data: {
        eventId,
        type: 'henna',
        order: 0,
        label: 'Noche de henna',
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
    const c = await prisma.eventAct.create({
      data: {
        eventId,
        type: 'dinner',
        order: 1,
        date: '2026-07-04',
        time: '21:00',
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
    cena = c.id;

    const f = await prisma.audienceSegment.create({
      data: { eventId, key: 'familia', name: 'Familia' },
      select: { id: true },
    });
    familia = f.id;
    await prisma.actAudience.create({ data: { actId: henna, segmentId: familia, eventId } });
  });

  it('la traducción manda sobre el label, y el label sobre el nombre del tipo', async () => {
    await setTranslation(
      scope(),
      eventId,
      henna,
      'en',
      {
        label: 'Henna night',
        description: 'Wear white',
        venueName: 'The house',
        venueAddress: '',
      },
      fixture.get().userId,
    );

    const enIngles = await resolveActNames(scope(), lista(), 'en');
    // 1. La traducción de ESE idioma.
    assert.equal(enIngles.get(henna)?.name, 'Henna night');
    assert.equal(enIngles.get(henna)?.description, 'Wear white');
    // Campo a campo: la sede traducida manda, la dirección que nadie tradujo
    // cae a la del acto en vez de quedarse vacía.
    assert.equal(enIngles.get(henna)?.venueName, 'The house');
    assert.equal(enIngles.get(henna)?.venueAddress, 'Beirut');
    // 3. Sin traducción ni label, el nombre del tipo. Nunca sale vacío.
    assert.equal(enIngles.get(cena)?.name, getDictionary('en').actTypes.dinner);
    assert.equal(enIngles.get(cena)?.description, null);

    // 2. En español no hay traducción, así que manda el label de la familia.
    const enEspanol = await resolveActNames(scope(), lista(), 'es');
    assert.equal(enEspanol.get(henna)?.name, 'Noche de henna');
    assert.equal(enEspanol.get(henna)?.venueName, 'Casa');
    assert.equal(enEspanol.get(cena)?.name, getDictionary('es').actTypes.dinner);
  });

  it('un nombre vacío BORRA la fila y devuelve el acto a su label', async () => {
    const actorId = fixture.get().userId;
    assert.deepEqual(
      await setTranslation(
        scope(), eventId, henna, 'en',
        { label: 'Henna night', description: '', venueName: '', venueAddress: '' },
        actorId,
      ),
      { ok: true, action: 'saved' },
    );
    assert.equal((await readTranslations(scope(), eventId, henna))?.get('en')?.label, 'Henna night');

    // Vaciar el nombre no guarda una traducción en blanco: la borra. Guardada,
    // TAPARÍA el nombre bueno, que es lo contrario de lo que quiere quien vacía
    // el campo — y los demás campos no la resucitan.
    assert.deepEqual(
      await setTranslation(
        scope(), eventId, henna, 'en',
        { label: '   ', description: 'algo', venueName: 'The house', venueAddress: '' },
        actorId,
      ),
      { ok: true, action: 'removed' },
    );
    assert.equal((await readTranslations(scope(), eventId, henna))?.has('en'), false);
    assert.equal(await controlDb().actTranslation.count({ where: { actId: henna } }), 0);

    const enIngles = await resolveActNames(scope(), lista(), 'en');
    assert.equal(enIngles.get(henna)?.name, 'Noche de henna');
  });

  it('el acto de otra boda no se traduce desde aquí', async () => {
    const ajeno = await controlDb().eventAct.create({
      data: {
        eventId: otroEvento,
        type: 'ceremony',
        date: '2026-09-01',
        time: '18:00',
        timezone: 'Asia/Beirut',
        venueName: 'Otra',
        venueAddress: 'Beirut',
        venueMapUrl: 'https://m.example',
      },
      select: { id: true },
    });

    // El `actId` viaja en un campo oculto del formulario: es un dato del
    // cliente como cualquier otro.
    assert.deepEqual(
      await setTranslation(
        scope(), eventId, ajeno.id, 'en',
        { label: 'Secuestrada', description: '', venueName: '', venueAddress: '' },
        fixture.get().userId,
      ),
      { ok: false, reason: 'notFound' },
    );
    assert.equal(await controlDb().actTranslation.count({ where: { actId: ajeno.id } }), 0);
    // Y ni siquiera se dice que exista: no hay «ninguna traducción», hay nada.
    assert.equal(await readTranslations(scope(), eventId, ajeno.id), null);
  });

  it('la oficina de al lado tampoco traduce esta henna', async () => {
    const otraOficina = tenantScope(fixture.get().otherTenantId);
    assert.deepEqual(
      await setTranslation(
        otraOficina, eventId, henna, 'ar',
        { label: 'ليلة الحناء', description: '', venueName: '', venueAddress: '' },
        fixture.get().userId,
      ),
      { ok: false, reason: 'notFound' },
    );
    assert.equal(await controlDb().actTranslation.count({ where: { actId: henna } }), 0);
    assert.equal(await readTranslations(otraOficina, eventId, henna), null);
  });

  it('TRADUCIR NO CONCEDE PERMISOS: la agenda autoriza a los mismos', async () => {
    const tia = await invitado('Tía', `test-trad-${Date.now()}-1`);
    const colega = await invitado('Colega', `test-trad-${Date.now()}-2`);
    await enGrupo(tia.id);

    const antesTia = await agendaFor(scope(), eventId, tia);
    const antesColega = await agendaFor(scope(), eventId, colega);
    assert.deepEqual(antesTia.map((act) => act.id).sort(), [henna, cena].sort());
    assert.deepEqual(antesColega.map((act) => act.id), [cena]);

    // La henna, escrita en el idioma que lee el colega. Escribirla no lo mete
    // dentro: el idioma es cómo se lee un acto, no quién entra en él.
    await setTranslation(
      scope(), eventId, henna, 'en',
      { label: 'Henna night', description: '', venueName: '', venueAddress: '' },
      fixture.get().userId,
    );

    const despuesTia = await agendaFor(scope(), eventId, tia);
    const despuesColega = await agendaFor(scope(), eventId, colega);
    assert.deepEqual(
      despuesTia.map((act) => act.id).sort(),
      antesTia.map((act) => act.id).sort(),
      'traducir movió a quién autoriza la agenda',
    );
    assert.deepEqual(
      despuesColega.map((act) => act.id),
      [cena],
      'una traducción metió a alguien en una henna a la que no estaba invitado',
    );

    // A la tía, que sí entra, le llega con el nombre en su idioma.
    const suyos = await resolveActNames(scope(), despuesTia, 'en');
    assert.equal(suyos.get(henna)?.name, 'Henna night');
    // Y al colega no le aparece por mucho que se traduzca a los cuatro.
    const losSuyos = await resolveActNames(scope(), despuesColega, 'en');
    assert.equal(losSuyos.has(henna), false);
  });

  it('la cita del calendario se titula en el idioma del invitado', async () => {
    const tia = await invitado('Tía', `test-trad-${Date.now()}-3`);
    await enGrupo(tia.id);
    await setTranslation(
      scope(), eventId, henna, 'en',
      { label: 'Henna night', description: '', venueName: 'The house', venueAddress: 'Beirut' },
      fixture.get().userId,
    );

    const subject = (locale: 'en' | 'es'): CalendarSubject => ({
      locale,
      eventName: 'Boda',
      honorees: 'Karim · Layla',
      actTypeNames: getDictionary(locale).actTypes,
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

    const suyo = await calendarFor(scope(), eventId, subject('en'), { guestToken: tia.token });
    assert.equal(suyo.ok, true);
    const ics = suyo.ok ? suyo.ics : '';
    const resumenes = ics.split('\r\n').filter((line) => line.startsWith('SUMMARY:'));
    assert.ok(
      resumenes.some((line) => line.includes('Henna night')),
      'el calendario no tituló la henna en el idioma del invitado',
    );
    assert.ok(ics.includes('The house'), 'la sede traducida no llegó al archivo');

    // Y la misma boda en español sigue diciendo lo que dice el label.
    const enEspanol = await calendarFor(scope(), eventId, subject('es'), { guestToken: tia.token });
    assert.equal(enEspanol.ok, true);
    assert.ok(
      (enEspanol.ok ? enEspanol.ics : '')
        .split('\r\n')
        .filter((line) => line.startsWith('SUMMARY:'))
        .some((line) => line.includes('Noche de henna')),
    );
  });
});
