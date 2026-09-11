import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, describe, it } from 'node:test';

import { controlDb, databaseByName, db, tenancyMode } from '../src/lib/db/client';
import {
  TEMPLATE_DB,
  createTenantDatabase,
  databaseExists,
  dropTenantDatabase,
  migrationsOf,
  seedTenantRow,
} from '../src/lib/db/fleet';
import { assertDatabaseName, databaseNameFor, isTenantDatabase } from '../src/lib/db/naming';
import { urlForDatabase } from '../src/lib/db/routing';
import { tenantScope } from '../src/lib/db/tenant';
import { HAS_DB } from './helpers';

/**
 * Una base de datos por oficina.
 *
 * Lo que se prueba aquí no es que el código filtre bien: eso ya lo prueba
 * `aislamiento.test.ts`. Es que aunque el código NO filtrara, la fila de otra
 * oficina seguiría sin poder aparecer, porque está en otra base de datos del
 * servidor y dos bases de PostgreSQL no se consultan entre sí.
 *
 * Por eso las consultas de estas pruebas se hacen A PROPÓSITO sin filtro de
 * oficina —`findMany({})`, a pelo— que es justo lo que ninguna consulta del
 * proyecto puede hacer. Si el aislamiento dependiera del filtro, esto lo
 * enseñaría; y si algún día alguien lo rompiera, esto es lo que se pondría rojo.
 */

const UNO = `${databaseNameFor('pruebaflota1')}`;
const DOS = `${databaseNameFor('pruebaflota2')}`;

describe('el nombre de la base no se puede escribir desde fuera', () => {
  it('rechaza cualquier cosa que no sean minúsculas, dígitos y bajos', () => {
    for (const malo of [
      'citas_of_x"; DROP DATABASE "citas',
      'citas_of_x; SELECT 1',
      "citas_of_x' OR '1",
      'citas_of_MAYUSCULAS',
      'citas_of_con-guion',
      'citas_of_con espacio',
      '',
      '1empieza_por_digito',
    ]) {
      assert.throws(() => assertDatabaseName(malo), /no es un nombre/, `pasó: ${malo}`);
    }
  });

  it('el guion del subdominio se vuelve bajo, y no hay dos que choquen', () => {
    assert.equal(databaseNameFor('agencia-luna'), 'citas_of_agencia_luna');
    // Un subdominio no puede llevar un bajo, así que no existe el subdominio
    // «agencia_luna» que chocaría con el de arriba.
    assert.equal(isTenantDatabase('citas_of_agencia_luna'), true);
    assert.equal(isTenantDatabase('otra_base_cualquiera'), false);
  });

  it('una base que no es de oficina no se crea ni se borra desde aquí', async () => {
    await assert.rejects(() => createTenantDatabase('postgres'), /no es una base de oficina/);
    await assert.rejects(() => dropTenantDatabase('postgres'), /no es una base de oficina/);
    await assert.rejects(() => dropTenantDatabase(TEMPLATE_DB), /plantilla no se borra/);
  });
});

describe('el reparto se elige a propósito, y falla cerrado', () => {
  it('sin TENANCY, todo sigue como estaba', () => {
    assert.equal(tenancyMode(), 'shared');
    // En el reparto de siempre un ámbito encamina a la base común, que es donde
    // están sus datos mientras no se hayan mudado.
    assert.equal(db(tenantScope('cualquiera', null)), controlDb());
  });

  it('en flota, una oficina sin base propia NO cae en la común', () => {
    const antes = process.env['TENANCY'];
    process.env['TENANCY'] = 'fleet';
    try {
      assert.equal(tenancyMode(), 'fleet');
      // Lo que no puede pasar de ninguna manera es que devuelva la base de
      // control: ahí está el registro de TODAS las oficinas, y una consulta suya
      // sin filtro las vería enteras. Antes que eso, que no atienda.
      assert.throws(() => db(tenantScope('sin-base', null)), /no tiene base de datos propia/);
    } finally {
      if (antes === undefined) delete process.env['TENANCY'];
      else process.env['TENANCY'] = antes;
    }
  });
});

describe('dos oficinas, dos bases de datos', { skip: !HAS_DB }, () => {
  after(async () => {
    await dropTenantDatabase(UNO).catch(() => undefined);
    await dropTenantDatabase(DOS).catch(() => undefined);
  });

  it('la plantilla se migra y de ella salen bases con el esquema entero', async () => {
    if (!(await databaseExists(TEMPLATE_DB))) {
      await controlDb().$executeRawUnsafe(`CREATE DATABASE "${TEMPLATE_DB}"`);
    }
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: urlForDatabase(TEMPLATE_DB) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    await dropTenantDatabase(UNO).catch(() => undefined);
    await dropTenantDatabase(DOS).catch(() => undefined);
    await createTenantDatabase(UNO);
    await createTenantDatabase(DOS);

    // Copiada de una migrada de verdad: lleva las migraciones apuntadas, no solo
    // las tablas. Es lo que permite que `db:fleet migrar` sepa por dónde va.
    const aplicadas = await migrationsOf(UNO);
    assert.ok(aplicadas.length > 0, 'la base copiada no trae migraciones apuntadas');
    assert.ok(
      aplicadas.includes('20260917100000_fleet'),
      'la base copiada no llega hasta la última migración',
    );
  });

  it('lo que escribe una NO existe en la otra, ni sin filtrar por oficina', async () => {
    await seedTenantRow(UNO, {
      id: 'flota-uno',
      slug: 'pruebaflota1',
      subdomain: 'pruebaflota1',
      name: 'Oficina Uno',
      status: 'active',
      defaultLocale: 'es',
    });
    await seedTenantRow(DOS, {
      id: 'flota-dos',
      slug: 'pruebaflota2',
      subdomain: 'pruebaflota2',
      name: 'Oficina Dos',
      status: 'active',
      defaultLocale: 'es',
    });

    const uno = databaseByName(UNO);
    const dos = databaseByName(DOS);

    await uno.event.create({
      data: {
        tenantId: 'flota-uno',
        type: 'wedding',
        channel: 'self_service',
        date: '2026-06-01',
        time: '19:00',
        timezone: 'Asia/Beirut',
        venueName: 'Prueba Salon Uno',
        venueAddress: 'Beirut',
        venueMapUrl: 'https://maps.example',
      },
    });

    // A PROPÓSITO sin `where`: si el aislamiento dependiera del filtro, esta
    // consulta traería la boda de la otra oficina. Está en otra base, así que no
    // hay nada que traer.
    const enDos = await dos.event.findMany({});
    assert.equal(enDos.length, 0, 'la oficina Dos ve un evento que no es suyo');

    const enUno = await uno.event.findMany({});
    assert.equal(enUno.length, 1);
    assert.equal(enUno[0]?.venueName, 'Prueba Salon Uno');

    // Y tampoco se ven las oficinas entre sí: cada base conoce la suya y ninguna
    // más. Sin esto, un listado sin filtrar enseñaría la cartera de clientes.
    const oficinasEnUno = await uno.tenant.findMany({});
    assert.deepEqual(
      oficinasEnUno.map((row) => row.id),
      ['flota-uno'],
    );
  });

  it('la oficina se lleva su base al irse, y la otra no se entera', async () => {
    await dropTenantDatabase(DOS);
    assert.equal(await databaseExists(DOS), false, 'la base de la Dos sigue ahí');

    // Y la Uno sigue intacta: darse de baja una oficina no toca a las demás,
    // que es la otra mitad de por qué hay una base por oficina. Con todo en la
    // misma, «borrar una oficina» es un `DELETE` largo del que hay que fiarse.
    const uno = databaseByName(UNO);
    assert.equal((await uno.event.findMany({})).length, 1);
  });
});
