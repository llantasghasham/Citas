import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  campaignResults,
  previewCampaign,
  runCampaign,
  type CampaignInput,
} from '../src/lib/whatsapp/campaigns';
import { controlDb } from '../src/lib/db/client';
import { tenantScope } from '../src/lib/db/tenant';
import { getDictionary, interpolate } from '@citas/core';

import { HAS_DB, makeEvent, withDatabase } from './helpers';

/**
 * Las campañas: a quién le toca, a quién no y por qué.
 *
 * Lo que se prueba aquí es lo que hace que esto valga para algo más que
 * ahorrarse un botón:
 *
 *   - **Nadie sin permiso entra en la cola.** Una fila en la cola ya es un
 *     mensaje que el repartidor puede soltar, así que el filtro tiene que estar
 *     ANTES de escribirla y no después. Es la regla que separa «tengo su
 *     teléfono» de «me dio permiso».
 *   - **Lanzar dos veces no manda dos veces.** Y no porque el código lea antes
 *     de escribir —entre leer y escribir cabe otra petición— sino porque lo
 *     impide el índice único parcial de la base. Por eso se prueba con dos
 *     `runCampaign` a la vez y contra PostgreSQL de verdad: un doble que no
 *     implemente ese índice daría verde a justo lo que esto atrapa.
 *   - **Los excluidos se guardan con su motivo.** Una campaña que solo enseña a
 *     quién le llegó esconde lo único que hay que mirar.
 */

// La dirección del sitio la lee `setting()`, que cae al entorno cuando no hay
// fila guardada. Se pone por entorno y no en `Setting` a propósito: esa tabla es
// global y una prueba no tiene por qué tocar la configuración de la instalación.
process.env['NEXT_PUBLIC_SITE_URL'] = 'https://citas.example';

describe('las campañas de WhatsApp', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  const scope = () => tenantScope(fixture.get().tenantId);

  let eventId = '';
  let henna = '';
  let recepcion = '';
  let familia = '';
  let connectionId = '';

  /** Los teléfonos de la prueba, para poder limpiar sus permisos sin tocar más. */
  const PREFIJO = '+9617090';
  let siguiente = 0;
  const telefono = (): string => `${PREFIJO}${String(siguiente++).padStart(4, '0')}`;

  interface Invitado {
    id: string;
    phone: string | null;
    token: string;
    name: string;
  }

  const invitado = async (
    name: string,
    options: { phone?: string | null; locale?: 'ar' | 'es'; segmento?: string | null } = {},
  ): Promise<Invitado> => {
    const phone = options.phone === undefined ? telefono() : options.phone;
    const token = `test-camp-${Date.now()}-${siguiente++}`;
    const row = await controlDb().guest.create({
      data: {
        eventId,
        name,
        locale: options.locale ?? 'ar',
        token,
        phone,
      },
      select: { id: true, name: true, phone: true, token: true },
    });
    if (options.segmento !== undefined && options.segmento !== null) {
      await controlDb().guestSegment.create({
        data: { guestId: row.id, segmentId: options.segmento, eventId },
      });
    }
    return row;
  };

  /** Le da permiso para recibir su invitación por WhatsApp. */
  const conPermiso = async (phone: string, purpose: 'invitation' | 'reminder' = 'invitation') => {
    await controlDb().consent.create({
      data: {
        tenantId: fixture.get().tenantId,
        channel: 'whatsapp',
        purpose,
        contact: phone,
        source: 'prueba',
      },
    });
  };

  /** Y la baja, que gana siempre. */
  const deBaja = async (phone: string, purpose: 'invitation' | null = null) => {
    await controlDb().optOut.create({
      data: {
        tenantId: fixture.get().tenantId,
        channel: 'whatsapp',
        contact: phone,
        purpose,
        reason: 'prueba',
      },
    });
  };

  const input = (extra: Partial<CampaignInput> = {}): CampaignInput => ({
    eventId,
    actId: null,
    segmentId: null,
    kind: 'invitation',
    template: 'invitation',
    version: '1',
    connectionId,
    ...extra,
  });

  beforeEach(async () => {
    const prisma = controlDb();
    // Los permisos no cuelgan de ningún evento —cuelgan de la oficina y del
    // contacto— así que no se los lleva la limpieza general: se quitan aquí.
    await prisma.consent.deleteMany({ where: { contact: { startsWith: PREFIJO } } });
    await prisma.optOut.deleteMany({ where: { contact: { startsWith: PREFIJO } } });
    // Y el rastro del historial, que tampoco cuelga del evento.
    await prisma.auditLog.deleteMany({ where: { action: 'whatsapp.campaign.run' } });
    await prisma.whatsappMessage.deleteMany({});
    await prisma.whatsappConnection.deleteMany({});

    eventId = await makeEvent(fixture.get().tenantId);

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
    familia = f.id;
    await prisma.actAudience.create({ data: { actId: henna, segmentId: familia, eventId } });

    const connection = await prisma.whatsappConnection.create({
      data: {
        tenantId: fixture.get().tenantId,
        name: `N-${Math.random().toString(36).slice(2, 8)}`,
        status: 'connected',
        sentDay: new Date().toISOString().slice(0, 10),
      },
      select: { id: true },
    });
    connectionId = connection.id;
  });

  // ─────────────────────────────────────────────────────── la vista previa

  it('dice a quién le toca y a quién no, CON el motivo, sin escribir nada', async () => {
    const tia = await invitado('Tía', { segmento: familia });
    const colega = await invitado('Colega');
    const sinTelefono = await invitado('Sin teléfono', { phone: null });
    const dadoDeBaja = await invitado('De baja');
    const sinPermiso = await invitado('Sin permiso');

    await conPermiso(tia.phone ?? '');
    await conPermiso(colega.phone ?? '');
    await conPermiso(dadoDeBaja.phone ?? '');
    // La baja gana sobre el permiso, y por eso se le da primero el permiso.
    await deBaja(dadoDeBaja.phone ?? '');
    // `sinPermiso` no tiene fila de permiso: falla cerrado.

    const preview = await previewCampaign(scope(), input({ actId: henna }));
    assert.ok(!('error' in preview));

    // A la henna solo entra la familia. El resto ni siquiera llega a que se le
    // mire el teléfono: no está invitado a ese acto.
    assert.deepEqual(preview.included.map((row) => row.guestId), [tia.id]);
    assert.equal(preview.excludedBy.not_authorized, 4);

    // Y no ha escrito NADA.
    assert.equal(await controlDb().whatsappMessage.count({ where: { eventId } }), 0);
    assert.equal(await controlDb().messageCampaign.count({ where: { eventId } }), 0);

    // A la celebración entera —el acto principal, que es público— entran todos,
    // y ahí sí se ve cada motivo por separado.
    const entera = await previewCampaign(scope(), input());
    assert.ok(!('error' in entera));
    assert.deepEqual(entera.included.map((row) => row.guestId).sort(), [tia.id, colega.id].sort());
    assert.deepEqual(entera.excludedBy, {
      not_authorized: 0,
      no_phone: 1,
      opted_out: 1,
      no_consent: 1,
      already_sent: 0,
    });
    const motivoDe = new Map(entera.excluded.map((row) => [row.guest.guestId, row.reason]));
    assert.equal(motivoDe.get(sinTelefono.id), 'no_phone');
    assert.equal(motivoDe.get(dadoDeBaja.id), 'opted_out');
    assert.equal(motivoDe.get(sinPermiso.id), 'no_consent');
  });

  it('una baja SIN propósito tapa también la invitación', async () => {
    const rami = await invitado('Rami');
    await conPermiso(rami.phone ?? '');
    // `purpose: null` es «para todo», y es lo que escribe quien contesta STOP.
    await deBaja(rami.phone ?? '', null);

    const preview = await previewCampaign(scope(), input());
    assert.ok(!('error' in preview));
    assert.equal(preview.included.length, 0);
    assert.equal(preview.excludedBy.opted_out, 1);
  });

  it('el permiso es POR PROPÓSITO: el de la invitación no sirve de recordatorio', async () => {
    const rami = await invitado('Rami');
    await conPermiso(rami.phone ?? '', 'invitation');

    const invitacion = await previewCampaign(scope(), input());
    assert.ok(!('error' in invitacion));
    assert.deepEqual(invitacion.included.map((row) => row.guestId), [rami.id]);

    const recordatorio = await previewCampaign(
      scope(),
      input({ kind: 'reminder', template: 'reminder' }),
    );
    assert.ok(!('error' in recordatorio));
    assert.equal(recordatorio.included.length, 0);
    assert.equal(recordatorio.excludedBy.no_consent, 1);
  });

  it('el grupo ACOTA y no excluye: quien no va en la lista no sale como excluido', async () => {
    const tia = await invitado('Tía', { segmento: familia });
    await invitado('Colega');
    await conPermiso(tia.phone ?? '');

    const preview = await previewCampaign(scope(), input({ segmentId: familia }));
    assert.ok(!('error' in preview));
    assert.deepEqual(preview.included.map((row) => row.guestId), [tia.id]);
    // El colega no está en el grupo, así que esta campaña no iba con él: no se
    // le lista como excluido. Listarlo enterraría los motivos que sí importan.
    assert.equal(preview.excluded.length, 0);
  });

  it('un evento, un acto, un grupo o un número de otra oficina no existen', async () => {
    const ajena = tenantScope(fixture.get().otherTenantId);
    assert.deepEqual(await previewCampaign(ajena, input()), { error: 'notFound' });
    assert.deepEqual(
      await previewCampaign(scope(), input({ actId: 'no-existe' })),
      { error: 'notFound' },
    );
    assert.deepEqual(
      await previewCampaign(scope(), input({ segmentId: 'no-existe' })),
      { error: 'notFound' },
    );
    assert.deepEqual(
      await previewCampaign(scope(), input({ connectionId: 'no-existe' })),
      { error: 'notFound' },
    );
  });

  // ──────────────────────────────────────────────────────────── el lanzado

  it('NADIE sin permiso entra en la cola', async () => {
    const rami = await invitado('Rami');
    const sami = await invitado('Sami');
    const nadia = await invitado('Nadia');
    await conPermiso(rami.phone ?? '');
    await conPermiso(sami.phone ?? '');
    await deBaja(sami.phone ?? '');
    // Nadia no tiene permiso de ningún tipo.

    const result = await runCampaign(scope(), input(), fixture.get().userId);
    assert.ok(!('error' in result));
    assert.equal(result.queued, 1);

    // La comprobación que importa: en la cola solo está el que dio permiso. No
    // hay fila «cancelada» de los otros dos — no llegaron a escribirse.
    const cola = await controlDb().whatsappMessage.findMany({
      where: { eventId },
      select: { guestId: true, toPhone: true },
    });
    assert.deepEqual(cola.map((row) => row.guestId), [rami.id]);
    assert.ok(!cola.some((row) => row.toPhone === sami.phone));
    assert.ok(!cola.some((row) => row.toPhone === nadia.phone));

    // Y los dos que se quedaron fuera están apuntados CON su motivo.
    const recipients = await controlDb().messageRecipient.findMany({
      where: { campaignId: result.campaignId },
      select: { guestId: true, status: true, reason: true, messageId: true },
    });
    assert.equal(recipients.length, 3);
    const fila = new Map(recipients.map((row) => [row.guestId, row]));
    assert.equal(fila.get(sami.id)?.status, 'excluded');
    assert.equal(fila.get(sami.id)?.reason, 'opted_out');
    assert.equal(fila.get(nadia.id)?.reason, 'no_consent');
    assert.equal(fila.get(rami.id)?.status, 'queued');
    assert.ok(fila.get(rami.id)?.messageId !== null);
  });

  it('el mensaje va en el idioma DEL INVITADO, no en el de la oficina', async () => {
    const arabe = await invitado('رامي', { locale: 'ar' });
    const espanol = await invitado('Rami', { locale: 'es' });
    await conPermiso(arabe.phone ?? '');
    await conPermiso(espanol.phone ?? '');

    const result = await runCampaign(scope(), input(), fixture.get().userId);
    assert.ok(!('error' in result));
    assert.equal(result.queued, 2);

    const cola = await controlDb().whatsappMessage.findMany({
      where: { eventId },
      select: { guestId: true, body: true },
    });
    const cuerpoDe = new Map(cola.map((row) => [row.guestId, row.body]));
    assert.equal(
      cuerpoDe.get(arabe.id),
      interpolate(getDictionary('ar').share.whatsappMessage, {
        name: 'رامي',
        link: `https://citas.example/g/${arabe.token}`,
      }),
    );
    assert.equal(
      cuerpoDe.get(espanol.id),
      interpolate(getDictionary('es').share.whatsappMessage, {
        name: 'Rami',
        link: `https://citas.example/g/${espanol.token}`,
      }),
    );
  });

  it('queda en el historial con recuentos, y sin un solo teléfono', async () => {
    const rami = await invitado('Rami');
    await invitado('Sin permiso');
    await conPermiso(rami.phone ?? '');

    const result = await runCampaign(scope(), input(), fixture.get().userId);
    assert.ok(!('error' in result));

    const entry = await controlDb().auditLog.findFirstOrThrow({
      where: { action: 'whatsapp.campaign.run', entityId: result.campaignId },
      select: { actorId: true, tenantId: true, metadata: true },
    });
    assert.equal(entry.actorId, fixture.get().userId);
    assert.equal(entry.tenantId, fixture.get().tenantId);

    const escrito = JSON.stringify(entry.metadata);
    assert.match(escrito, /"queued":1/);
    assert.match(escrito, /"excluded_no_consent":1/);
    // Ni teléfonos ni nombres: el historial lo lee quien administra la
    // plataforma, y no tiene por qué ver la lista de invitados de una boda.
    assert.ok(!escrito.includes(PREFIJO));
    assert.ok(!escrito.includes('Rami'));
  });

  // ───────────────────────────────────────────────────────── la idempotencia

  it('dos lanzamientos A LA VEZ no mandan dos mensajes', async () => {
    const nombres = ['Rami', 'Sami', 'Nadia', 'Hala', 'Karim'];
    const invitados: Invitado[] = [];
    for (const nombre of nombres) {
      const guest = await invitado(nombre);
      await conPermiso(guest.phone ?? '');
      invitados.push(guest);
    }

    // Lo que de verdad se prueba: entre leer la cola y escribir en ella cabe
    // otra petición. Quien lo impide no es la lectura previa —los dos leen una
    // cola vacía— sino el índice único parcial de la base.
    const [uno, otro] = await Promise.all([
      runCampaign(scope(), input(), fixture.get().userId),
      runCampaign(scope(), input(), fixture.get().userId),
    ]);
    assert.ok(!('error' in uno));
    assert.ok(!('error' in otro));

    // Una fila por invitado, ni una más.
    const cola = await controlDb().whatsappMessage.findMany({
      where: { eventId },
      select: { guestId: true },
    });
    assert.equal(cola.length, invitados.length);
    assert.equal(new Set(cola.map((row) => row.guestId)).size, invitados.length);

    // Y entre las dos campañas suman exactamente esas cinco: el perdedor de la
    // carrera NO dice haber encolado lo que escribió el otro.
    assert.equal(uno.queued + otro.queued, invitados.length);
    assert.equal(uno.excludedBy.already_sent + otro.excludedBy.already_sent, invitados.length);

    // Las dos campañas apuntan a los cinco, cada una con lo que le tocó.
    for (const campaignId of [uno.campaignId, otro.campaignId]) {
      const results = await campaignResults(scope(), campaignId);
      assert.ok(results !== null);
      assert.equal(results.total, invitados.length);
      assert.equal(results.byStatus.queued + results.excludedBy.already_sent, invitados.length);
    }
  });

  it('lanzarla otra vez no reencola a nadie: todos quedan «already_sent»', async () => {
    const rami = await invitado('Rami');
    await conPermiso(rami.phone ?? '');

    const primera = await runCampaign(scope(), input(), fixture.get().userId);
    assert.ok(!('error' in primera));
    assert.equal(primera.queued, 1);

    const segunda = await runCampaign(scope(), input(), fixture.get().userId);
    assert.ok(!('error' in segunda));
    assert.equal(segunda.queued, 0);
    assert.equal(segunda.excludedBy.already_sent, 1);
    assert.equal(await controlDb().whatsappMessage.count({ where: { eventId } }), 1);
  });

  it('un mensaje YA ENVIADO tampoco se reenvía con la misma plantilla', async () => {
    const rami = await invitado('Rami');
    await conPermiso(rami.phone ?? '');

    const primera = await runCampaign(scope(), input(), fixture.get().userId);
    assert.ok(!('error' in primera));
    // Ya salió: el índice de la base deja de proteger —solo cubre `queued` y
    // `processing`— y a partir de aquí lo que no lo reenvía es el código.
    await controlDb().whatsappMessage.updateMany({
      where: { eventId },
      data: { status: 'sent', sentAt: new Date() },
    });

    const segunda = await runCampaign(scope(), input(), fixture.get().userId);
    assert.ok(!('error' in segunda));
    assert.equal(segunda.queued, 0);
    assert.equal(segunda.excludedBy.already_sent, 1);
  });

  it('una VERSIÓN nueva de la plantilla sí vuelve a escribir', async () => {
    const rami = await invitado('Rami');
    await conPermiso(rami.phone ?? '');

    const primera = await runCampaign(scope(), input({ version: '1' }), fixture.get().userId);
    assert.ok(!('error' in primera));
    await controlDb().whatsappMessage.updateMany({
      where: { eventId },
      data: { status: 'sent', sentAt: new Date() },
    });

    // Cambiar el texto es una plantilla NUEVA, y la clave contra duplicados la
    // lleva dentro: escribirle a alguien con el texto corregido es una decisión
    // legítima, no un duplicado.
    const segunda = await runCampaign(scope(), input({ version: '2' }), fixture.get().userId);
    assert.ok(!('error' in segunda));
    assert.equal(segunda.queued, 1);
    assert.equal(await controlDb().whatsappMessage.count({ where: { eventId } }), 2);
  });

  it('la invitación y el recordatorio son cosas distintas y conviven', async () => {
    const rami = await invitado('Rami');
    await conPermiso(rami.phone ?? '', 'invitation');
    await conPermiso(rami.phone ?? '', 'reminder');

    const invitacion = await runCampaign(scope(), input(), fixture.get().userId);
    assert.ok(!('error' in invitacion));
    const recordatorio = await runCampaign(
      scope(),
      input({ kind: 'reminder', template: 'reminder' }),
      fixture.get().userId,
    );
    assert.ok(!('error' in recordatorio));

    assert.equal(invitacion.queued, 1);
    assert.equal(recordatorio.queued, 1);
    assert.equal(await controlDb().whatsappMessage.count({ where: { eventId } }), 2);
  });

  it('la misma persona recibe la henna Y la recepción: el acto entra en la clave', async () => {
    const tia = await invitado('Tía', { segmento: familia });
    await conPermiso(tia.phone ?? '');

    const dela = await runCampaign(scope(), input({ actId: henna }), fixture.get().userId);
    assert.ok(!('error' in dela));
    const dela2 = await runCampaign(scope(), input({ actId: recepcion }), fixture.get().userId);
    assert.ok(!('error' in dela2));

    assert.equal(dela.queued, 1);
    assert.equal(dela2.queued, 1);
    const cola = await controlDb().whatsappMessage.findMany({
      where: { eventId },
      select: { actId: true },
    });
    assert.deepEqual(cola.map((row) => row.actId).sort(), [henna, recepcion].sort());
  });

  // ───────────────────────────────────────────────────────────── el resultado

  it('el resultado agrupa por estado y por motivo, y lee la cola de verdad', async () => {
    const rami = await invitado('Rami');
    const sami = await invitado('Sami');
    await invitado('Sin teléfono', { phone: null });
    await invitado('Sin permiso');
    await conPermiso(rami.phone ?? '');
    await conPermiso(sami.phone ?? '');

    const result = await runCampaign(scope(), input(), fixture.get().userId);
    assert.ok(!('error' in result));

    // Uno sale y el otro falla: el estado de la COLA cambia, el de «a quién le
    // tocaba» no. Son dos preguntas distintas y se contestan por separado.
    const cola = await controlDb().whatsappMessage.findMany({
      where: { eventId },
      orderBy: { toPhone: 'asc' },
      select: { id: true },
    });
    await controlDb().whatsappMessage.update({
      where: { id: cola[0]?.id ?? '' },
      data: { status: 'sent' },
    });

    const results = await campaignResults(scope(), result.campaignId);
    assert.ok(results !== null);
    assert.equal(results.total, 4);
    assert.equal(results.byStatus.queued, 2);
    assert.equal(results.byStatus.excluded, 2);
    assert.deepEqual(results.excludedBy, {
      not_authorized: 0,
      no_phone: 1,
      opted_out: 0,
      no_consent: 1,
      already_sent: 0,
    });
    assert.deepEqual(results.delivery, { sent: 1, queued: 1 });
    assert.equal(results.status, 'queued');
  });

  it('una campaña de otra oficina no existe', async () => {
    const rami = await invitado('Rami');
    await conPermiso(rami.phone ?? '');
    const result = await runCampaign(scope(), input(), fixture.get().userId);
    assert.ok(!('error' in result));

    const ajena = tenantScope(fixture.get().otherTenantId);
    assert.equal(await campaignResults(ajena, result.campaignId), null);
  });
});
