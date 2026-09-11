import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';

// ANTES de importar nada que lo lea: el reparto se elige al arrancar el proceso,
// y el corredor de pruebas de Node da un proceso por archivo, así que esto no
// toca a los demás.
process.env['TENANCY'] = 'fleet';

import { controlDb, db } from '../src/lib/db/client';
import { registerSlugs, scopeForGuestToken, scopeForSlug } from '../src/lib/db/directory';
import { TEMPLATE_DB, databaseExists, dropTenantDatabase } from '../src/lib/db/fleet';
import { databaseNameFor } from '../src/lib/db/naming';
import { urlForDatabase } from '../src/lib/db/routing';
import { tenantScope, type TenantScope } from '../src/lib/db/tenant';
import { importGuests } from '../src/lib/repositories/guests';
import { prismaInvitationRepository } from '../src/lib/repositories/prisma';
import { createOffice } from '../src/lib/repositories/tenants';
import { HAS_DB } from './helpers';

/**
 * La aplicación entera, con dos oficinas en dos bases de datos.
 *
 * Lo de `flota.test.ts` prueba que las bases están separadas. Esto prueba lo que
 * de verdad importa: que el producto FUNCIONA así — que una invitación publicada
 * en una oficina se encuentra por su enlace público, que los invitados se
 * importan en su base, y que nada de eso alcanza a la oficina de al lado.
 *
 * Es la prueba que tenía que existir antes de dar por bueno el traslado. Que las
 * bases estén separadas no sirve de nada si el enlace que lleva un invitado en el
 * móvil deja de encontrar su boda.
 */

const UNO = 'prueba-flota-uno';
const DOS = 'prueba-flota-dos';

let scopeUno: TenantScope;
let scopeDos: TenantScope;

async function limpiar(): Promise<void> {
  const control = controlDb();
  for (const subdomain of [UNO, DOS]) {
    await control.tenant.deleteMany({ where: { subdomain } });
    await dropTenantDatabase(databaseNameFor(subdomain)).catch(() => undefined);
  }
}

describe('dos oficinas, la aplicación entera', { skip: !HAS_DB }, () => {
  before(async () => {
    if (!(await databaseExists(TEMPLATE_DB))) {
      await controlDb().$executeRawUnsafe(`CREATE DATABASE "${TEMPLATE_DB}"`);
    }
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: urlForDatabase(TEMPLATE_DB) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    await limpiar();

    // Dar de alta una oficina le crea su base: es lo que pasa cuando el dueño
    // rellena el formulario de «Oficinas» en el panel.
    const uno = await createOffice({ name: 'Oficina Uno', subdomain: UNO, defaultLocale: 'es', tier: 'free' });
    const dos = await createOffice({ name: 'Oficina Dos', subdomain: DOS, defaultLocale: 'es', tier: 'free' });
    assert.ok(uno !== null && dos !== null, 'no se pudo dar de alta alguna oficina');

    scopeUno = tenantScope(uno, databaseNameFor(UNO));
    scopeDos = tenantScope(dos, databaseNameFor(DOS));
  });

  after(limpiar);

  it('dar de alta una oficina le crea su base, y queda apuntada', async () => {
    assert.equal(await databaseExists(databaseNameFor(UNO)), true);
    assert.equal(await databaseExists(databaseNameFor(DOS)), true);

    const apuntada = await controlDb().tenant.findUnique({
      where: { subdomain: UNO },
      select: { databaseName: true },
    });
    assert.equal(apuntada?.databaseName, databaseNameFor(UNO));
  });

  it('una invitación publicada se encuentra por su enlace público', async () => {
    const slug = 'prueba-flota-boda-uno';
    await registerSlugs(scopeUno, [slug]);
    await db(scopeUno).event.create({
      data: {
        tenantId: scopeUno.tenantId,
        type: 'wedding',
        channel: 'self_service',
        date: '2026-06-01',
        time: '19:00',
        timezone: 'Asia/Beirut',
        venueName: 'Prueba Salon Uno',
        venueAddress: 'Beirut',
        venueMapUrl: 'https://maps.example',
        honorees: { create: [{ name: 'Layla', order: 0 }] },
        versions: {
          create: [
            {
              slug,
              locale: 'es',
              direction: 'ltr',
              numeralSystem: 'latin',
              templateId: 'classic',
              message: 'Prueba',
              themePrimary: '#000',
              themeAccent: '#111',
              themeBackground: '#fff',
              publishedAt: new Date(),
            },
          ],
        },
      },
    });

    // El camino público de verdad: del slug al directorio, del directorio a la
    // base de SU oficina, y de ahí a la invitación.
    const encontrada = await prismaInvitationRepository.findBySlug(slug);
    assert.ok(encontrada !== undefined, 'la invitación no se encuentra por su slug');

    // Y la de al lado no tiene nada. Sin filtrar por oficina, a propósito.
    assert.equal((await db(scopeDos).event.findMany({})).length, 0);
    assert.equal((await db(scopeDos).invitationVersion.findMany({})).length, 0);
  });

  it('los invitados se importan en su base y su enlace lleva a su oficina', async () => {
    const evento = await db(scopeUno).event.findFirstOrThrow({ select: { id: true } });
    const resultado = await importGuests(scopeUno, evento.id, [
      { name: 'Rami', phone: '+96170123456', locale: 'ar' },
      { name: 'Nour', phone: '+96170123457', locale: 'ar' },
    ]);
    assert.deepEqual(resultado, { ok: true, added: 2 });

    const invitados = await db(scopeUno).guest.findMany({ select: { token: true } });
    assert.equal(invitados.length, 2);

    // Su enlace personal resuelve a SU oficina, y solo a la suya.
    for (const invitado of invitados) {
      const scope = await scopeForGuestToken(invitado.token);
      assert.equal(scope?.tenantId, scopeUno.tenantId);
      assert.equal(scope?.databaseName, databaseNameFor(UNO));
    }

    // En la oficina de al lado no hay ni un invitado, y su token tampoco existe
    // allí: no es que no se vea, es que no está.
    assert.equal((await db(scopeDos).guest.findMany({})).length, 0);
    const ajeno = invitados[0]?.token ?? '';
    assert.equal(await db(scopeDos).guest.findUnique({ where: { token: ajeno } }), null);
  });

  it('un slug que no existe no lleva a ninguna base', async () => {
    assert.equal(await scopeForSlug('no-existe-este-slug'), null);
    assert.equal(await prismaInvitationRepository.findBySlug('no-existe-este-slug'), undefined);
  });
});
