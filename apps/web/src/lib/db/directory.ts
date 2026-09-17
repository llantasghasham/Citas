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

/**
 * Reclamar no es apuntar, y la diferencia era un agujero entre oficinas.
 *
 * Esto se escribió con `createMany({ skipDuplicates: true })`, que para lo que
 * hacía falta —volver a apuntar lo que YA es nuestro sin que reviente— es lo
 * correcto. Pero `skipDuplicates` no distingue «ya lo tenías tú» de «es de
 * OTRA oficina»: se traga las dos igual y devuelve sin decir nada.
 *
 * Y el slug se acuña con el nombre de los novios más seis caracteres al azar,
 * o `invitacion-<azar>` cuando el nombre es árabe — que en el mercado inicial
 * es SIEMPRE. Así que la raíz se repite y toda la separación vive en esos seis
 * caracteres: dieciséis millones de combinaciones, que por la paradoja del
 * cumpleaños empiezan a chocar de verdad a las pocas miles de invitaciones.
 *
 * Con una sola base el choque era ruidoso y sin daño: el índice único de
 * `InvitationVersion` hacía fallar la publicación. Repartidas, la segunda
 * oficina escribe en SU base, donde ese slug está libre, y nada falla — pero
 * `/i/<slug>` sigue resolviendo a la PRIMERA. La pareja de la segunda comparte
 * su enlace por WhatsApp y a sus invitados les sale la boda de unos
 * desconocidos, con sus nombres y su salón. El traslado a una base por oficina
 * convirtió un error visible en una mezcla silenciosa entre dos clientes.
 *
 * Así que ya no se apunta: se RECLAMA. Se intenta insertar y se vuelve a LEER
 * de quién es. La clave primaria decide y es atómica, así que dos oficinas
 * reclamando a la vez tienen una ganadora y una que se entera.
 */
export type ClaimResult = { ok: true } | { ok: false; taken: string[] };

/** Reclama estos slugs para esta oficina. Dice cuáles ya eran de otra. */
export async function claimSlugs(
  scope: TenantScope,
  slugs: readonly string[],
): Promise<ClaimResult> {
  if (slugs.length === 0) return { ok: true };
  const prisma = controlDb();
  await prisma.publicSlug.createMany({
    data: slugs.map((slug) => ({ slug, tenantId: scope.tenantId })),
    skipDuplicates: true,
  });
  // La relectura es lo que convierte esto en una reclamación. Sin ella, lo que
  // el `skipDuplicates` se tragó se leería como un éxito.
  const rows = await prisma.publicSlug.findMany({
    where: { slug: { in: [...slugs] } },
    select: { slug: true, tenantId: true },
  });
  const taken = rows.filter((row) => row.tenantId !== scope.tenantId).map((row) => row.slug);
  return taken.length === 0 ? { ok: true } : { ok: false, taken };
}

/** Lo mismo para los enlaces personales de los invitados. */
export async function claimGuestTokens(
  scope: TenantScope,
  tokens: readonly string[],
): Promise<ClaimResult> {
  if (tokens.length === 0) return { ok: true };
  const prisma = controlDb();
  await prisma.guestToken.createMany({
    data: tokens.map((token) => ({ token, tenantId: scope.tenantId })),
    skipDuplicates: true,
  });
  const rows = await prisma.guestToken.findMany({
    where: { token: { in: [...tokens] } },
    select: { token: true, tenantId: true },
  });
  const taken = rows.filter((row) => row.tenantId !== scope.tenantId).map((row) => row.token);
  return taken.length === 0 ? { ok: true } : { ok: false, taken };
}

/**
 * Acuña identificadores LIBRES, reintentando con otros los que ya eran de otra
 * oficina.
 *
 * Va en tandas y no de uno en uno: importar doscientos invitados son doscientas
 * idas y venidas a la base de control si se reclama uno a uno, y esa base la
 * comparten todas las oficinas. En la práctica basta una: un choque es raro, y
 * cuando ocurre solo se reintenta lo que chocó.
 *
 * Los candidatos se DESDUPLICAN entre sí antes de reclamarlos. Sin eso, dos
 * iguales dentro de la misma tanda se insertarían como uno —el `ON CONFLICT DO
 * NOTHING` de PostgreSQL no protesta— y la relectura diría que los dos son
 * nuestros: dos invitaciones distintas con el mismo enlace, y el fallo lo
 * habría metido justo la función que existe para impedirlo.
 */
async function claimFresh(
  count: number,
  make: () => string,
  claim: (candidates: string[]) => Promise<ClaimResult>,
  qué: string,
): Promise<string[]> {
  if (count <= 0) return [];
  const listos: string[] = [];
  const usados = new Set<string>();

  for (let intento = 0; intento < 6 && listos.length < count; intento += 1) {
    const candidatos = new Set<string>();
    // El generador se llama un número ACOTADO de veces. Sin tope, uno que
    // devolviera siempre lo mismo —una prueba, o el día que alguien le quite el
    // azar a `buildSlug`— dejaría este bucle girando para siempre dentro de una
    // petición: no un error, un servidor colgado.
    const tope = (count - listos.length) * 20;
    for (let i = 0; i < tope && candidatos.size < count - listos.length; i += 1) {
      const nuevo = make();
      if (!usados.has(nuevo)) candidatos.add(nuevo);
    }
    for (const c of candidatos) usados.add(c);
    if (candidatos.size === 0) break;

    const lista = [...candidatos];
    const resultado = await claim(lista);
    const ajenos = new Set(resultado.ok ? [] : resultado.taken);
    for (const c of lista) if (!ajenos.has(c)) listos.push(c);
  }

  if (listos.length < count) {
    // Seis tandas seguidas chocando no es mala suerte: es que algo va mal.
    // Fallar aquí deja una publicación sin hacer, que se arregla volviendo a
    // pulsar; seguir sería escribir una invitación que lleva a otra boda.
    throw new Error(`No se pudo acuñar ${qué} libre después de seis intentos.`);
  }
  return listos;
}

/** Slugs públicos libres en TODA la plataforma, no solo en esta oficina. */
export async function claimFreshSlugs(
  scope: TenantScope,
  count: number,
  make: () => string,
): Promise<string[]> {
  return claimFresh(count, make, (candidatos) => claimSlugs(scope, candidatos), 'un slug');
}

/**
 * Uno solo. Existe para no obligar a cada sitio que pide UN slug a fingir que
 * la lista podría venir vacía: `claimFresh` o devuelve los que se le piden o
 * lanza, así que un `if (slug === undefined)` en el sitio de la llamada sería
 * un caso imposible contestado con una mentira —«no encontrado»— que el día
 * que alguien lo lea le hará buscar en el sitio equivocado.
 */
export async function claimFreshSlug(
  scope: TenantScope,
  make: () => string,
): Promise<string> {
  const [slug] = await claimFreshSlugs(scope, 1, make);
  if (slug === undefined) throw new Error('claimFreshSlugs devolvió una lista vacía.');
  return slug;
}

/** Uno solo, por lo mismo que `claimFreshSlug`. */
export async function claimFreshToken(
  scope: TenantScope,
  make: () => string,
): Promise<string> {
  const [token] = await claimFreshTokens(scope, 1, make);
  if (token === undefined) throw new Error('claimFreshTokens devolvió una lista vacía.');
  return token;
}

/** Enlaces personales libres en toda la plataforma. */
export async function claimFreshTokens(
  scope: TenantScope,
  count: number,
  make: () => string,
): Promise<string[]> {
  return claimFresh(count, make, (candidatos) => claimGuestTokens(scope, candidatos), 'un enlace');
}

/**
 * Se borra lo apuntado cuando lo apuntado deja de existir, y SOLO lo propio.
 *
 * El ámbito no es de adorno aunque hoy no lo llame nadie: sin él, borrar es la
 * otra mitad del mismo agujero que la reclamación cierra. Una oficina que
 * pidiera olvidar un slug que resultara ser de otra le dejaría la invitación
 * sin poder encontrarse en toda la plataforma —un 404 para todos los invitados
 * que ya tienen el enlace— y nadie se enteraría hasta que llamara la pareja.
 */
export async function forgetSlugs(scope: TenantScope, slugs: readonly string[]): Promise<void> {
  if (slugs.length === 0) return;
  await controlDb().publicSlug.deleteMany({
    where: { slug: { in: [...slugs] }, tenantId: scope.tenantId },
  });
}

export async function forgetGuestTokens(
  scope: TenantScope,
  tokens: readonly string[],
): Promise<void> {
  if (tokens.length === 0) return;
  await controlDb().guestToken.deleteMany({
    where: { token: { in: [...tokens] }, tenantId: scope.tenantId },
  });
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
