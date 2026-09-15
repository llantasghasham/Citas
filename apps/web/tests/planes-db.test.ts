import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { controlDb } from '../src/lib/db/client';
import { OFFICE_TABLES, officeWhere } from '../src/lib/db/planes';

/**
 * CADA CAMINO, EJECUTADO CONTRA LA BASE.
 *
 * `tests/planes.test.ts` comprueba lo que se puede saber leyendo: que ninguna
 * tabla se quedó sin plano y que el orden respeta las claves foráneas. Lo que NO
 * se puede saber leyendo es si el camino que cada tabla usa para encontrar las
 * filas de una oficina EXISTE — y eso es lo que rompió el copiado la segunda
 * vez, después de arreglar lo primero:
 *
 *     Unknown argument `event`. Did you mean `eventId`?
 *
 * `ActAudience` lleva `eventId` dentro, pero sus relaciones son `act` y
 * `segment`: no hay ninguna llamada `event`. Lo mismo `GuestSegment`, `CheckIn`,
 * `GuestPreference` y las demás que cuelgan de un invitado. Un camino inventado
 * no da un resultado raro: revienta a mitad del copiado, con tres tablas ya
 * escritas y veintiuna sin escribir.
 *
 * Así que aquí se EJECUTA cada uno. Con un id de oficina que no existe: no
 * devuelven nada, no tocan nada, y lo único que se comprueba es que Prisma
 * acepte la consulta. Es barato y es lo único que atrapa este fallo antes del
 * día de la mudanza.
 */
describe('los caminos para encontrar lo de una oficina', () => {
  const sinDatos = process.env['DATABASE_URL'] === undefined;

  it('todas las tablas que se mudan aceptan su consulta', { skip: sinDatos }, async () => {
    const prisma = controlDb() as unknown as Record<
      string,
      { findMany: (args: unknown) => Promise<unknown[]> }
    >;

    const rotas: string[] = [];
    for (const tabla of OFFICE_TABLES) {
      try {
        await prisma[tabla]?.findMany({
          where: officeWhere(tabla, 'oficina-que-no-existe'),
          take: 1,
        });
      } catch (error) {
        rotas.push(`${tabla}: ${error instanceof Error ? error.message.split('\n')[0] : error}`);
      }
    }

    assert.deepEqual(rotas, [], `caminos que la base no acepta:\n${rotas.join('\n')}`);
  });
});
