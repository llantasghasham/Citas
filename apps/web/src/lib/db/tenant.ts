/**
 * Tenant isolation. The product rule is absolute: no business query runs without
 * a tenant filter, so a tenant id is never a loose string floating through the
 * code — it is carried in a branded scope that a query has to be handed.
 *
 * The single documented exception is the public invitation page: it is looked up
 * by a global, unguessable slug and belongs to whoever published it.
 */
declare const scopeBrand: unique symbol;

export interface TenantScope {
  readonly tenantId: string;
  readonly [scopeBrand]: true;
}

export function tenantScope(tenantId: string): TenantScope {
  if (tenantId.length === 0) throw new Error('A tenant scope needs a tenant id.');
  return { tenantId } as TenantScope;
}

/** Spreads into a Prisma `where`, so forgetting the filter is impossible. */
export function scopedWhere(scope: TenantScope): { tenantId: string } {
  return { tenantId: scope.tenantId };
}
