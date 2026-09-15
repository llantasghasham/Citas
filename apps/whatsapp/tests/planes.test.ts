import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';

import { controlUrl, urlForDatabase } from '../../web/src/lib/db/routing.js';

import { getConnection, listConnections, setStatus } from '../src/db.js';
import { closeAllPools, controlPool, forgetOffices, isFleet, offices } from '../src/planes.js';

/**
 * EL REPARTIDOR CONTRA DOS BASES DE VERDAD.
 *
 * Este servicio se conectaba a UNA base. Con `TENANCY=fleet`, los números y sus
 * mensajes viven en la base de cada oficina, y lo que pasaba no era un error:
 * la web encolaba allí, esto miraba la común, no encontraba nada, y la cola se
 * veía llena y quieta. Sin un fallo y sin una línea en el registro.
 *
 * Así que no vale probarlo con un doble. Se crean DOS bases de oficina de
 * verdad, se pone un número en cada una, y se comprueba lo que de verdad
 * importa:
 *
 *   · que se vean los de las DOS
 *   · que escribir el estado de uno vaya a SU base y no a la otra
 *   · que un id que no existe en ninguna sea «no existe» y no una excepción
 *
 * Lo último es lo que separa un servicio que reparte de uno que escribe en la
 * base equivocada, que es el fallo que no se ve hasta que alguien pregunta por
 * qué un invitado no recibió su invitación.
 */
const sinBase = process.env['DATABASE_URL'] === undefined;

describe('el repartidor con una base por oficina', { skip: sinBase }, () => {
  const A = 'citas_of_prueba_wa_a';
  const B = 'citas_of_prueba_wa_b';
  const tenancyAntes = process.env['TENANCY'];

  let admin: Pool;

  /** El esquema mínimo que este servicio toca. No hace falta el resto. */
  const TABLA = `
    CREATE TYPE "WhatsappStatus" AS ENUM ('pending','qr','connected','disconnected');
    CREATE TABLE "WhatsappConnection" (
      id text PRIMARY KEY,
      "tenantId" text NOT NULL,
      name text NOT NULL,
      phone text,
      status "WhatsappStatus" NOT NULL DEFAULT 'pending',
      "authEnc" text,
      "qrCode" text,
      "lastError" text,
      "lastSeenAt" timestamptz,
      "dailyCap" integer NOT NULL DEFAULT 200,
      "sentToday" integer NOT NULL DEFAULT 0,
      "sentDay" text,
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );`;

  before(async () => {
    admin = new Pool({ connectionString: urlForDatabase('postgres'), max: 1 });
    for (const base of [A, B]) {
      await admin.query(`DROP DATABASE IF EXISTS ${base}`);
      await admin.query(`CREATE DATABASE ${base}`);
      const suya = new Pool({ connectionString: urlForDatabase(base), max: 1 });
      await suya.query(TABLA);
      await suya.query(
        `INSERT INTO "WhatsappConnection" (id, "tenantId", name) VALUES ($1, $2, $3)`,
        [`num-${base}`, `of-${base}`, `Número de ${base}`],
      );
      await suya.end();
    }

    // La tabla `Tenant` de la base de control es la que dice qué oficinas hay.
    // El error NO se traga: sin estas dos filas no hay flota que recorrer y la
    // prueba pasaría comprobando nada. El primer intento sí lo tragaba, y lo
    // que encontró fueron dos oficinas viejas de otra prueba — verde donde
    // tenía que haber rojo.
    await controlPool().query(
      `INSERT INTO "Tenant"
         (id, slug, subdomain, name, status, "defaultLocale", "databaseName", "updatedAt")
       VALUES ($1,$1,$1,$1,'active','es',$2, now()), ($3,$3,$3,$3,'active','es',$4, now())
       ON CONFLICT (id) DO UPDATE SET "databaseName" = EXCLUDED."databaseName"`,
      [`of-${A}`, A, `of-${B}`, B],
    );

    process.env['TENANCY'] = 'fleet';
    forgetOffices();
  });

  after(async () => {
    if (tenancyAntes === undefined) delete process.env['TENANCY'];
    else process.env['TENANCY'] = tenancyAntes;
    forgetOffices();

    await controlPool()
      .query(`DELETE FROM "Tenant" WHERE "databaseName" = ANY($1::text[])`, [[A, B]])
      .catch(() => undefined);
    await closeAllPools();

    for (const base of [A, B]) await admin.query(`DROP DATABASE IF EXISTS ${base}`);
    await admin.end();
  });

  it('con TENANCY=fleet recorre una base por oficina', async () => {
    assert.equal(isFleet(), true);
    const lista = await offices();
    const nombres = lista.map((office) => office.database);
    assert.ok(nombres.includes(A) && nombres.includes(B), `solo encontró: ${nombres.join(', ')}`);
  });

  it('ve los números de LAS DOS oficinas', async () => {
    const filas = await listConnections();
    const ids = filas.map((fila) => fila.id);
    // Esto es exactamente lo que no pasaba: se veían los de una base y ya.
    assert.ok(ids.includes(`num-${A}`), `falta el de ${A}: ${ids.join(', ')}`);
    assert.ok(ids.includes(`num-${B}`), `falta el de ${B}: ${ids.join(', ')}`);
  });

  it('escribir el estado de uno va a SU base, no a la otra', async () => {
    await setStatus(`num-${A}`, 'connected', { phone: '+96181000000' });

    const enA = new Pool({ connectionString: urlForDatabase(A), max: 1 });
    const enB = new Pool({ connectionString: urlForDatabase(B), max: 1 });
    try {
      const a = await enA.query<{ status: string; phone: string | null }>(
        `SELECT status, phone FROM "WhatsappConnection" WHERE id = $1`,
        [`num-${A}`],
      );
      const b = await enB.query<{ status: string }>(
        `SELECT status FROM "WhatsappConnection" WHERE id = $1`,
        [`num-${B}`],
      );

      assert.equal(a.rows[0]?.status, 'connected');
      assert.equal(a.rows[0]?.phone, '+96181000000');
      // Y el de la otra oficina INTACTO. Escribir en la base equivocada no da
      // error: da el estado de un número ajeno cambiado por el de otro.
      assert.equal(b.rows[0]?.status, 'pending', 'se escribió en la oficina equivocada');
    } finally {
      await enA.end();
      await enB.end();
    }
  });

  it('un id que no está en ninguna oficina es «no existe», no una excepción', async () => {
    // La puerta HTTP contesta 404 con esto. Si lanzara, contestaría 500 y quien
    // pulsó «Conectar» vería «error interno» en vez de «ese número no está».
    assert.equal(await getConnection('no-existe-en-ninguna'), undefined);
  });

  it('sin fleet vuelve a ser UNA sola base', async () => {
    delete process.env['TENANCY'];
    forgetOffices();
    try {
      const lista = await offices();
      assert.equal(lista.length, 1, 'en modo compartido hay una base y solo una');
      assert.equal(lista[0]?.database, new URL(controlUrl()).pathname.slice(1));
    } finally {
      process.env['TENANCY'] = 'fleet';
      forgetOffices();
    }
  });
});
