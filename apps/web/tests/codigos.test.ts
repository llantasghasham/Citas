import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { codeSheet, gateQrSvg } from '../src/lib/checkin/codes';
import { gateCode, readGateCode } from '../src/lib/checkin/service';
import { controlDb } from '../src/lib/db/client';
import { tenantScope } from '../src/lib/db/tenant';

import { HAS_DB, makeEvent, withDatabase } from './helpers';

/**
 * La IMAGEN del código de la puerta.
 *
 * El código ya se comprobaba; lo que se comprueba aquí es que el papel que se
 * lleva a la puerta sirva para lo que dice servir. Tres cosas, y las tres
 * cuestan una cola delante de la puerta si fallan:
 *
 *   1. Que salga un QR de verdad y no una cadena vacía.
 *   2. Que lo que lleva dentro lo acepte la puerta PARA ESE ACTO, y no para
 *      otro: el de la recepción no abre la henna.
 *   3. Que no se imprima el de quien no entra. Un QR que la puerta va a
 *      rechazar es peor que no darlo: se descubre con gente esperando.
 */
describe('los códigos para imprimir', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  const scope = () => tenantScope(fixture.get().tenantId);

  let eventId = '';
  let henna = '';
  let recepcion = '';
  let familia = '';
  let trabajo = '';

  const invitado = async (name: string, token: string): Promise<{ id: string; token: string }> => {
    const row = await controlDb().guest.create({
      data: { eventId, name, locale: 'ar', token },
      select: { id: true, token: true },
    });
    return row;
  };

  const enGrupo = async (guestId: string, segmentId: string): Promise<void> => {
    await controlDb().guestSegment.create({ data: { guestId, segmentId, eventId } });
  };

  beforeEach(async () => {
    const prisma = controlDb();
    eventId = await makeEvent(fixture.get().tenantId);

    // Una henna privada y una recepción pública: el QR de una no abre la otra.
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

  it('el QR que sale es un QR, y lleva dentro el código de ESE acto', async () => {
    const tia = await invitado('Tía', `test-cod-${Date.now()}-1`);
    await enGrupo(tia.id, familia);

    const hoja = await codeSheet(scope(), eventId, henna);
    assert.ok(hoja !== null, 'la hoja de un acto propio no debería ser nula');
    const suyo = hoja.rows.find((row) => row.guestId === tia.id);
    assert.ok(suyo !== undefined, 'la familia no salió en la hoja de la henna');

    // Un SVG y no una cadena vacía: es lo que se va a imprimir.
    assert.ok(suyo.svg.startsWith('<svg'), `no parece un SVG: ${suyo.svg.slice(0, 40)}`);
    assert.match(suyo.svg, /<path/);

    // Y lo que lleva dentro lo acepta la puerta, para este invitado.
    assert.equal(readGateCode(suyo.code, henna), tia.token);
  });

  it('el de la henna no abre la recepción', async () => {
    const tia = await invitado('Tía', `test-cod-${Date.now()}-2`);
    await enGrupo(tia.id, familia);

    const hoja = await codeSheet(scope(), eventId, henna);
    const suyo = hoja?.rows.find((row) => row.guestId === tia.id);
    assert.ok(suyo !== undefined);

    // El id del acto va DENTRO de la firma: son dos puertas, dos listas y a
    // veces dos días distintos.
    assert.equal(readGateCode(suyo.code, recepcion), null);

    // Y al revés: el de la recepción tampoco abre la henna.
    const otra = await codeSheet(scope(), eventId, recepcion);
    const deRecepcion = otra?.rows.find((row) => row.guestId === tia.id);
    assert.ok(deRecepcion !== undefined);
    assert.equal(readGateCode(deRecepcion.code, henna), null);
    assert.equal(readGateCode(deRecepcion.code, recepcion), tia.token);
  });

  it('a quien no entra no se le imprime un QR', async () => {
    const colega = await invitado('Colega', `test-cod-${Date.now()}-3`);
    await enGrupo(colega.id, trabajo);

    // Un papel que la puerta va a rechazar es peor que no darlo: se descubre
    // con gente esperando detrás.
    const hoja = await codeSheet(scope(), eventId, henna);
    assert.deepEqual(hoja?.rows.map((row) => row.guestId), []);

    // La recepción es pública, así que ahí sí sale — y con su código bueno.
    const abierta = await codeSheet(scope(), eventId, recepcion);
    const suyo = abierta?.rows.find((row) => row.guestId === colega.id);
    assert.ok(suyo !== undefined, 'un acto público no llegó a la hoja');
    assert.equal(readGateCode(suyo.code, recepcion), colega.token);
  });

  it('una exclusión con nombre saca a alguien de la hoja', async () => {
    const tio = await invitado('Tío', `test-cod-${Date.now()}-4`);
    await enGrupo(tio.id, familia);
    await controlDb().guestActInvite.create({
      data: { guestId: tio.id, actId: henna, eventId, excluded: true },
    });

    // La regla es la de siempre, la de `lib/acts/access.ts`: no hay una segunda
    // escrita aquí que un día diga otra cosa.
    const hoja = await codeSheet(scope(), eventId, henna);
    assert.deepEqual(hoja?.rows.map((row) => row.guestId), []);
  });

  it('el acto de otra boda no tiene hoja desde aquí', async () => {
    const otroEvento = await makeEvent(fixture.get().tenantId);
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
        visibility: 'public',
      },
      select: { id: true },
    });

    // Los dos ids vienen de la dirección. «No existe» y «no es tuyo» se
    // responden igual.
    assert.equal(await codeSheet(scope(), eventId, ajeno.id), null);
    assert.equal(await codeSheet(scope(), eventId, 'no-existe'), null);
  });

  it('la hoja de una oficina ajena no existe', async () => {
    const otra = tenantScope(fixture.get().otherTenantId);
    assert.equal(await codeSheet(otra, eventId, henna), null);
  });
});

describe('el dibujo del QR', () => {
  it('un código cualquiera sale como SVG', async () => {
    const svg = await gateQrSvg(gateCode('un-token-de-prueba', 'un-acto'));
    assert.ok(svg.startsWith('<svg'), `no parece un SVG: ${svg.slice(0, 40)}`);
    // Sin ancho ni alto fijos: va a papel y lo escala la hoja, no el mapa de
    // bits.
    assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  });
});
