import { controlDb } from '@/lib/db/client';
import { isDirectoryLocale, type DirectoryLocale } from '@citas/core';

import { providerScopeFor, type ProviderScope } from './scope';

/**
 * Qué negocio administra quien está dentro.
 *
 * El identificador puede venir en la dirección —hay quien administra dos— pero
 * NO decide nada por sí solo: pasa por `providerScopeFor`, que lo comprueba
 * contra la membresía. Es la misma regla que en el resto del panel: un campo con
 * un id es un dato del cliente, no un permiso.
 */
export interface ProviderChoice {
  id: string;
  legalName: string;
  status: string;
}

export async function myProviders(userId: string): Promise<ProviderChoice[]> {
  const rows = await controlDb().providerMembership.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { provider: { select: { id: true, legalName: true, status: true } } },
  });
  return rows.map((row) => row.provider);
}

/**
 * El ámbito con el que trabaja esta pantalla.
 *
 * Con uno solo, ese. Con varios, el que pida la dirección — y si no pide
 * ninguno, tampoco se elige por él: se le enseña la lista. Adivinar cuál de dos
 * negocios quería editar es cómo se publica una foto en el sitio equivocado.
 */
export async function currentProviderScope(
  userId: string,
  requested: string | undefined,
): Promise<ProviderScope | null> {
  if (requested !== undefined && requested.length > 0) {
    return providerScopeFor(userId, requested);
  }

  const mine = await myProviders(userId);
  if (mine.length !== 1) return null;
  return providerScopeFor(userId, mine[0]?.id ?? '');
}

/**
 * En qué idioma se le habla a quien administra un negocio.
 *
 * El suyo, guardado en su perfil, salvo que pida otro en la dirección. Un idioma
 * que este producto no habla no cambia nada: se cae al del perfil, y sin perfil
 * al árabe.
 */
export function panelLocale(
  requested: string | undefined,
  fromProfile: string | null | undefined,
): DirectoryLocale {
  if (requested !== undefined && isDirectoryLocale(requested)) return requested;
  if (fromProfile !== null && fromProfile !== undefined && isDirectoryLocale(fromProfile)) {
    return fromProfile;
  }
  return 'ar';
}
