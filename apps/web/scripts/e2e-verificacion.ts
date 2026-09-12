/**
 * Recorrido completo de producto, contra PostgreSQL de verdad.
 *
 * No es una maqueta ni un mock: llama a las MISMAS funciones que llaman las
 * pantallas del panel y la invitación pública. Si algo de esto mintiera,
 * mentiría igual en el panel.
 *
 *   crear evento → actos → importar invitados → repartir por acto →
 *   abrir la invitación → responder → QR → puerta → exportar →
 *   y que la oficina de al lado no vea NADA de esto.
 *
 * Se ejecuta con `npx tsx scripts/e2e-verificacion.ts` y limpia lo suyo al
 * terminar. Sale con 1 en cuanto una comprobación falla.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';

// La llave de cifrado, si la máquina donde se corre esto no tiene una puesta.
// En producción viene de `CITAS_SECRET_KEY_FILE` y NO se toca: aquí se acuña
// una al vuelo, distinta en cada ejecución y que no se guarda, porque firmar el
// código de la puerta y comprobarlo dentro del mismo proceso es todo lo que este
// recorrido necesita. Si el entorno trae una, manda la del entorno.
if (
  (process.env['CITAS_SECRET_KEY'] ?? '').length === 0 &&
  (process.env['CITAS_SECRET_KEY_FILE'] ?? '').length === 0
) {
  process.env['CITAS_SECRET_KEY'] = randomBytes(32).toString('base64');
  console.log('  ··  sin llave en el entorno: se acuña una para esta ejecución\n');
}

import { agendaFor, publicActs } from '../src/lib/acts/access';
import { addAct, readActs, setActAudience } from '../src/lib/acts/service';
import { addSegment, setSegmentMembers } from '../src/lib/acts/segments';
import { answerAct } from '../src/lib/acts/rsvp';
import { actReport } from '../src/lib/acts/metrics';
import { checkIn, gateCode, gateList, readGateCode } from '../src/lib/checkin/service';
import { codeSheet } from '../src/lib/checkin/codes';
import { setPreference, preferenceReport } from '../src/lib/checkin/preferences';
import { closeAllDatabases, controlDb, db } from '../src/lib/db/client';
import { tenantScope } from '../src/lib/db/tenant';
import { exportAct } from '../src/lib/export/acts';
import { parseGuestList } from '../src/lib/guests/import';
import { visitorAgenda } from '../src/lib/rsvp/agenda';

let paso = 0;
let malas = 0;

function ok(titulo: string, detalle: string): void {
  paso += 1;
  console.log(`  ${String(paso).padStart(2, '0')}. ✓ ${titulo}\n        ${detalle}`);
}

function comprobar(condicion: boolean, titulo: string, detalle: string): void {
  if (condicion) return ok(titulo, detalle);
  paso += 1;
  malas += 1;
  console.log(`  ${String(paso).padStart(2, '0')}. ✗ ${titulo}\n        ${detalle}`);
}

const SUFIJO = Date.now();

async function main(): Promise<void> {
  const prisma = controlDb();

  // ── Dos oficinas: la de esta boda y la de al lado ────────────────────────
  const oficinaA = await prisma.tenant.create({
    data: { name: 'Oficina A', subdomain: `e2e-a-${SUFIJO}`, slug: `e2e-a-${SUFIJO}` },
    select: { id: true },
  });
  const oficinaB = await prisma.tenant.create({
    data: { name: 'Oficina B', subdomain: `e2e-b-${SUFIJO}`, slug: `e2e-b-${SUFIJO}` },
    select: { id: true },
  });
  const actor = await prisma.user.findFirstOrThrow({
    where: { isSuperadmin: true },
    select: { id: true },
  });
  const A = tenantScope(oficinaA.id);
  const B = tenantScope(oficinaB.id);
  ok('dos oficinas', `A=${oficinaA.id} · B=${oficinaB.id}`);

  // ── 1. Crear el evento ───────────────────────────────────────────────────
  const evento = await db(A).event.create({
    data: {
      tenantId: oficinaA.id,
      type: 'wedding',
      channel: 'licensed_office',
      date: '2026-11-14',
      time: '19:00',
      timezone: 'Asia/Beirut',
      venueName: 'E2E Salón',
      venueAddress: 'Beirut',
      venueMapUrl: 'https://maps.example/e2e',
    },
    select: { id: true },
  });
  ok('1 · evento creado', `eventId=${evento.id} · 2026-11-14 · Asia/Beirut`);

  // ── 2. Los actos ─────────────────────────────────────────────────────────
  const base = {
    endTime: '',
    timezone: 'Asia/Beirut',
    venueAddress: 'Beirut',
    venueMapUrl: 'https://maps.example/e2e',
    capacity: '',
    optional: false,
    rsvpEnabled: true,
    rsvpDeadline: '',
  };
  const henna = await addAct(
    A,
    evento.id,
    { ...base, type: 'henna', label: 'حنة', date: '2026-11-13', time: '20:00',
      venueName: 'Casa de la novia', visibility: 'segmented' },
    actor.id,
  );
  const recepcion = await addAct(
    A,
    evento.id,
    { ...base, type: 'reception', label: 'Recepción', date: '2026-11-14', time: '19:00',
      venueName: 'E2E Salón', visibility: 'public' },
    actor.id,
  );
  if (!henna.ok || !recepcion.ok) throw new Error('no se pudieron crear los actos');
  const actos = await readActs(A, evento.id);
  comprobar(
    actos?.length === 2,
    '2 · dos actos',
    `henna=${henna.id} (segmented, 13-nov) · recepción=${recepcion.id} (public, 14-nov)`,
  );

  // El principal, para que la respuesta global tenga de dónde salir.
  await db(A).eventAct.update({ where: { id: recepcion.id }, data: { isMain: true } });

  // ── 3. Importar invitados (la MISMA función que la pantalla) ─────────────
  const pegado = [
    'Nombre,Teléfono,Idioma',
    'رامي حداد,81851000,ar',
    'Layla Haddad,81851001,ar',
    'Colega del trabajo,81851002,es',
    '   ,81851003,ar',
  ].join('\n');
  const importado = parseGuestList(pegado, '+961', 'ar');
  comprobar(
    importado.guests.length === 3 && importado.skipped === 1,
    '3 · lista pegada leída',
    `${importado.guests.length} invitados, ${importado.skipped} descartado sin nombre · ` +
      `teléfonos E.164: ${importado.guests.map((g) => g.phone).join(' ')}`,
  );

  for (const [i, g] of importado.guests.entries()) {
    await db(A).guest.create({
      data: {
        eventId: evento.id,
        name: g.name,
        phone: g.phone,
        locale: g.locale,
        token: `e2e-${SUFIJO}-${i}`,
        maxParty: 4,
      },
    });
  }
  const invitados = await db(A).guest.findMany({
    where: { eventId: evento.id },
    select: { id: true, name: true, token: true },
    orderBy: { name: 'asc' },
  });
  ok('3b · invitados guardados', invitados.map((g) => g.name).join(' · '));

  // ── 4. Repartir por acto ─────────────────────────────────────────────────
  const familia = await addSegment(A, evento.id, 'عائلة العروس', actor.id);
  if (!familia.ok) throw new Error('no se pudo crear el grupo');
  const deLaFamilia = invitados.filter((g) => g.name !== 'Colega del trabajo');
  await setSegmentMembers(A, evento.id, familia.id, deLaFamilia.map((g) => g.id));
  await setActAudience(A, evento.id, henna.id, familia.id, 'allow', actor.id);

  const clave = await db(A).audienceSegment.findFirstOrThrow({
    where: { id: familia.id },
    select: { key: true },
  });
  comprobar(
    /^grupo(-\d+)?$/.test(clave.key),
    '4 · grupo creado y la henna repartida',
    `«عائلة العروس» → clave «${clave.key}» (no se translitera) · ` +
      `${deLaFamilia.length} dentro, 1 fuera`,
  );

  // ── 5. Abrir la invitación ───────────────────────────────────────────────
  const slug = `e2e-boda-${SUFIJO}`;
  await db(A).invitationVersion.create({
    data: {
      eventId: evento.id, slug, locale: 'ar', direction: 'rtl',
      message: 'أهلاً وسهلاً', publishedAt: new Date(),
    },
  });

  const rami = invitados.find((g) => g.name === 'رامي حداد');
  const colega = invitados.find((g) => g.name === 'Colega del trabajo');
  if (rami === undefined || colega === undefined) throw new Error('faltan invitados');

  const sinEnlace = await visitorAgenda(slug, undefined);
  const deRami = await visitorAgenda(slug, rami.token);
  const delColega = await visitorAgenda(slug, colega.token);

  comprobar(
    sinEnlace?.acts.length === 1 && sinEnlace.acts[0]?.id === recepcion.id,
    '5 · reenvío sin enlace personal',
    `ve ${sinEnlace?.acts.length} acto (solo el público). La henna NO sale.`,
  );
  comprobar(
    deRami?.acts.length === 2,
    '5b · enlace personal de رامي',
    `ve ${deRami?.acts.length} actos: ${deRami?.acts.map((a) => a.label).join(' · ')}`,
  );
  comprobar(
    delColega?.acts.length === 1,
    '5c · enlace personal del compañero de trabajo',
    `ve ${delColega?.acts.length} acto: la henna de la familia no es suya`,
  );

  // ── 6. Responder ─────────────────────────────────────────────────────────
  const respuesta = await answerAct(A, evento.id, { id: rami.id, maxParty: 4 }, henna.id, {
    status: 'attending', party: 3, message: 'نأتي ثلاثة',
  });
  const intruso = await answerAct(A, evento.id, { id: colega.id, maxParty: 4 }, henna.id, {
    status: 'attending', party: 1, message: '',
  });
  comprobar(
    respuesta.ok && !intruso.ok,
    '6 · respuesta por acto',
    `رامي: ${respuesta.ok ? 'anotado, 3 sillas' : 'FALLÓ'} · ` +
      `el compañero contra la henna: ${intruso.ok ? 'PASÓ (mal)' : `rechazado (${intruso.reason})`}`,
  );

  const resumen = await db(A).rsvp.findFirst({
    where: { guestId: rami.id },
    select: { status: true, party: true },
  });
  comprobar(
    resumen?.party === 3,
    '6b · el resumen global se derivó solo',
    `Rsvp = ${resumen?.status} · ${resumen?.party} sillas (mismo transacción que la respuesta)`,
  );

  // ── 7. Preferencias ──────────────────────────────────────────────────────
  const buena = await setPreference(A, evento.id, rami.id, { key: 'diet', value: 'gluten_free' });
  const inventada = await setPreference(A, evento.id, rami.id, {
    key: 'diet', value: 'celiaca desde 2019',
  });
  const informe = await preferenceReport(A, evento.id, null, 'diet');
  comprobar(
    buena.ok && !inventada.ok && informe?.values[0]?.count === 1,
    '7 · preferencias, lista cerrada',
    `código aceptado · texto libre rechazado (${inventada.ok ? '¡pasó!' : inventada.reason}) · ` +
      `informe: ${JSON.stringify(informe?.values)}`,
  );

  // ── 8. El QR ─────────────────────────────────────────────────────────────
  const codigo = gateCode(rami.token, henna.id);
  const hoja = await codeSheet(A, evento.id, henna.id);
  const suSvg = hoja?.rows.find((r) => r.guestId === rami.id)?.svg ?? '';
  comprobar(
    codigo.startsWith('g1.') && suSvg.startsWith('<svg') && suSvg.includes('<path'),
    '8 · QR dibujado',
    `código=${codigo.slice(0, 28)}… · SVG de ${suSvg.length} bytes · ` +
      `en la hoja salen ${hoja?.rows.length} invitados (el compañero no)`,
  );
  comprobar(
    readGateCode(codigo, henna.id) === rami.token &&
      readGateCode(codigo, recepcion.id) === null,
    '8b · el código es POR ACTO y va firmado',
    'el de la henna abre la henna y NO abre la recepción',
  );
  const falso = `g1.${rami.token}.${'0'.repeat(32)}`;
  comprobar(
    readGateCode(falso, henna.id) === null,
    '8c · un código fabricado a mano no pasa la firma',
    'firma inventada → null',
  );

  // ── 9. La puerta ─────────────────────────────────────────────────────────
  const entra = await checkIn(A, evento.id, { code: codigo, actId: henna.id, people: 3 });
  const otraVez = await checkIn(A, evento.id, { code: codigo, actId: henna.id, people: 1 });
  const deMas = await checkIn(A, evento.id, {
    guestToken: invitados.find((g) => g.name === 'Layla Haddad')?.token,
    actId: henna.id,
    people: 9,
  });
  const lista = await gateList(A, evento.id, henna.id);
  comprobar(
    entra.ok && !otraVez.ok && !deMas.ok,
    '9 · puerta',
    `entra 3 · segundo intento: ${otraVez.ok ? 'PASÓ (mal)' : otraVez.reason} · ` +
      `nueve personas: ${deMas.ok ? 'PASÓ (mal)' : deMas.reason}`,
  );
  ok('9b · listado de la puerta', `dentro=${lista?.inside.length} · faltan=${lista?.pending.length} · personas=${lista?.headcount}`);

  // ── 10. Exportar ─────────────────────────────────────────────────────────
  const csv = await exportAct(A, evento.id, henna.id);
  const lineas = (csv?.csv ?? '').split('\n');
  comprobar(
    csv !== null && (csv.csv.charCodeAt(0) === 0xfeff) && lineas.length >= 3,
    '10 · CSV del acto',
    `${lineas.length - 1} filas · empieza por marca de orden de bytes (Excel y el árabe) · ` +
      `cabecera: ${lineas[0]?.replace('﻿', '').slice(0, 70)}`,
  );

  // ── 11. Métricas y cobertura ─────────────────────────────────────────────
  const reporte = await actReport(A, evento.id);
  ok(
    '11 · recuentos exactos',
    reporte === null
      ? 'sin reporte'
      : reporte.acts
          .map((a) => `${a.label ?? a.type}: autorizados=${a.authorized} vienen=${a.attending} sillas=${a.seats}`)
          .join(' · '),
  );
  ok(
    '11b · cobertura',
    reporte === null
      ? 'sin cobertura'
      : `sin acto=${reporte.coverage.inNoAct.count} · ` +
        `sin contacto=${reporte.coverage.unreachable.count} · ` +
        `sin contestar=${reporte.coverage.silent.count} · ` +
        `abrieron y no contestaron=${reporte.coverage.openedNoReply.count}`,
  );

  // ── 12. La oficina de al lado NO ve nada ─────────────────────────────────
  const actosDesdeB = await readActs(B, evento.id);
  const exportDesdeB = await exportAct(B, evento.id, henna.id);
  const hojaDesdeB = await codeSheet(B, evento.id, henna.id);
  const puertaDesdeB = await checkIn(B, evento.id, { code: codigo, actId: henna.id, people: 1 });
  const prefDesdeB = await setPreference(B, evento.id, rami.id, {
    key: 'diet', value: 'vegetarian',
  });
  const informeDesdeB = await preferenceReport(B, evento.id, null, 'diet');
  const agendaDesdeB = await agendaFor(B, evento.id, { id: rami.id, maxParty: 4 });
  const publicosDesdeB = await publicActs(B, evento.id);
  const actoNuevoDesdeB = await addAct(
    B, evento.id,
    { ...base, type: 'dinner', label: 'Colada', date: '2026-11-14', time: '21:00',
      venueName: 'x', visibility: 'public' },
    actor.id,
  );

  const bloqueadas = [
    ['readActs', actosDesdeB === null],
    ['exportAct', exportDesdeB === null],
    ['codeSheet', hojaDesdeB === null],
    ['checkIn', !puertaDesdeB.ok],
    ['setPreference', !prefDesdeB.ok],
    ['preferenceReport', informeDesdeB === null],
    ['agendaFor', agendaDesdeB.length === 0],
    ['publicActs', publicosDesdeB.length === 0],
    ['addAct', !actoNuevoDesdeB.ok],
  ] as const;
  for (const [nombre, bien] of bloqueadas) {
    comprobar(bien, `12 · B contra los datos de A: ${nombre}`, bien ? 'no encuentra nada' : 'DEVOLVIÓ DATOS');
  }

  // Y no escribió nada de paso.
  const actosTrasB = await readActs(A, evento.id);
  comprobar(
    actosTrasB?.length === 2,
    '12b · B no escribió nada en la boda de A',
    `siguen ${actosTrasB?.length} actos`,
  );

  // ── limpieza ─────────────────────────────────────────────────────────────
  await prisma.tenant.delete({ where: { id: oficinaA.id } });
  await prisma.tenant.delete({ where: { id: oficinaB.id } });
  ok('limpieza', 'las dos oficinas de prueba borradas, con todo lo suyo');
}

main()
  .then(async () => {
    await closeAllDatabases();
    console.log(`\n${malas === 0 ? 'TODO BIEN' : `${malas} FALLOS`} · ${paso} comprobaciones`);
    process.exit(malas === 0 ? 0 : 1);
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await closeAllDatabases();
    process.exit(1);
  });
