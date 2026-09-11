import type { AcquisitionChannel } from '@/generated/prisma/enums';
import { controlDb, db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';

import { limitsFor } from './plans';

/**
 * Un paquete de invitaciones para UNA boda.
 *
 * Precios en centavos enteros, como todo el dinero de este proyecto.
 *
 * Hay dos precios porque hay dos formas de vender, no dos productos:
 *
 * - `retail` — lo que paga la pareja cuando se le vende directamente.
 * - `wholesale` — lo que la oficina deposita antes de que su evento se abra.
 *   Lo que la oficina le cobre luego a la pareja es asunto suyo y es su margen.
 *
 * Un precio mayorista se prefiere a una comisión por porcentaje a propósito:
 * una comisión obliga a saber cuánto cobró la oficina, o sea a que lo declare,
 * o sea a auditarla todos los meses. Un precio mayorista es un número que se
 * fija aquí y se cobra por adelantado.
 */
export interface InvitationPackage {
  id: string;
  guests: number;
  retail: number;
  wholesale: number;
}

export const PACKAGE_CATALOGUE: readonly InvitationPackage[] = [
  { id: 'p100', guests: 100, retail: 2500, wholesale: 1200 },
  { id: 'p200', guests: 200, retail: 4000, wholesale: 2000 },
  { id: 'p500', guests: 500, retail: 8000, wholesale: 4000 },
];

export function findPackage(id: string): InvitationPackage | undefined {
  return PACKAGE_CATALOGUE.find((entry) => entry.id === id);
}

/** Lo que cuesta este paquete según quién lo esté pagando. */
export function priceFor(pack: InvitationPackage, channel: AcquisitionChannel): number {
  return channel === 'licensed_office' ? pack.wholesale : pack.retail;
}

export interface GuestAllowance {
  /** Cuántos invitados admite este evento. `null` es sin límite. */
  allowed: number | null;
  used: number;
  /** True cuando el permiso viene de un paquete pagado y no del plan. */
  fromPackage: boolean;
}

/**
 * Cuántos invitados admite un evento, y cuántos lleva.
 *
 * El paquete pagado manda sobre el plan: para eso se compra. Mientras no esté
 * pagado, el evento se queda con lo que dé el plan de la oficina — que es lo
 * que significa «se abre el trabajo cuando deposita».
 *
 * Un pedido pagado con `packageGuests` es la única prueba que cuenta. Un pedido
 * pendiente no abre nada, porque entonces el prepago no sería prepago.
 */
export async function guestAllowanceFor(
  scope: TenantScope,
  eventId: string,
): Promise<GuestAllowance> {
  const [limits, paid, used] = await Promise.all([
    limitsFor(scope),
    controlDb().order.findMany({
      where: { ...scopedWhere(scope), eventId, status: 'paid', packageGuests: { not: null } },
      select: { packageGuests: true },
    }),
    db(scope).guest.count({ where: { eventId } }),
  ]);

  // Se suman: una boda que crece se amplía comprando otro paquete, sin tener
  // que devolver el primero.
  const fromPackages = paid.reduce((total, order) => total + (order.packageGuests ?? 0), 0);
  if (fromPackages > 0) return { allowed: fromPackages, used, fromPackage: true };

  return { allowed: limits.maxGuests, used, fromPackage: false };
}
