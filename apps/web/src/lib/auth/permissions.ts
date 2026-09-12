import type { Role } from '@/generated/prisma/enums';

/**
 * What someone is allowed to do. Checked on the server, always: hiding a button
 * is not a permission.
 */
export const CAPABILITIES = [
  'platform:manage',
  'tenant:manage',
  'tenant:staff',
  'event:write',
  'event:read',
  'billing:manage',
  // El directorio público. `provider:manage` es «lo mío»: mi perfil, mis
  // traducciones, mis imágenes. `directory:moderate` es aprobar, rechazar,
  // suspender, verificar y resolver denuncias — de CUALQUIERA.
  'provider:manage',
  'directory:moderate',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  SUPERADMIN: CAPABILITIES,
  TENANT_ADMIN: ['tenant:manage', 'tenant:staff', 'event:write', 'event:read', 'billing:manage'],
  OPERATOR: ['event:write', 'event:read'],
  ORGANIZER: ['event:read'],
};

/**
 * Los roles del DIRECTORIO, que son otra cosa.
 *
 * Un proveedor no es personal de una oficina: no tiene eventos, ni invitados, ni
 * nada que leer del panel. Reutilizar `OPERATOR` habría sido cómodo y habría
 * dejado a un salón con `event:read`, que es exactamente cómo alguien acaba con
 * una capacidad que nadie quiso darle.
 */
export const PROVIDER_ROLES = ['PROVIDER_ADMIN', 'PROVIDER_EDITOR'] as const;
export type ProviderRoleName = (typeof PROVIDER_ROLES)[number];

const PROVIDER_ROLE_CAPABILITIES: Record<ProviderRoleName, readonly Capability[]> = {
  PROVIDER_ADMIN: ['provider:manage'],
  PROVIDER_EDITOR: ['provider:manage'],
};

export function providerRoleCan(role: ProviderRoleName, capability: Capability): boolean {
  return PROVIDER_ROLE_CAPABILITIES[role].includes(capability);
}

export function roleCan(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
