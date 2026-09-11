import { getPrisma } from '@/lib/db/client';
import type { Role } from '@/generated/prisma/enums';

/**
 * Las dos comprobaciones que faltaban al entrar, y que no se pueden hacer solo
 * en la pantalla.
 */

/**
 * Si la oficina puede trabajar.
 *
 * Suspender una oficina no suspendía nada: no se miraba en ninguna parte. Y
 * aunque se mirara al entrar, una sesión abierta dura treinta días, así que
 * también se comprueba al resolverla — ver `session.ts`. Aquí es para la puerta:
 * ni el código ni la contraseña abren una oficina cerrada.
 *
 * Sin oficina —el superadministrador fuera de una— no hay nada que comprobar.
 */
export async function tenantCanWork(tenantId: string | null): Promise<boolean> {
  if (tenantId === null) return true;
  const tenant = await getPrisma().tenant.findUnique({
    where: { id: tenantId },
    select: { status: true },
  });
  return tenant !== null && tenant.status !== 'suspended';
}

/**
 * Quién puede entrar con CONTRASEÑA.
 *
 * La regla del proyecto es que solo la tienen el superadministrador y los
 * administradores de oficina. Se aplicaba al PONERLA —`npm run auth:password` se
 * niega a dársela a un operador— y en la pantalla del perfil, pero no al
 * USARLA: bastaba con que la fila tuviera `passwordHash`. Así que degradar a un
 * administrador a operador le quitaba los permisos y le dejaba la contraseña,
 * que es la mitad del trabajo.
 *
 * Se mira el rol de AHORA, no el de cuando se puso.
 */
export function mayUsePassword(isSuperadmin: boolean, role: Role | null): boolean {
  return isSuperadmin || role === 'SUPERADMIN' || role === 'TENANT_ADMIN';
}
