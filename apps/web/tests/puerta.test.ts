import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  PREFERENCE_KEYS,
  preferenceReport,
  readPreferences,
  setPreference,
} from '../src/lib/checkin/preferences';
import { checkIn, gateCode, gateList, revokeCheckIn } from '../src/lib/checkin/service';
import { controlDb } from '../src/lib/db/client';
import { tenantScope } from '../src/lib/db/tenant';

import { HAS_DB, makeEvent, withDatabase } from './helpers';

/**
 * La puerta de un acto: el QR, quién pasa y quién no.
 *
 * Lo que se prueba aquí no es una pantalla: es lo que pasa cuando hay cien
 * personas en la puerta de una boda, dos operadores con dos móviles y un
 * invitado que enseña el código de otro acto. Equivocarse aquí no se arregla
 * después — a quien entró ya no se le saca, y a quien se dejó fuera ya no se le
 * invita.
 *
 * Contra PostgreSQL de verdad y no contra un doble, por lo de siempre: que solo
 * una de dos entradas simultáneas gane lo impide el ÍNDICE ÚNICO, no una
 * lectura previa. Un doble que no lo implemente daría verde justo al fallo que
 * esta prueba existe para atrapar.
 */
describe('la puerta', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  const scope = () => tenantScope(fixture.get().tenantId);

  let eventId = '';
  let henna = '';
  let recepcion = '';
  let familia = '';
  let trabajo = '';

  interface Invitado {
    id: string;
    token: string;
    maxParty: number;
  }

  let contador = 0;
  const invitado = async (name: string, maxParty = 1): Promise<Invitado> => {
    contador += 1;
    return controlDb().guest.create({
      data: {
        eventId,
        name,
        locale: 'ar',
        token: `test-puerta-${Date.now()}-${contador}`,
        maxParty,
      },
      select: { id: true, token: true, maxParty: true },
    });
  };

  const enGrupo = async (guestId: string, segmentId: string): Promise<void> => {
    await controlDb().guestSegment.create({ data: { guestId, segmentId, eventId } });
  };

  beforeEach(async () => {
    const prisma = controlDb();
    // El historial no se limpia solo entre pruebas (`clean()` solo se lleva lo
    // del cobro), y aquí se cuentan sus filas: sin esto, lo que anotó la prueba
    // anterior se suma a la siguiente.
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'checkin.' } } });
    eventId = await makeEvent(fixture.get().tenantId);

    const h = await prisma.eventAct.create({
      data: {
        eventId, type: 'henna', order: 0, date: '2026-07-02', time: '20:00',
        timezone: 'Asia/Beirut', venueName: 'Casa', venueAddress: 'Beirut',
        venueMapUrl: 'https://m.example', visibility: 'segmented',
      },
      select: { id: true },
    });
    const r = await prisma.eventAct.create({
      data: {
        eventId, type: 'reception', order: 1, date: '2026-07-04', time: '20:00',
        timezone: 'Asia/Beirut', venueName: 'Salon', venueAddress: 'Beirut',
        venueMapUrl: 'https://m.example', visibility: 'public', isMain: true,
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

  it('un código fabricado a mano no entra', async () => {
    const tia = await invitado('Tía');
    await enGrupo(tia.id, familia);

    // Sin forma de código.
    assert.deepEqual(await checkIn(scope(), eventId, { code: 'hola', actId: henna }), {
      ok: false, reason: 'bad_code',
    });
    // Con la forma correcta y la firma inventada: el token del invitado se lee
    // de un enlace que se reenvía por WhatsApp, así que tenerlo no puede bastar.
    assert.deepEqual(
      await checkIn(scope(), eventId, { code: `g1.${tia.token}.AAAAAAAAAAAAAAAA`, actId: henna }),
      { ok: false, reason: 'bad_code' },
    );
    // Y una firma NUESTRA, pero de otro acto: el id del acto va dentro de la
    // firma, así que el QR de la recepción no abre la puerta de la henna.
    assert.deepEqual(
      await checkIn(scope(), eventId, { code: gateCode(tia.token, recepcion), actId: henna }),
      { ok: false, reason: 'bad_code' },
    );

    assert.equal(await controlDb().checkIn.count({ where: { eventId } }), 0);
  });

  it('el invitado de otra boda responde lo mismo que un código inventado', async () => {
    const otroEvento = await makeEvent(fixture.get().tenantId);
    const ajeno = await controlDb().guest.create({
      data: { eventId: otroEvento, name: 'Ajeno', locale: 'ar', token: `test-puerta-x-${Date.now()}` },
      select: { token: true },
    });

    // No «no invitado», que ya diría que ese token existe en algún sitio.
    assert.deepEqual(
      await checkIn(scope(), eventId, { code: gateCode(ajeno.token, henna), actId: henna }),
      { ok: false, reason: 'bad_code' },
    );
  });

  it('el invitado de otro acto no entra aunque su código verifique', async () => {
    const colega = await invitado('Colega');
    await enGrupo(colega.id, trabajo);

    // El código IDENTIFICA, no autoriza: quien decide sigue siendo la regla de
    // `lib/acts/access.ts`, y a la henna solo entra la familia.
    assert.deepEqual(
      await checkIn(scope(), eventId, { code: gateCode(colega.token, henna), actId: henna }),
      { ok: false, reason: 'not_invited' },
    );
    // Y a la recepción, que es pública, el mismo señor entra sin más.
    const entra = await checkIn(scope(), eventId, {
      code: gateCode(colega.token, recepcion),
      actId: recepcion,
    });
    assert.equal(entra.ok, true);
  });

  it('una exclusión posterior cierra la puerta aunque el QR ya esté impreso', async () => {
    const tio = await invitado('Tío');
    await enGrupo(tio.id, familia);
    const suCodigo = gateCode(tio.token, henna);

    // El código se derivó cuando estaba invitado y sigue verificando: por eso
    // la autorización se comprueba al pasar, y no al imprimir.
    await controlDb().guestActInvite.create({
      data: { guestId: tio.id, actId: henna, eventId, excluded: true },
    });

    assert.deepEqual(await checkIn(scope(), eventId, { code: suCodigo, actId: henna }), {
      ok: false, reason: 'not_invited',
    });
  });

  it('más gente de la autorizada PARA ESE ACTO no entra', async () => {
    const prima = await invitado('Prima', 4);
    await enGrupo(prima.id, familia);
    // Cuatro en la boda, dos en la henna: el tope es el del ACTO.
    await controlDb().guestActInvite.create({
      data: { guestId: prima.id, actId: henna, eventId, maxParty: 2 },
    });

    assert.deepEqual(
      await checkIn(scope(), eventId, { code: gateCode(prima.token, henna), actId: henna, people: 3 }),
      { ok: false, reason: 'too_many', allowed: 2 },
    );
    assert.equal(await controlDb().checkIn.count({ where: { eventId } }), 0);

    const dos = await checkIn(scope(), eventId, {
      code: gateCode(prima.token, henna),
      actId: henna,
      people: 2,
    });
    assert.equal(dos.ok, true);
    assert.equal(dos.ok ? dos.guest.people : 0, 2);
  });

  it('el segundo intento dice «ya entró», con su hora y nada más', async () => {
    const tia = await invitado('Tía', 2);
    await enGrupo(tia.id, familia);
    const codigo = gateCode(tia.token, henna);

    const primera = await checkIn(scope(), eventId, { code: codigo, actId: henna, people: 2 });
    assert.equal(primera.ok, true);

    const segunda = await checkIn(scope(), eventId, { code: codigo, actId: henna, people: 2 });
    assert.equal(segunda.ok, false);
    assert.equal(segunda.ok === false ? segunda.reason : '', 'already_checked_in');

    const fila = await controlDb().checkIn.findFirstOrThrow({
      where: { actId: henna, guestId: tia.id },
      select: { createdAt: true },
    });
    assert.deepEqual(segunda, { ok: false, reason: 'already_checked_in', at: fila.createdAt });
    // Y NADA más: en una puerta hay gente delante mirando la pantalla. Ni con
    // quién vino, ni qué contestó, ni en qué mesa se sienta.
    assert.deepEqual(Object.keys(segunda).sort(), ['at', 'ok', 'reason']);
  });

  it('dos lecturas del mismo QR a la vez: solo una entra', async () => {
    const rami = await invitado('Rami', 3);
    await enGrupo(rami.id, familia);
    const codigo = gateCode(rami.token, henna);

    // Dos operadores con dos móviles. Los dos pasan la lectura previa; lo único
    // que hay entre esto y contar dos veces a la misma persona es el índice
    // único `(actId, guestId)`.
    const [una, otra] = await Promise.all([
      checkIn(scope(), eventId, { code: codigo, actId: henna, people: 3, gate: 'A' }),
      checkIn(scope(), eventId, { code: codigo, actId: henna, people: 3, gate: 'B' }),
    ]);

    const ganadas = [una, otra].filter((result) => result.ok);
    assert.equal(ganadas.length, 1, 'entraron las dos');
    const perdida = [una, otra].find((result) => !result.ok);
    assert.equal(perdida !== undefined && !perdida.ok ? perdida.reason : '', 'already_checked_in');
    assert.equal(await controlDb().checkIn.count({ where: { actId: henna } }), 1);
  });

  it('revocar deshace la entrada, queda en el historial y se puede volver a entrar', async () => {
    const prisma = controlDb();
    const nour = await invitado('Nour', 2);
    await enGrupo(nour.id, familia);
    const codigo = gateCode(nour.token, henna);
    const operador = fixture.get().userId;

    assert.equal(
      (await checkIn(scope(), eventId, { code: codigo, actId: henna, people: 2, operatorId: operador })).ok,
      true,
    );
    assert.equal(await prisma.auditLog.count({ where: { action: 'checkin.enter' } }), 1);

    // El acto tiene que ser de este evento: el id viaja en el formulario.
    assert.equal(await revokeCheckIn(scope(), eventId, recepcion, nour.id, operador), false);
    assert.equal(await revokeCheckIn(scope(), eventId, henna, nour.id, operador), true);
    assert.equal(await prisma.checkIn.count({ where: { actId: henna } }), 0);
    assert.equal(await prisma.auditLog.count({ where: { action: 'checkin.revoke' } }), 1);

    // Y revocar lo que ya no está no revoca nada, sin reventar.
    assert.equal(await revokeCheckIn(scope(), eventId, henna, nour.id, operador), false);

    // Deshecha la equivocación, se vuelve a entrar por la puerta.
    const otraVez = await checkIn(scope(), eventId, { code: codigo, actId: henna, people: 1 });
    assert.equal(otraVez.ok, true);
  });

  it('la lista de la puerta dice quién ha entrado y quién falta', async () => {
    const prisma = controlDb();
    const tia = await invitado('Tía', 3);
    const prima = await invitado('Prima');
    await enGrupo(tia.id, familia);
    await enGrupo(prima.id, familia);
    // Una mesa, para que la puerta pueda decirle dónde se sienta.
    const mesa = await prisma.table.create({
      data: { eventId, name: 'Mesa 1', seats: 10 },
      select: { id: true },
    });
    await prisma.guest.update({ where: { id: tia.id }, data: { tableId: mesa.id } });

    const entrada = await checkIn(scope(), eventId, {
      code: gateCode(tia.token, henna),
      actId: henna,
      people: 3,
      gate: 'Principal',
    });
    assert.equal(entrada.ok, true);
    assert.equal(entrada.ok ? entrada.seated : '', 'Mesa 1');

    const lista = await gateList(scope(), eventId, henna);
    assert.ok(lista !== null);
    assert.deepEqual(lista.inside.map((row) => row.name), ['Tía']);
    assert.deepEqual(lista.pending.map((row) => row.name), ['Prima']);
    assert.equal(lista.headcount, 3);
    assert.equal(lista.inside[0]?.gate, 'Principal');
    assert.equal(lista.inside[0]?.table, 'Mesa 1');

    // Quien ya entró sigue en la lista aunque le quiten el acto después: está
    // dentro del salón, y esconderlo solo deja sin revocar una entrada real.
    await prisma.guestActInvite.create({
      data: { guestId: tia.id, actId: henna, eventId, excluded: true },
    });
    const despues = await gateList(scope(), eventId, henna);
    assert.deepEqual(despues?.inside.map((row) => row.name), ['Tía']);

    // Y el acto de otra boda no tiene lista desde aquí.
    const otroEvento = await makeEvent(fixture.get().tenantId);
    assert.equal(await gateList(scope(), otroEvento, henna), null);
  });
});

/**
 * Las preferencias: lo que hace falta para servir una cena, y nada más.
 *
 * La lista de claves es CERRADA porque esto son datos de salud de gente que no
 * tiene cuenta aquí. Que una clave inventada no se guarde no es un detalle de
 * validación: es la regla entera.
 */
describe('las preferencias', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  const scope = () => tenantScope(fixture.get().tenantId);

  let eventId = '';
  let cena = '';
  let familia = '';

  let contador = 0;
  const invitado = async (name: string, enFamilia = true): Promise<{ id: string }> => {
    contador += 1;
    const guest = await controlDb().guest.create({
      data: { eventId, name, locale: 'ar', token: `test-pref-${Date.now()}-${contador}` },
      select: { id: true },
    });
    if (enFamilia) {
      await controlDb().guestSegment.create({
        data: { guestId: guest.id, segmentId: familia, eventId },
      });
    }
    return guest;
  };

  beforeEach(async () => {
    const prisma = controlDb();
    eventId = await makeEvent(fixture.get().tenantId);
    const acto = await prisma.eventAct.create({
      data: {
        eventId, type: 'dinner', order: 0, date: '2026-07-04', time: '21:00',
        timezone: 'Asia/Beirut', venueName: 'Salon', venueAddress: 'Beirut',
        venueMapUrl: 'https://m.example', visibility: 'segmented',
      },
      select: { id: true },
    });
    cena = acto.id;
    const f = await prisma.audienceSegment.create({
      data: { eventId, key: 'familia', name: 'Familia' },
      select: { id: true },
    });
    familia = f.id;
    await prisma.actAudience.create({ data: { actId: cena, segmentId: familia, eventId } });
  });

  it('la lista de claves es cerrada', async () => {
    const rami = await invitado('Rami');
    assert.deepEqual(PREFERENCE_KEYS, ['diet', 'transport', 'accessibility', 'photos']);

    // Ni «religion», ni «notas», ni nada que a nadie se le ocurrió limitar.
    assert.deepEqual(
      await setPreference(scope(), eventId, rami.id, { key: 'religion', value: 'ninguna' }),
      { ok: false, reason: 'bad_key' },
    );
    assert.equal(await controlDb().guestPreference.count({ where: { eventId } }), 0);
  });

  it('la lista de RESPUESTAS también es cerrada', async () => {
    const rami = await invitado('Rami');

    // Lo que el catering suma es el código, no lo que alguien escribió en el
    // móvil: «celíaca desde 2019» no es una respuesta, es un diagnóstico.
    assert.deepEqual(
      await setPreference(scope(), eventId, rami.id, {
        key: 'diet',
        value: 'celiaca desde 2019',
      }),
      { ok: false, reason: 'bad_value' },
    );

    // Y un valor de otra clave tampoco: «shuttle» no es una dieta.
    assert.deepEqual(
      await setPreference(scope(), eventId, rami.id, { key: 'diet', value: 'shuttle' }),
      { ok: false, reason: 'bad_value' },
    );

    assert.equal(await controlDb().guestPreference.count({ where: { guestId: rami.id } }), 0);
  });

  it('el invitado de otra boda no guarda nada', async () => {
    const otroEvento = await makeEvent(fixture.get().tenantId);
    const ajeno = await controlDb().guest.create({
      data: { eventId: otroEvento, name: 'Ajeno', locale: 'ar', token: `test-pref-x-${Date.now()}` },
      select: { id: true },
    });

    assert.deepEqual(
      await setPreference(scope(), eventId, ajeno.id, { key: 'diet', value: 'gluten_free' }),
      { ok: false, reason: 'not_found' },
    );
    assert.equal(await readPreferences(scope(), eventId, ajeno.id), null);
  });

  it('se guarda, se reescribe y vaciarla la borra', async () => {
    const nour = await invitado('Nour');

    assert.deepEqual(
      await setPreference(scope(), eventId, nour.id, { key: 'diet', value: '  gluten_free ' }),
      { ok: true },
    );
    // El espacio de sobra de un envío a mano se recorta: el valor es el código,
    // no lo que rodea al código.
    assert.deepEqual(
      (await readPreferences(scope(), eventId, nour.id))?.map((row) => [row.key, row.value]),
      [['diet', 'gluten_free']],
    );

    // La segunda vez actualiza, no crea otra: la clave es (invitado, acto, clave).
    await setPreference(scope(), eventId, nour.id, { key: 'diet', value: 'vegetarian' });
    assert.equal(await controlDb().guestPreference.count({ where: { guestId: nour.id } }), 1);

    // Vaciar RETIRA lo dicho: no deja una fila vacía diciendo que un día se
    // contestó algo sobre la dieta de alguien.
    await setPreference(scope(), eventId, nour.id, { key: 'diet', value: '' });
    assert.deepEqual(await readPreferences(scope(), eventId, nour.id), []);
  });

  it('lo del acto convive con lo general y no es la misma fila', async () => {
    const layla = await invitado('Layla');
    await setPreference(scope(), eventId, layla.id, { key: 'diet', value: 'vegetarian' });
    await setPreference(scope(), eventId, layla.id, { actId: cena, key: 'diet', value: 'gluten_free' });

    const suyas = await readPreferences(scope(), eventId, layla.id);
    assert.equal(suyas?.length, 2);

    // Y un acto que no es de esta boda no guarda nada.
    const otroEvento = await makeEvent(fixture.get().tenantId);
    const ajeno = await controlDb().eventAct.create({
      data: {
        eventId: otroEvento, type: 'dinner', date: '2026-08-01', time: '21:00',
        timezone: 'Asia/Beirut', venueName: 'Otra', venueAddress: 'Beirut',
        venueMapUrl: 'https://m.example',
      },
      select: { id: true },
    });
    assert.deepEqual(
      await setPreference(scope(), eventId, layla.id, {
        actId: ajeno.id, key: 'diet', value: 'gluten_free',
      }),
      { ok: false, reason: 'not_found' },
    );
  });

  it('el informe del catering: cuenta una vez, y lo del acto manda', async () => {
    const rami = await invitado('Rami');
    const layla = await invitado('Layla');
    const nour = await invitado('Nour');
    // Este no entra a la cena: su dieta no la compra el catering de la cena.
    const colega = await invitado('Colega', false);

    await setPreference(scope(), eventId, rami.id, { key: 'diet', value: 'gluten_free' });
    // Vegetariana para toda la boda, sin gluten EN LA CENA: cuenta una vez, y
    // en la cena cuenta como sin gluten.
    await setPreference(scope(), eventId, layla.id, { key: 'diet', value: 'vegetarian' });
    await setPreference(scope(), eventId, layla.id, { actId: cena, key: 'diet', value: 'gluten_free' });
    await setPreference(scope(), eventId, colega.id, { key: 'diet', value: 'lactose_free' });

    const deLaCena = await preferenceReport(scope(), eventId, cena, 'diet');
    assert.deepEqual(deLaCena, {
      key: 'diet',
      actId: cena,
      guests: 3,
      answered: 2,
      values: [{ value: 'gluten_free', count: 2 }],
    });
    // Nour está invitado y no ha dicho nada: cuenta como invitado, no como
    // respuesta. Un informe que solo contara a los que contestaron no le diría
    // al catering a cuántos le falta preguntar.
    assert.deepEqual(await readPreferences(scope(), eventId, nour.id), []);

    // Sin acto se pregunta por toda la celebración, y ahí sí cuenta la general
    // de cada uno, el de trabajo incluido.
    const general = await preferenceReport(scope(), eventId, null, 'diet');
    assert.equal(general?.guests, 4);
    assert.deepEqual(general?.values, [
      { value: 'gluten_free', count: 1 },
      { value: 'lactose_free', count: 1 },
      { value: 'vegetarian', count: 1 },
    ]);

    // Una clave que no está en la lista no tiene informe.
    assert.equal(await preferenceReport(scope(), eventId, cena, 'religion'), null);
    // Ni un evento de otra oficina.
    assert.equal(
      await preferenceReport(tenantScope(fixture.get().otherTenantId), eventId, cena, 'diet'),
      null,
    );
  });
});
