import { getPrisma } from '@/lib/db/client';

export interface AuditEntry {
  tenantId?: string | null;
  actorId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, string | number | boolean | null>;
  ip?: string | null;
}

/**
 * Writes the trail. It deliberately does NOT swallow failures: the product rule
 * is that a superadmin reaching into someone else's event is always recorded,
 * and an audit write that can fail quietly is not a record — it is a back door.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  await getPrisma().auditLog.create({
    data: {
      tenantId: entry.tenantId ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      metadata: entry.metadata ?? {},
      ip: entry.ip ?? null,
    },
  });
}
