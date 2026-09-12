import QRCode from 'qrcode';

import type { ActType } from '@/generated/prisma/enums';
import { authorizes } from '@/lib/acts/access';
import { db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';

import { gateCode } from './service';

/**
 * La IMAGEN del código de la puerta, y la hoja que se lleva a la imprenta.
 *
 * El código ya existía (`gateCode`, en `./service.ts`) y ya se podía teclear.
 * Lo que faltaba era dibujarlo: una puerta con doscientas personas delante no
 * funciona a base de teclear veinte caracteres por invitado.
 *
 * Dos cosas que no son adorno:
 *
 *   1. **El QR no lleva nada más que el código.** Ni el nombre, ni el teléfono,
 *      ni el enlace del evento. Un QR se fotografía, se reenvía y acaba en un
 *      grupo; lo único que tiene dentro es una firma que solo vale para ESA
 *      pareja de invitado y acto, y que no dice de quién es hasta que la lee el
 *      servidor.
 *   2. **Quién sale en la hoja lo decide `authorizes`**, la misma regla de
 *      `lib/acts/access.ts` que decide la agenda del invitado y los recuentos
 *      del panel. Imprimir el QR de alguien que no entra es imprimir un papel
 *      que la puerta va a rechazar con una cola detrás.
 */

/**
 * El QR de un código, en SVG.
 *
 * SVG y no PNG porque esto va a papel: un QR rasterizado a 128 píxeles y
 * ampliado por la impresora es un QR que el lector del móvil no coge a la
 * primera. El margen mínimo (`margin: 1`) deja la «zona tranquila» que la
 * especificación pide sin regalar media casilla del recuadro.
 */
export async function gateQrSvg(code: string): Promise<string> {
  return QRCode.toString(code, { type: 'svg', margin: 1 });
}

/** Un invitado en la hoja: su nombre, su código y el QR ya dibujado. */
export interface GateCodeRow {
  guestId: string;
  name: string;
  /** El texto que lleva el QR dentro, por si hay que teclearlo. */
  code: string;
  svg: string;
}

export interface GateCodeSheet {
  actId: string;
  type: ActType;
  label: string | null;
  date: string;
  /** Los AUTORIZADOS a este acto, en orden alfabético. */
  rows: GateCodeRow[];
}

/**
 * La hoja de códigos de UN acto.
 *
 * Devuelve `null` cuando el acto no existe, no es de este evento o el evento no
 * es de esta oficina — las tres, la misma respuesta a propósito: distinguirlas
 * le diría a una oficina qué ids de acto hay en otra.
 *
 * Se resuelve en DOS consultas y se cruza en memoria, igual que la exportación
 * por acto: la autorización no es un `where` —son cinco reglas con un orden— y
 * escribirla en SQL sería tenerla escrita dos veces.
 */
export async function codeSheet(
  scope: TenantScope,
  eventId: string,
  actId: string,
): Promise<GateCodeSheet | null> {
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

  const guests = await prisma.guest.findMany({
    where: { eventId, event: scopedWhere(scope) },
    // Alfabético: la hoja se corta y se reparte, y se busca un nombre a mano.
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      token: true,
      segments: { select: { segmentId: true } },
      actInvites: { where: { actId }, select: { excluded: true } },
    },
  });

  const authorized = guests.filter((guest) =>
    authorizes(act, guest.actInvites[0], new Set(guest.segments.map((row) => row.segmentId))),
  );

  const rows = await Promise.all(
    authorized.map(async (guest): Promise<GateCodeRow> => {
      const code = gateCode(guest.token, act.id);
      return { guestId: guest.id, name: guest.name, code, svg: await gateQrSvg(code) };
    }),
  );

  return { actId: act.id, type: act.type, label: act.label, date: act.date, rows };
}
