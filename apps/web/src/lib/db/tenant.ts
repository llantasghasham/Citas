/**
 * Tenant isolation. The product rule is absolute: no business query runs without
 * a tenant filter, so a tenant id is never a loose string floating through the
 * code — it is carried in a branded scope that a query has to be handed.
 *
 * The single documented exception is the public invitation page: it is looked up
 * by a global, unguessable slug and belongs to whoever published it.
 *
 * El ámbito lleva además EN QUÉ BASE DE DATOS vive esa oficina, porque cada una
 * tiene la suya (ver `lib/db/client.ts`). Va aquí y no se busca al usar: el
 * ámbito se acuña UNA vez, al abrir la sesión, donde la oficina ya está leída.
 * Buscarlo en cada consulta sería una consulta más por consulta, y obligaría a
 * que `db()` fuera asíncrona — y una función asíncrona olvidada sin `await`
 * devuelve una promesa, que es verdadera, que es como un filtro deja de filtrar.
 */
declare const scopeBrand: unique symbol;

export interface TenantScope {
  readonly tenantId: string;
  /** Su base de datos, o nulo si todavía no tiene (reparto `shared`). */
  readonly databaseName: string | null;
  readonly [scopeBrand]: true;
}

export function tenantScope(tenantId: string, databaseName: string | null = null): TenantScope {
  if (tenantId.length === 0) throw new Error('A tenant scope needs a tenant id.');
  return { tenantId, databaseName } as TenantScope;
}

/** Spreads into a Prisma `where`, so forgetting the filter is impossible. */
export function scopedWhere(scope: TenantScope): { tenantId: string } {
  return { tenantId: scope.tenantId };
}
