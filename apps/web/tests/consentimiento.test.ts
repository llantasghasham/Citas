import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import {
  consentSummary,
  grantConsent,
  mayContact,
  mayContactMany,
  normalizeContact,
  optOut,
  revokeConsent,
} from '../src/lib/consent/service';
import { purgeAfterEvent, retentionCandidates } from '../src/lib/consent/retention';
import { controlDb } from '../src/lib/db/client';
import { tenantScope } from '../src/lib/db/tenant';

import { HAS_DB, makeEvent, withDatabase } from './helpers';

/**
 * El permiso para escribirle a alguien, la baja y lo que se tira cuando la boda
 * ya pasó.
 *
 * Lo que se prueba aquí es que la puerta falla CERRADA. Un «no» de más se
 * arregla pidiéndole permiso a esa persona; un «sí» de más es un mensaje que ya
 * salió del teléfono de un cliente, y eso no se arregla.
 */
describe('a quién se le puede escribir', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();
  const scope = () => tenantScope(fixture.get().tenantId);
  const otro = () => tenantScope(fixture.get().otherTenantId);

  const TELEFONO = '+96170555001';

  /**
   * Las tablas de consentimiento no las limpia `clean()`, así que se limpia
   * aquí — y solo lo de estas dos oficinas, que es lo único que esta prueba
   * escribe.
   */
  const limpiar = async (): Promise<void> => {
    const prisma = controlDb();
    const tenants = [fixture.get().tenantId, fixture.get().otherTenantId];
    await prisma.consent.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.optOut.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.auditLog.deleteMany({
      where: { tenantId: { in: tenants }, action: { startsWith: 'consent.' } },
    });
    await prisma.auditLog.deleteMany({
      where: { tenantId: { in: tenants }, action: { startsWith: 'retention.' } },
    });
  };

  beforeEach(limpiar);

  after(async () => {
    await limpiar();
    await controlDb().$disconnect();
  });

  const permiso = async (purpose: 'invitation' | 'reminder' | 'marketing' = 'invitation') => {
    const done = await grantConsent(scope(), {
      channel: 'whatsapp',
      purpose,
      contact: TELEFONO,
      source: 'formulario',
      textVersion: 'v1',
    });
    assert.equal(done.ok, true);
  };

  it('sin permiso es que NO: falla cerrado', async () => {
    const decision = await mayContact(scope(), 'whatsapp', 'invitation', TELEFONO);
    assert.deepEqual(decision, { ok: false, reason: 'no_consent' });
  });

  it('con permiso vigente, sí', async () => {
    await permiso();
    assert.deepEqual(await mayContact(scope(), 'whatsapp', 'invitation', TELEFONO), { ok: true });
  });

  it('el permiso es POR propósito: el de la invitación no vale para publicidad', async () => {
    await permiso('invitation');
    assert.deepEqual(await mayContact(scope(), 'whatsapp', 'marketing', TELEFONO), {
      ok: false,
      reason: 'no_consent',
    });
  });

  it('el permiso es POR canal: el de WhatsApp no vale para el correo', async () => {
    await permiso();
    assert.deepEqual(await mayContact(scope(), 'sms', 'invitation', TELEFONO), {
      ok: false,
      reason: 'no_consent',
    });
  });

  it('retirado el permiso, vuelve a ser que no', async () => {
    await permiso();
    const done = await revokeConsent(scope(), {
      channel: 'whatsapp',
      purpose: 'invitation',
      contact: TELEFONO,
    });
    assert.deepEqual(done, { ok: true, revoked: 1 });
    assert.deepEqual(await mayContact(scope(), 'whatsapp', 'invitation', TELEFONO), {
      ok: false,
      reason: 'no_consent',
    });
  });

  it('LA BAJA GANA sobre el permiso, aunque el permiso sea de después', async () => {
    await permiso();
    await optOut(scope(), { channel: 'whatsapp', contact: TELEFONO, reason: 'escribió STOP' });

    assert.deepEqual(await mayContact(scope(), 'whatsapp', 'invitation', TELEFONO), {
      ok: false,
      reason: 'opted_out',
    });

    // Y volver a importar la lista —que es lo que de verdad pasa— no la levanta.
    await permiso();
    assert.deepEqual(await mayContact(scope(), 'whatsapp', 'invitation', TELEFONO), {
      ok: false,
      reason: 'opted_out',
    });
  });

  it('una baja SIN propósito tapa los tres', async () => {
    await permiso('invitation');
    await permiso('reminder');
    await permiso('marketing');
    await optOut(scope(), { channel: 'whatsapp', contact: TELEFONO, purpose: null });

    for (const purpose of ['invitation', 'reminder', 'marketing'] as const) {
      const decision = await mayContact(scope(), 'whatsapp', purpose, TELEFONO);
      assert.deepEqual(decision, { ok: false, reason: 'opted_out' }, `propósito ${purpose}`);
    }
  });

  it('una baja CON propósito solo tapa el suyo', async () => {
    await permiso('invitation');
    await permiso('marketing');
    await optOut(scope(), { channel: 'whatsapp', contact: TELEFONO, purpose: 'marketing' });

    assert.deepEqual(await mayContact(scope(), 'whatsapp', 'marketing', TELEFONO), {
      ok: false,
      reason: 'opted_out',
    });
    assert.deepEqual(await mayContact(scope(), 'whatsapp', 'invitation', TELEFONO), { ok: true });
  });

  it('anotar dos veces la misma baja no duplica ni revienta', async () => {
    const uno = await optOut(scope(), { channel: 'whatsapp', contact: TELEFONO });
    const dos = await optOut(scope(), { channel: 'whatsapp', contact: TELEFONO, reason: 'otra vez' });
    assert.equal(uno.ok && dos.ok, true);

    const filas = await controlDb().optOut.count({
      where: { tenantId: fixture.get().tenantId, contact: TELEFONO },
    });
    assert.equal(filas, 1);
  });

  it('un contacto mal escrito se rechaza ANTES de mirar nada', async () => {
    // Nada de esto llega a ser un contacto, así que no hay permiso que buscarle.
    assert.equal(normalizeContact('no-es-un-numero', 'whatsapp'), null);
    assert.equal(normalizeContact('03 456 789', 'whatsapp'), null, 'sin país no se adivina');
    assert.equal(normalizeContact('', 'email'), null);
    assert.equal(normalizeContact('alguien@', 'email'), null);

    // Y con un permiso puesto para el número bueno, el mal escrito sigue siendo
    // «bad_contact» y no «no_consent»: son dos problemas distintos.
    await permiso();
    assert.deepEqual(await mayContact(scope(), 'whatsapp', 'invitation', 'pásame el número'), {
      ok: false,
      reason: 'bad_contact',
    });
    const escrito = await grantConsent(scope(), {
      channel: 'whatsapp',
      purpose: 'invitation',
      contact: 'pásame el número',
      source: 'lista',
    });
    assert.deepEqual(escrito, { ok: false, reason: 'bad_contact' });
  });

  it('normaliza igual al guardar y al preguntar', async () => {
    assert.equal(normalizeContact('  00961 70 555 001 ', 'whatsapp'), TELEFONO);
    assert.equal(normalizeContact('070555001', 'sms', '+961'), '+96170555001');
    assert.equal(normalizeContact('  Rami@Example.COM ', 'email'), 'rami@example.com');

    await grantConsent(scope(), {
      channel: 'whatsapp',
      purpose: 'invitation',
      contact: '00961 70 555 001',
      source: 'lista importada',
    });
    // Se preguntó con otra forma del mismo número y contesta que sí.
    assert.deepEqual(await mayContact(scope(), 'whatsapp', 'invitation', '+961 70 555 001'), {
      ok: true,
    });
  });

  it('un permiso sin origen no se anota: no se podría enseñar', async () => {
    const done = await grantConsent(scope(), {
      channel: 'whatsapp',
      purpose: 'invitation',
      contact: TELEFONO,
      source: '   ',
    });
    assert.deepEqual(done, { ok: false, reason: 'bad_source' });
  });

  it('la versión en bloque dice lo mismo que la de uno en uno', async () => {
    const conPermiso = '+96170555010';
    const deBaja = '+96170555011';
    const sinNada = '+96170555012';
    const malEscrito = 'llámalo tú';

    await grantConsent(scope(), {
      channel: 'whatsapp',
      purpose: 'invitation',
      contact: conPermiso,
      source: 'formulario',
    });
    await grantConsent(scope(), {
      channel: 'whatsapp',
      purpose: 'invitation',
      contact: deBaja,
      source: 'formulario',
    });
    await optOut(scope(), { channel: 'whatsapp', contact: deBaja });

    const contactos = [conPermiso, deBaja, sinNada, malEscrito];
    const bloque = await mayContactMany(scope(), 'whatsapp', 'invitation', contactos);

    for (const contacto of contactos) {
      const uno = await mayContact(scope(), 'whatsapp', 'invitation', contacto);
      assert.deepEqual(bloque.get(contacto), uno, contacto);
    }
    assert.deepEqual(bloque.get(conPermiso), { ok: true });
    assert.deepEqual(bloque.get(deBaja), { ok: false, reason: 'opted_out' });
    assert.deepEqual(bloque.get(sinNada), { ok: false, reason: 'no_consent' });
    assert.deepEqual(bloque.get(malEscrito), { ok: false, reason: 'bad_contact' });
  });

  it('el permiso de una oficina no vale en otra, y la baja tampoco', async () => {
    await permiso();
    await optOut(otro(), { channel: 'whatsapp', contact: TELEFONO });

    // Misma persona, mismo número, dos oficinas: cada una con su respuesta.
    assert.deepEqual(await mayContact(scope(), 'whatsapp', 'invitation', TELEFONO), { ok: true });
    assert.deepEqual(await mayContact(otro(), 'whatsapp', 'invitation', TELEFONO), {
      ok: false,
      reason: 'opted_out',
    });

    // Y en bloque, igual: una oficina no ve el permiso de la otra.
    const bloque = await mayContactMany(otro(), 'whatsapp', 'invitation', [TELEFONO]);
    assert.deepEqual(bloque.get(TELEFONO), { ok: false, reason: 'opted_out' });
  });

  it('el resumen cuenta los tres montones y da nombres de los que faltan', async () => {
    const eventId = await makeEvent(fixture.get().tenantId, [
      { name: 'Con permiso', phone: '+96170555020' },
      { name: 'De baja', phone: '+96170555021' },
      { name: 'Sin nada', phone: '+96170555022' },
      { name: 'Sin teléfono', phone: null },
    ]);
    await grantConsent(scope(), {
      channel: 'whatsapp',
      purpose: 'invitation',
      contact: '+96170555020',
      source: 'formulario',
    });
    await grantConsent(scope(), {
      channel: 'whatsapp',
      purpose: 'invitation',
      contact: '+96170555021',
      source: 'formulario',
    });
    await optOut(scope(), { channel: 'whatsapp', contact: '+96170555021' });

    const resumen = await consentSummary(scope(), eventId);
    assert.notEqual(resumen, null);
    if (resumen === null) return;

    assert.equal(resumen.total, 4);
    assert.equal(resumen.allowed, 1);
    assert.equal(resumen.optedOut, 1);
    assert.equal(resumen.missing, 2);
    assert.equal(resumen.noContact, 1);
    assert.deepEqual(
      resumen.sample.map((guest) => guest.name).sort(),
      ['Sin nada', 'Sin teléfono'],
    );
  });

  it('el resumen de un evento de otra oficina no existe', async () => {
    const eventId = await makeEvent(fixture.get().tenantId, []);
    assert.equal(await consentSummary(otro(), eventId), null);
  });

  it('purgar deja el nombre y la respuesta, y se lleva el teléfono', async () => {
    const prisma = controlDb();
    const eventId = await makeEvent(
      fixture.get().tenantId,
      [{ name: 'Tía Nadia', phone: '+96170555030' }],
      -400,
    );
    const invitado = await prisma.guest.findFirstOrThrow({
      where: { eventId },
      select: { id: true },
    });
    await prisma.guest.update({ where: { id: invitado.id }, data: { email: 'nadia@example.com' } });
    await prisma.rsvp.create({ data: { guestId: invitado.id, status: 'attending', party: 4 } });
    await prisma.guestPreference.create({
      data: { guestId: invitado.id, eventId, key: 'dieta', value: 'sin gluten' },
    });
    await prisma.invitationVisit.create({ data: { eventId, guestId: invitado.id, via: 'personal' } });

    const done = await purgeAfterEvent(scope(), eventId, { keepDays: 90 });
    assert.equal(done.ok, true);
    if (!done.ok) return;
    assert.equal(done.guests, 1);
    assert.equal(done.visits, 1);
    assert.equal(done.preferences, 1);

    const despues = await prisma.guest.findFirstOrThrow({
      where: { id: invitado.id },
      select: { name: true, phone: true, email: true, rsvp: { select: { status: true, party: true } } },
    });
    // La boda ocurrió: el recuento es historia y se queda. El teléfono no.
    assert.equal(despues.name, 'Tía Nadia');
    assert.equal(despues.phone, null);
    assert.equal(despues.email, null);
    assert.deepEqual(despues.rsvp, { status: 'attending', party: 4 });

    assert.equal(await prisma.invitationVisit.count({ where: { eventId } }), 0);
    assert.equal(await prisma.guestPreference.count({ where: { eventId } }), 0);

    // Y el historial de que esto se hizo NO se borra a sí mismo.
    const anotado = await prisma.auditLog.count({
      where: { action: 'retention.purge', entityId: eventId },
    });
    assert.equal(anotado, 1);

    // Volver a pasarlo no rompe nada y ya no queda nada que llevarse.
    const otraVez = await purgeAfterEvent(scope(), eventId, { keepDays: 90 });
    assert.equal(otraVez.ok && otraVez.guests, 0);
  });

  it('purgar también se lleva el teléfono del MENSAJE, sin perder el registro', async () => {
    // Quitarlo de la ficha del invitado y dejarlo escrito en cada mensaje era la
    // mitad del trabajo: hay una fila por cada vez que se le escribió, así que un
    // volcado seguía teniendo el número entero de los doscientos invitados de una
    // boda de hace dos años. Lo encontró una revisión externa.
    const prisma = controlDb();
    const tenantId = fixture.get().tenantId;
    const eventId = await makeEvent(tenantId, [{ name: 'Rami', phone: '+96170555099' }], -400);
    const invitado = await prisma.guest.findFirstOrThrow({ where: { eventId } });
    const conexion = await prisma.whatsappConnection.create({
      data: { tenantId, name: `N-${Math.random().toString(36).slice(2, 8)}`, status: 'connected' },
      select: { id: true },
    });

    const comun = {
      tenantId,
      connectionId: conexion.id,
      eventId,
      guestId: invitado.id,
      toPhone: '+96170555099',
      body: 'la invitación',
      providerMessageId: 'wamid.PRUEBA',
    };
    const enviado = await prisma.whatsappMessage.create({
      data: { ...comun, status: 'sent', kind: 'invitation' },
      select: { id: true },
    });
    // Una que todavía puede salir: su teléfono es POR DONDE sale, así que no se
    // toca aunque el evento haya pasado.
    const enCola = await prisma.whatsappMessage.create({
      data: { ...comun, status: 'queued', kind: 'reminder' },
      select: { id: true },
    });

    const done = await purgeAfterEvent(scope(), eventId, { keepDays: 90 });
    assert.equal(done.ok, true);
    if (!done.ok) return;
    assert.equal(done.messages, 1);

    const despues = await prisma.whatsappMessage.findFirstOrThrow({
      where: { id: enviado.id },
      select: { toPhone: true, status: true, kind: true, providerMessageId: true, createdAt: true },
    });
    // El número ya no está…
    assert.equal(despues.toPhone.includes('70555099'), false);
    assert.equal(despues.toPhone.startsWith('#'), true);
    // …y el registro de lo que se mandó, entero.
    assert.equal(despues.status, 'sent');
    assert.equal(despues.kind, 'invitation');
    assert.equal(despues.providerMessageId, 'wamid.PRUEBA');
    assert.ok(despues.createdAt instanceof Date);

    // La que seguía en cola conserva su teléfono.
    const viva = await prisma.whatsappMessage.findFirstOrThrow({
      where: { id: enCola.id },
      select: { toPhone: true },
    });
    assert.equal(viva.toPhone, '+96170555099');

    // La huella es ESTABLE: sirve para responder «¿a este número le escribimos?»
    // recalculándola, que es lo único que había que conservar.
    const otroMensaje = await prisma.whatsappMessage.create({
      data: { ...comun, status: 'failed', kind: 'invitation', actId: null },
      select: { id: true },
    });
    const segunda = await purgeAfterEvent(scope(), eventId, { keepDays: 90 });
    assert.equal(segunda.ok && segunda.messages, 1);
    const dos = await prisma.whatsappMessage.findFirstOrThrow({
      where: { id: otroMensaje.id },
      select: { toPhone: true },
    });
    assert.equal(dos.toPhone, despues.toPhone);

    // Y pasarla una tercera vez no vuelve a firmar la firma: sin el prefijo,
    // cada pasada destruiría la huella de la anterior.
    const tercera = await purgeAfterEvent(scope(), eventId, { keepDays: 90 });
    assert.equal(tercera.ok && tercera.messages, 0);
  });

  it('no purga una boda que todavía no ha cumplido el plazo', async () => {
    const eventId = await makeEvent(
      fixture.get().tenantId,
      [{ name: 'Rami', phone: '+96170555040' }],
      -10,
    );
    const done = await purgeAfterEvent(scope(), eventId, { keepDays: 90 });
    assert.equal(done.ok, false);
    if (done.ok) return;
    assert.equal(done.reason, 'tooSoon');

    const sigue = await controlDb().guest.findFirstOrThrow({
      where: { eventId },
      select: { phone: true },
    });
    assert.equal(sigue.phone, '+96170555040');
  });

  it('un evento de otra oficina no se purga: para esta no existe', async () => {
    const eventId = await makeEvent(fixture.get().tenantId, [], -400);
    const done = await purgeAfterEvent(otro(), eventId, { keepDays: 90 });
    assert.deepEqual(done, { ok: false, reason: 'notFound' });
  });

  it('los candidatos cuentan desde el ÚLTIMO acto, no desde la fecha del evento', async () => {
    const prisma = controlDb();
    const eventId = await makeEvent(fixture.get().tenantId, [], -100);
    const candidatos = await retentionCandidates(scope(), 90);
    assert.equal(candidatos.some((row) => row.eventId === eventId), true);

    // Una despedida celebrada la semana pasada: el evento deja de estar listo.
    const ayer = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    await prisma.eventAct.create({
      data: {
        eventId,
        type: 'farewell',
        order: 0,
        date: ayer,
        time: '20:00',
        timezone: 'Asia/Beirut',
        venueName: 'Casa',
        venueAddress: 'Beirut',
        venueMapUrl: 'https://m.example',
      },
    });

    const despues = await retentionCandidates(scope(), 90);
    assert.equal(despues.some((row) => row.eventId === eventId), false);
    // Y lo que no es candidato tampoco se purga si alguien lo pide a mano.
    const done = await purgeAfterEvent(scope(), eventId, { keepDays: 90 });
    assert.equal(done.ok, false);
  });

  it('los candidatos de una oficina no son los de otra', async () => {
    const eventId = await makeEvent(fixture.get().tenantId, [], -400);
    const mios = await retentionCandidates(scope(), 90);
    const suyos = await retentionCandidates(otro(), 90);
    assert.equal(mios.some((row) => row.eventId === eventId), true);
    assert.equal(suyos.some((row) => row.eventId === eventId), false);
  });
});
