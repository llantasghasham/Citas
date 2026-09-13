import { randomBytes } from 'node:crypto';

/**
 * La dirección pública de un proveedor.
 *
 * Dos reglas, las dos heredadas de los slugs de invitación:
 *
 *   1. **Un nombre árabe NO se translitera.** «قاعة الأرز» no sale como
 *      `qaat-al-arz`: sale `p-<azar>`. Transliterar un nombre propio
 *      automáticamente es justo lo que este proyecto prohíbe, y además lo hace
 *      mal — quien lo lea no reconocerá su negocio.
 *   2. **Es ESTABLE.** Cambiar el nombre comercial no cambia la dirección. Una
 *      URL que ya se compartió, se indexó y está en la tarjeta de alguien no se
 *      mueve porque el dueño corrija una palabra.
 */
const RESERVED = new Set([
  'api', 'panel', 'crear', 'entrar', 'ejemplos', 'pagar', 'admin', 'd', 'i', 'g',
  'proveedores', 'fiestas', 'sitemap', 'robots', 'buscar', 'nuevo',
]);

export function providerSlug(name: string, taken: readonly string[]): string {
  return slugify(name, taken, 'p');
}

/**
 * Lo mismo para una fiesta publicada, con su propio prefijo.
 *
 * El prefijo importa cuando el nombre no deja nada latino, que en este producto
 * es el caso NORMAL: «زفاف رامي وسارة» sale `f-3a9c1b04`. Con el mismo prefijo
 * que un proveedor, `p-3a9c…` podría ser un salón o una boda, y quien lea un
 * registro no sabría cuál.
 */
export function listingSlug(title: string, taken: readonly string[]): string {
  return slugify(title, taken, 'f');
}

function slugify(name: string, taken: readonly string[], prefix: 'p' | 'f'): string {
  const latin = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Solo letras latinas y dígitos. Lo demás —árabe incluido— desaparece, y si
    // no queda nada se usa el azar.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  const base =
    latin.length >= 3 && !RESERVED.has(latin)
      ? latin
      : `${prefix}-${randomBytes(4).toString('hex')}`;
  if (!taken.includes(base)) return base;

  // Ocupado: se le añade azar en vez de un contador. Un `-2` cuenta cuántos
  // negocios con ese nombre hay, que no es asunto de nadie.
  return `${base}-${randomBytes(2).toString('hex')}`;
}
