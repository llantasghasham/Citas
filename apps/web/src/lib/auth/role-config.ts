import { cache } from 'react';

import type { Role } from '@/generated/prisma/enums';
import { controlDb } from '@/lib/db/client';
import { CAPABILITIES, roleCan, type Capability } from '@/lib/auth/permissions';

/**
 * Qué puede hacer cada rol, ajustable desde el panel.
 *
 * `permissions.ts` sigue siendo lo que trae de fábrica y el único sitio donde
 * está escrito el reparto por defecto. Esto es una capa encima, y viene con
 * tres candados que no se negocian:
 *
 * 1. **SUPERADMIN no se toca.** Recortarle permisos al único rol que puede
 *    volver a ampliarlos es la forma de quedarse fuera del propio sistema.
 * 2. **`platform:manage` no se reparte.** Es el permiso que abre la
 *    configuración de todas las oficinas, el cobro y el correo. Si se pudiera
 *    conceder, un administrador de oficina se lo concedería a su rol y dejaría
 *    de ser administrador de una oficina.
 * 3. **Solo lo cambia la plataforma.** Un administrador de oficina que pudiera
 *    editar el reparto se ampliaría a sí mismo, que es la definición exacta de
 *    escalada de privilegios.
 * 4. **`directory:moderate` tampoco se reparte.** Es quien aprueba, suspende y
 *    verifica proveedores del directorio. Un proveedor que pudiera concederse
 *    ese permiso se aprobaría a sí mismo, y entonces la moderación deja de
 *    existir: es el fallo entero de un directorio moderado, no un permiso de
 *    más.
 *
 * Se guarda en `Setting` con una fila por rol y no en una tabla nueva: son tres
 * filas de texto y ya existe el sitio donde va la configuración del sistema.
 */
export const EDITABLE_ROLES = ['TENANT_ADMIN', 'OPERATOR', 'ORGANIZER'] as const;
export type EditableRole = (typeof EDITABLE_ROLES)[number];

/** Lo que jamás se concede desde una pantalla. Ver los candados 2 y 4. */
export const NEVER_GRANTABLE: readonly Capability[] = [
  'platform:manage',
  'directory:moderate',
];

export const GRANTABLE: readonly Capability[] = CAPABILITIES.filter(
  (capability) => !NEVER_GRANTABLE.includes(capability),
);

const KEY_PREFIX = 'ROLE_CAPS_';

function isEditable(role: Role): role is EditableRole {
  return EDITABLE_ROLES.some((candidate) => candidate === role);
}

/** El reparto guardado, en una consulta por petición. */
const loadOverrides = cache(async (): Promise<Map<string, Capability[]>> => {
  try {
    const rows = await controlDb().setting.findMany({
      where: { key: { startsWith: KEY_PREFIX } },
    });

    return new Map(
      rows.map((row) => [
        row.key.slice(KEY_PREFIX.length),
        (row.value ?? '')
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry): entry is Capability =>
            // Se filtra al LEER y no solo al escribir: una fila de una versión
            // anterior no debe conceder un permiso que ya no existe, ni uno
            // que nunca debió poder guardarse.
            GRANTABLE.includes(entry as Capability),
          ),
      ]),
    );
  } catch {
    return new Map();
  }
});

/** Lo que puede hoy un rol: lo guardado, o lo de fábrica si no hay nada. */
export async function capabilitiesOf(role: Role): Promise<readonly Capability[]> {
  if (!isEditable(role)) {
    return CAPABILITIES.filter((capability) => roleCan(role, capability));
  }

  const stored = (await loadOverrides()).get(role);
  return stored ?? CAPABILITIES.filter((capability) => roleCan(role, capability));
}

/** True cuando el reparto de ese rol lo escribió alguien en el panel. */
export async function isCustomised(role: Role): Promise<boolean> {
  return isEditable(role) && (await loadOverrides()).has(role);
}

export async function saveRoleCapabilities(
  role: Role,
  capabilities: string[],
  actorId: string,
): Promise<void> {
  if (!isEditable(role)) return;

  const clean = capabilities.filter((entry): entry is Capability =>
    GRANTABLE.includes(entry as Capability),
  );

  const key = `${KEY_PREFIX}${role}`;
  await controlDb().setting.upsert({
    where: { key },
    update: { value: clean.join(','), updatedBy: actorId },
    create: { key, value: clean.join(','), updatedBy: actorId },
  });
}

/** Vuelve al reparto de fábrica borrando la fila. */
export async function resetRoleCapabilities(role: Role): Promise<void> {
  if (!isEditable(role)) return;
  await controlDb().setting.deleteMany({ where: { key: `${KEY_PREFIX}${role}` } });
}
