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
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  SUPERADMIN: CAPABILITIES,
  TENANT_ADMIN: ['tenant:manage', 'tenant:staff', 'event:write', 'event:read', 'billing:manage'],
  OPERATOR: ['event:write', 'event:read'],
  ORGANIZER: ['event:read'],
};

export function roleCan(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
