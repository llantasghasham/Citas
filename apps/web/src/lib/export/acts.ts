import type { ActType, RsvpStatus } from '@/generated/prisma/enums';
import { authorizes } from '@/lib/acts/metrics';
import { db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';

import { buildCsv } from './csv';

/**
 * La lista de UN acto, en una hoja de cálculo.
 *
 * Una boda en actos se organiza por actos: al salón de la henna se le manda
 * quién entra a la henna, no la lista entera de la boda con una columna que
 * haya que filtrar a mano. Una fila por invitado AUTORIZADO a ese acto —el
 * mismo orden de decisión que `agendaFor`— con lo que pide quien está en la
 * puerta y quien monta el salón.
 *
 * La autorización la decide `authorizes`, la misma que usan las métricas: hay
 * que resolverla para TODOS los invitados de la boda y `agendaFor` resuelve uno
 * con sus consultas.
 *
 * El CSV lo escribe `lib/export/csv.ts` y no se escribe otro aquí: ahí vive la
 * marca de orden de bytes que hace que Excel lea el árabe, y la neutralización
 * de las celdas que empiezan por `=`, `+`, `-` o `@`. Esa neutralización no es
 * una precaución teórica: el formulario de confirmación es público a propósito
 * y el nombre lo escribe cualquiera, incluido el propio invitado.
 */

export interface ActExport {
  actId: string;
  type: ActType;
  label: string | null;
  date: string;
  /** Cuántas filas lleva, sin contar la cabecera. */
  rows: number;
  /**
   * Un nombre de archivo sin una letra del usuario dentro: un acto llamado
   * «حنة» en una cabecera `content-disposition` obliga a codificarlo como dice
   * la RFC 5987, y quien llama a esto no tiene por qué pelearse con eso.
   */
  filename: string;
  csv: string;
}

/**
 * Devuelve `null` cuando el acto no existe o no es de esta oficina, que es la
 * misma respuesta a propósito: distinguirlas le diría a una oficina qué ids de
 * acto hay en otra. El evento se comprueba ADEMÁS del acto, porque el id del
 * acto viene de un formulario y un id suelto no autoriza nada.
 */
export async function exportAct(
  scope: TenantScope,
  eventId: string,
  actId: string,
): Promise<ActExport | null> {
  const prisma = db(scope);

  const act = await prisma.eventAct.findFirst({
    where: { id: actId, eventId, event: scopedWhere(scope) },
    select: {
      id: true,
      type: true,
      label: true,
      date: true,
      visibility: true,
      audiences: { select: { segmentId: true, mode: true } },
    },
  });
  if (act === null) return null;

  // Los invitados de la boda con lo suyo colgando, en un número FIJO de
  // consultas. Las relaciones se piden ya filtradas por este acto: de las
  // invitaciones con nombre y de las respuestas solo interesa la de aquí.
  const guests = await prisma.guest.findMany({
    where: { eventId, event: scopedWhere(scope) },
    // Alfabético: esta lista la lee quien está en la puerta y tiene que
    // contestar «¿dónde me siento?» en dos segundos.
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      phone: true,
      locale: true,
      table: { select: { name: true } },
      segments: { select: { segmentId: true, segment: { select: { name: true } } } },
      actInvites: { where: { actId }, select: { excluded: true } },
      actRsvps: { where: { actId }, select: { status: true, party: true } },
    },
  });

  const rows: (string | number | null)[][] = [];
  for (const guest of guests) {
    const mine = new Set(guest.segments.map((row) => row.segmentId));
    const invite = guest.actInvites[0];
    if (!authorizes(act, invite, mine)) continue;

    const reply: { status: RsvpStatus; party: number } | undefined = guest.actRsvps[0];
    rows.push([
      guest.name,
      guest.phone,
      guest.locale,
      // Los grupos, por su nombre y no por su id: esto lo lee una persona.
      guest.segments.map((row) => row.segment.name).join(' | '),
      // Sin respuesta se deja la celda VACÍA, igual que en la exportación de
      // invitados de siempre: dos exportaciones del mismo producto que digan
      // «sin contestar» de dos maneras distintas es una columna que no se puede
      // cruzar con la otra.
      reply?.status ?? null,
      // `party` se cuenta a sí mismo: quien viene con tres pone cuatro. Va como
      // número para que la columna se pueda sumar — y por eso mismo no se
      // neutraliza, que es lo que `buildCsv` ya distingue.
      reply?.party ?? null,
      guest.table?.name ?? null,
    ]);
  }

  return {
    actId: act.id,
    type: act.type,
    label: act.label,
    date: act.date,
    rows: rows.length,
    filename: `act-${act.date}-${act.type}.csv`,
    csv: buildCsv(['name', 'phone', 'locale', 'segments', 'status', 'party', 'table'], rows),
  };
}
