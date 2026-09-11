import { controlDb, tenancyMode } from './client';
import { tenantScope, type TenantScope } from './tenant';

/**
 * El directorio de lo que se sirve SIN oficina.
 *
 * Hay dos cosas públicas en este producto: la invitación (`/i/<slug>`) y el
 * enlace personal del invitado (`/g/<token>`). Las dos se abren sin cuenta y sin
 * saber de qué oficina son — el invitado no tiene por qué saberlo y no va a
 * escribir un subdominio. Con todo en una base eso se resolvía mirando; con una
 * base por oficina, la fila está en una de trescientas y no se sabe en cuál.
 *
 * Esto lo dice, y NADA MÁS: en qué base seguir buscando. Ni el evento, ni la
 * fecha, ni los novios, ni el nombre del invitado. Quien consiga leer esta tabla
 * entera obtiene una lista de identificadores que ya tenía que conocer para
 * poder preguntar por ellos.
 *
 * Hace además un segundo trabajo que antes hacía sola la base: el slug es ÚNICO
 * EN TODA LA PLATAFORMA. Antes lo garantizaba el índice único de
 * `InvitationVersion` porque solo había una base; repartidas, dos oficinas
 * podrían publicar el mismo slug y el segundo taparía al primero. Ahora lo
 * impide la clave primaria de esta tabla, que es de las dos la que está en un
 * sitio donde las dos oficinas escriben.
 *
 * El orden importa y es al revés de lo que parece: se apunta AQUÍ primero y se
 * escribe la fila después. Una entrada de directorio sin invitación detrás
 * resuelve a una base donde no hay nada, que es un 404 — lo mismo que si no
 * existiera. Una invitación sin entrada de directorio no se puede encontrar
 * NUNCA, y nadie se entera hasta que un invitado abre el enlace y no hay nada.
 */

/** Apunta dónde vivirán estos slugs. Antes de crearlos, a propósito. */
export async function registerSlugs(scope: TenantScope, slugs: readonly string[]): Promise<void> {
  if (slugs.length === 0) return;
  await controlDb().publicSlug.createMany({
    data: slugs.map((slug) => ({ slug, tenantId: scope.tenantId })),
    skipDuplicates: true,
  });
}

/** Lo mismo para los enlaces personales de los invitados. */
export async function registerGuestTokens(
  scope: TenantScope,
  tokens: readonly string[],
): Promise<void> {
  if (tokens.length === 0) return;
  await controlDb().guestToken.createMany({
    data: tokens.map((token) => ({ token, tenantId: scope.tenantId })),
    skipDuplicates: true,
  });
}

/** Se borra lo apuntado cuando lo apuntado deja de existir. */
export async function forgetSlugs(slugs: readonly string[]): Promise<void> {
  if (slugs.length === 0) return;
  await controlDb().publicSlug.deleteMany({ where: { slug: { in: [...slugs] } } });
}

export async function forgetGuestTokens(tokens: readonly string[]): Promise<void> {
  if (tokens.length === 0) return;
  await controlDb().guestToken.deleteMany({ where: { token: { in: [...tokens] } } });
}

/**
 * En qué oficina —y en qué base— vive este slug público.
 *
 * Mientras el reparto sea `shared` puede no haber entrada: las invitaciones de
 * antes del traslado se publicaron cuando esta tabla no existía. En ese caso se
 * busca como se buscaba, que es correcto porque todo está en la misma base. En
 * `fleet` no hay respaldo posible: sin entrada no hay base donde mirar, y
 * devolver «no existe» es lo único honrado. `npm run db:split` deja apuntado
 * todo lo anterior antes de que eso pueda pasar.
 */
export async function scopeForSlug(slug: string): Promise<TenantScope | null> {
  const prisma = controlDb();
  const row = await prisma.publicSlug.findUnique({
    where: { slug },
    select: { tenantId: true, tenant: { select: { databaseName: true } } },
  });
  if (row !== null) return tenantScope(row.tenantId, row.tenant.databaseName);
  if (tenancyMode() === 'fleet') return null;

  const version = await prisma.invitationVersion.findUnique({
    where: { slug },
    select: { event: { select: { tenantId: true } } },
  });
  return version === null ? null : tenantScope(version.event.tenantId, null);
}

export async function scopeForGuestToken(token: string): Promise<TenantScope | null> {
  const prisma = controlDb();
  const row = await prisma.guestToken.findUnique({
    where: { token },
    select: { tenantId: true, tenant: { select: { databaseName: true } } },
  });
  if (row !== null) return tenantScope(row.tenantId, row.tenant.databaseName);
  if (tenancyMode() === 'fleet') return null;

  const guest = await prisma.guest.findUnique({
    where: { token },
    select: { event: { select: { tenantId: true } } },
  });
  return guest === null ? null : tenantScope(guest.event.tenantId, null);
}
