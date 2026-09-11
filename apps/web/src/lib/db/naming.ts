/**
 * El nombre de la base de datos de una oficina.
 *
 * Cada oficina que alquila la plataforma tiene su PROPIA base de datos: no
 * comparte fila, ni tabla, ni índice con ninguna otra. Esto es lo que convierte
 * «no se ven entre ellas» de una promesa del código en una imposibilidad del
 * servidor — dos bases de datos de PostgreSQL no se consultan entre sí, y no hay
 * consulta, descuido ni filtro olvidado que pueda cruzarlas.
 *
 * El nombre de una base NO se puede pasar como parámetro: `CREATE DATABASE` y
 * `DROP DATABASE` no admiten marcadores, así que el nombre se INCRUSTA en el
 * texto de la orden. Por eso vive aquí, en un solo sitio, y por eso
 * `assertDatabaseName` se llama en CADA frontera que escribe DDL. Una base que
 * se llamara `x" WITH (…); DROP DATABASE "citas` es todo lo que hace falta.
 */

/** El prefijo deja claro en un `\l` qué bases son oficinas y cuáles no. */
export const TENANT_DB_PREFIX = 'citas_of_';

/**
 * Lo único que se admite dentro de una orden DDL: minúsculas, dígitos y bajo.
 *
 * Sin guiones a propósito. Un guion obliga a entrecomillar el nombre en cada
 * herramienta que lo toque —`psql`, `pg_dump`, una copia de seguridad escrita a
 * mano a las tres de la mañana— y el día que alguien se olvide de las comillas
 * el error no es un fallo, es la base equivocada.
 */
const SAFE_NAME = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * El nombre de la base a partir del subdominio de la oficina.
 *
 * El subdominio ya viene validado (`isValidSubdomain`): minúsculas, dígitos y
 * guiones. Los guiones pasan a bajos, y como un subdominio no puede llevar un
 * bajo, dos oficinas distintas nunca caen en el mismo nombre.
 */
export function databaseNameFor(subdomain: string): string {
  const body = subdomain.trim().toLowerCase().replaceAll('-', '_');
  const name = `${TENANT_DB_PREFIX}${body}`;
  assertDatabaseName(name);
  return name;
}

/** Si no es un nombre que se pueda incrustar en una orden, no sigue de aquí. */
export function assertDatabaseName(name: string): string {
  if (!SAFE_NAME.test(name)) {
    throw new Error(`«${name}» no es un nombre de base de datos admisible.`);
  }
  return name;
}

/** Si este nombre es el de una oficina y no el de la base de la plataforma. */
export function isTenantDatabase(name: string): boolean {
  return name.startsWith(TENANT_DB_PREFIX) && SAFE_NAME.test(name);
}
