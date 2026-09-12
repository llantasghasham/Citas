import { controlDb } from '@/lib/db/client';

/**
 * El ámbito de un proveedor: el mismo patrón que `TenantScope`, y por la misma
 * razón.
 *
 * Es un tipo MARCADO y no un `string`, así que un `providerId` que llegue de un
 * formulario no puede pasar por uno. Para tener un `ProviderScope` hay que
 * haberlo acuñado con `providerScopeFor()`, que comprueba la membresía contra la
 * base. No hay otro camino, y eso es justo lo que impide que el proveedor B
 * escriba en el perfil de A cambiando un campo oculto.
 *
 * `scopedWhere()` se usa en el WHERE de cada consulta. No en un `if` de después:
 * un `if` olvidado devuelve datos.
 */
export interface ProviderScope {
  readonly providerId: string;
  readonly role: 'PROVIDER_ADMIN' | 'PROVIDER_EDITOR';
  readonly __providerScope: unique symbol;
}

/**
 * El WHERE de lo que CUELGA de un proveedor: sus traducciones, sus categorías,
 * sus contactos, sus imágenes.
 */
export function scopedWhere(scope: ProviderScope): { providerId: string } {
  return { providerId: scope.providerId };
}

/**
 * El WHERE del proveedor MISMO, cuya columna es `id` y no `providerId`.
 *
 * Son dos funciones y no una porque son dos columnas distintas, y mezclarlas no
 * compila — que es exactamente lo que se quiere: el día que alguien escriba
 * `provider.findFirst({ where: scopedWhere(scope) })` el compilador lo para,
 * en vez de devolver silenciosamente la fila equivocada o ninguna.
 */
export function ownWhere(scope: ProviderScope): { id: string } {
  return { id: scope.providerId };
}

/**
 * Acuña el ámbito, comprobando la membresía.
 *
 * Devuelve `null` cuando esa persona no administra ese proveedor — y «no lo
 * administra» y «no existe» dan lo mismo a propósito: distinguirlos ya contaría
 * que existe.
 */
export async function providerScopeFor(
  userId: string,
  providerId: string,
): Promise<ProviderScope | null> {
  if (providerId.length === 0) return null;

  const membership = await controlDb().providerMembership.findFirst({
    where: { userId, providerId },
    select: { role: true, providerId: true },
  });
  if (membership === null) return null;

  return { providerId: membership.providerId, role: membership.role } as ProviderScope;
}

/**
 * Solo para las pruebas y para el sembrado: acuña sin preguntar a la base.
 *
 * Está aparte y se llama así para que aparezca en cualquier búsqueda. Usarla en
 * una acción del panel sería saltarse la comprobación de membresía entera.
 */
export function unsafeProviderScope(
  providerId: string,
  role: 'PROVIDER_ADMIN' | 'PROVIDER_EDITOR' = 'PROVIDER_ADMIN',
): ProviderScope {
  return { providerId, role } as ProviderScope;
}
