import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { CONTROL_TABLES, OFFICE_TABLES, officeWhere } from '../src/lib/db/planes';

/**
 * CADA TABLA, EN SU PLANO. Y ninguna sin decidir.
 *
 * Esta prueba nace de un fallo que estuvo escondido meses y que solo se vio al
 * ejecutar `npm run db:split -- copiar` contra una base de verdad: la lista de
 * tablas que se mudan a la base de cada oficina estaba escrita a mano dentro
 * del guion y se había quedado atrás. Movía diez. Faltaban catorce — los actos
 * de una boda, los grupos, las respuestas por acto, las entradas de la puerta,
 * las preferencias de cocina, los permisos, las campañas.
 *
 * Y lo peor no es el número: es que **copiar no falla por lo que no copia**.
 * Habría terminado en verde, alguien habría encendido `TENANCY=fleet`, y una
 * boda de varios días se habría quedado sin sus días. Sin un error, sin una
 * línea en el historial, sin nada que mirar.
 *
 * Por eso esto no comprueba que la lista sea «la correcta» —eso sería la misma
 * cuenta hecha dos veces por la misma cabeza— sino algo que una máquina sí
 * puede saber: que **todos** los modelos del esquema están en una de las dos
 * listas. Una tabla nueva no puede quedarse fuera sin que esto se ponga rojo.
 *
 * No necesita base de datos: lee `schema.prisma` como texto.
 */
describe('cada tabla en su plano', () => {
  /** Los modelos que de verdad existen, leídos del esquema. */
  const modelos = (): string[] => {
    const esquema = readFileSync(join(import.meta.dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    const nombres = [...esquema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1] ?? '');
    // Prisma expone cada modelo con la inicial en minúscula, que es como se
    // nombran en las dos listas y como se llaman en el cliente.
    return nombres.map((n) => n.charAt(0).toLowerCase() + n.slice(1));
  };

  it('el esquema tiene modelos (si no, esta prueba no prueba nada)', () => {
    // Sin esto, un cambio de formato en el esquema dejaría la expresión sin
    // encontrar nada y las tres pruebas de abajo pasarían con las listas vacías.
    assert.ok(modelos().length > 30, `solo se leyeron ${modelos().length} modelos del esquema`);
  });

  it('NINGÚN modelo se queda sin plano', () => {
    const decididos = new Set<string>([...OFFICE_TABLES, ...CONTROL_TABLES]);
    const huérfanos = modelos().filter((m) => !decididos.has(m));

    assert.deepEqual(
      huérfanos,
      [],
      'Estas tablas no están ni en OFFICE_TABLES ni en CONTROL_TABLES, así que ' +
        'nadie decidió dónde viven. Si es de una oficina va en la primera —y en ' +
        'el sitio que le toque por sus claves foráneas— y si es del arrendador, ' +
        'en la segunda. Dejarla fuera significa que al mudar una oficina a su ' +
        `base, sus filas se quedan atrás sin decir nada: ${huérfanos.join(', ')}`,
    );
  });

  it('ninguna lista nombra algo que no existe', () => {
    const reales = new Set(modelos());
    const inventadas = [...OFFICE_TABLES, ...CONTROL_TABLES].filter((t) => !reales.has(t));

    // Un nombre mal escrito en la lista de la oficina no da error al copiar:
    // `prisma[nombre]` es `undefined` y el guion revienta a medias, con unas
    // tablas copiadas y otras no.
    assert.deepEqual(inventadas, [], `nombres que no son modelos: ${inventadas.join(', ')}`);
  });

  it('ninguna está en las DOS', () => {
    const control = new Set<string>(CONTROL_TABLES);
    const dobles = OFFICE_TABLES.filter((t) => control.has(t));
    assert.deepEqual(dobles, [], `en los dos planos a la vez: ${dobles.join(', ')}`);
  });

  it('cada tabla que se muda sabe cómo encontrar las filas de una oficina', () => {
    for (const tabla of OFFICE_TABLES) {
      const where = officeWhere(tabla, 'oficina-de-prueba');
      // Un `{}` aquí copiaría las filas de TODAS las oficinas a la base de una,
      // que es exactamente lo contrario de lo que este reparto existe para
      // hacer. Es el fallo más caro que podría tener esta función.
      assert.ok(
        Object.keys(where).length > 0,
        `${tabla} no filtra por oficina: copiaría las filas de todas`,
      );
    }
  });

  it('el orden respeta las claves foráneas', () => {
    // No se comprueba el grafo entero —eso lo dice PostgreSQL al escribir— sino
    // las precedencias que ya se rompieron o que romperlas es más fácil.
    const pos = (t: string): number => OFFICE_TABLES.indexOf(t as never);
    const antes: [string, string][] = [
      ['event', 'eventAct'],
      ['eventAct', 'actTranslation'],
      ['event', 'audienceSegment'],
      ['audienceSegment', 'actAudience'],
      ['eventAct', 'actAudience'],
      ['invitationVersion', 'render'],
      // La mesa antes que el invitado: un invitado sentado apunta a la suya.
      ['table', 'guest'],
      ['guest', 'guestSegment'],
      ['guest', 'guestActInvite'],
      ['guest', 'guestActRsvp'],
      ['guest', 'rsvp'],
      ['guest', 'guestPreference'],
      ['guest', 'checkIn'],
      ['eventAct', 'checkIn'],
      ['messageCampaign', 'messageRecipient'],
      ['whatsappConnection', 'whatsappMessage'],
    ];

    for (const [primero, despues] of antes) {
      assert.ok(
        pos(primero) >= 0 && pos(despues) >= 0,
        `falta ${pos(primero) < 0 ? primero : despues} en OFFICE_TABLES`,
      );
      assert.ok(
        pos(primero) < pos(despues),
        `${primero} tiene que copiarse antes que ${despues}`,
      );
    }
  });
});
