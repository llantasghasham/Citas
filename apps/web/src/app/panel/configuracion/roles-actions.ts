'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { Role } from '@/generated/prisma/enums';
import { clientIp } from '@/lib/admin/context';
import { recordAudit } from '@/lib/audit';
import { getSession, sessionCan } from '@/lib/auth/session';
import { EDITABLE_ROLES, resetRoleCapabilities, saveRoleCapabilities } from '@/lib/auth/role-config';

/**
 * Cambia lo que puede hacer un rol.
 *
 * SOLO la cuenta de la plataforma. Un administrador de oficina que pudiera
 * tocar esto se ampliaría a sí mismo, que es la definición de escalada de
 * privilegios: se comprueba aquí, en el servidor, y no basta con que la
 * pantalla no le enseñe el formulario.
 *
 * Los dos candados —SUPERADMIN intocable y `platform:manage` nunca concedible—
 * viven en `role-config.ts` y se aplican al guardar Y al leer, así que ni un
 * envío fabricado a mano ni una fila de una versión anterior los saltan.
 */
export async function saveRolesAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'platform:manage')) redirect('/panel');

  const raw = String(formData.get('role') ?? '');
  const role = EDITABLE_ROLES.find((candidate) => candidate === raw);
  if (role === undefined) redirect('/panel/configuracion?s=roles');

  const volviendo = String(formData.get('reset') ?? '') === '1';
  const capabilities = formData.getAll('capability').map(String);

  if (volviendo) await resetRoleCapabilities(role as Role);
  else await saveRoleCapabilities(role as Role, capabilities, session.userId);

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'system.roles.save',
    entity: 'User',
    entityId: session.userId,
    // Qué rol y con qué queda: esto SÍ se guarda entero, porque un cambio de
    // permisos es exactamente lo que hay que poder reconstruir después.
    metadata: { role, capabilities: volviendo ? 'de fábrica' : capabilities.join(',') },
    ip: clientIp(await headers()),
  });

  // La sesión de cualquiera lleva sus permisos ya resueltos, así que el cambio
  // tiene que llegar a todas las pantallas, no solo a esta.
  revalidatePath('/panel', 'layout');
  redirect('/panel/configuracion?s=roles&guardado=1');
}
