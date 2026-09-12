import { recordAudit } from '@/lib/audit';
import { controlDb } from '@/lib/db/client';

import {
  isCategory,
  isContactChannel,
  isDistrictOf,
  isGovernorate,
  MAX_CATEGORIES,
  type GovernorateKey,
} from './categories';
import { providerSlug } from './slug';
import { ownWhere, type ProviderScope } from './scope';

/**
 * El negocio de un proveedor: crearlo, editarlo, traducirlo y mandarlo a
 * revisión.
 *
 * Toda consulta que toca un proveedor lleva `scopedWhere(scope)` en el WHERE, y
 * el ámbito solo se acuña comprobando la membresía contra la base. Un
 * `providerId` que llegue de un formulario no decide nada: si no es suyo, la
 * consulta no encuentra fila — y «no es tuyo» responde lo mismo que «no existe»,
 * porque distinguirlos ya cuenta que existe.
 */

export type ProviderProblem =
  | 'name'
  | 'governorate'
  | 'district'
  | 'city'
  | 'category'
  | 'tooManyCategories'
  | 'channel'
  | 'notFound'
  | 'notDraft';

export interface ProviderInput {
  legalName: string;
  governorate: string;
  district: string;
  city: string;
  mainLocale: string;
}

export interface ProviderRow {
  id: string;
  slug: string;
  legalName: string;
  status: string;
  governorate: string;
  district: string;
  city: string;
  submittedAt: Date | null;
  publishedAt: Date | null;
  verifiedAt: Date | null;
  rejectedNote: string | null;
}

function clean(value: string, max: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

/**
 * Da de alta un negocio, en `draft`, y a quien lo crea como administrador.
 *
 * Las dos cosas en la MISMA transacción: un proveedor sin nadie que lo
 * administre es una fila que nadie puede tocar nunca más, ni siquiera para
 * borrarla.
 */
export async function createProvider(
  userId: string,
  input: ProviderInput,
): Promise<{ ok: true; id: string; slug: string } | { ok: false; problems: ProviderProblem[] }> {
  const problems: ProviderProblem[] = [];

  const legalName = clean(input.legalName, 120);
  if (legalName.length < 2) problems.push('name');
  if (!isGovernorate(input.governorate)) problems.push('governorate');
  else if (!isDistrictOf(input.governorate, input.district)) problems.push('district');
  const city = clean(input.city, 80);
  if (city.length < 2) problems.push('city');

  if (problems.length > 0) return { ok: false, problems };

  const prisma = controlDb();
  const taken = await prisma.provider.findMany({ select: { slug: true } });
  const slug = providerSlug(legalName, taken.map((row) => row.slug));

  const provider = await prisma.$transaction(async (tx) => {
    const created = await tx.provider.create({
      data: {
        slug,
        legalName,
        governorate: input.governorate as GovernorateKey,
        district: input.district,
        city,
        mainLocale: input.mainLocale,
        status: 'draft',
      },
      select: { id: true, slug: true },
    });
    await tx.providerMembership.create({
      data: { userId, providerId: created.id, role: 'PROVIDER_ADMIN' },
    });
    return created;
  });

  await recordAudit({
    tenantId: null,
    actorId: userId,
    action: 'provider.create',
    entity: 'Provider',
    entityId: provider.id,
    metadata: { slug: provider.slug },
  });

  return { ok: true, id: provider.id, slug: provider.slug };
}

/** Lo suyo, y solo lo suyo. */
export async function readProvider(scope: ProviderScope): Promise<ProviderRow | null> {
  const row = await controlDb().provider.findFirst({
    where: ownWhere(scope),
    select: {
      id: true, slug: true, legalName: true, status: true, governorate: true,
      district: true, city: true, submittedAt: true, publishedAt: true,
      verifiedAt: true, rejectedNote: true,
    },
  });
  return row;
}

export async function updateProvider(
  scope: ProviderScope,
  userId: string,
  input: Partial<ProviderInput> & { capacity?: number | null; since?: number | null },
): Promise<{ ok: true } | { ok: false; problems: ProviderProblem[] }> {
  const problems: ProviderProblem[] = [];
  const data: Record<string, unknown> = {};

  if (input.legalName !== undefined) {
    const legalName = clean(input.legalName, 120);
    if (legalName.length < 2) problems.push('name');
    else data['legalName'] = legalName;
  }
  if (input.governorate !== undefined) {
    if (!isGovernorate(input.governorate)) problems.push('governorate');
    else {
      // El distrito se comprueba contra la gobernación que se va a guardar, no
      // contra la que había: cambiar solo una de las dos deja una región que no
      // existe.
      const district = input.district ?? '';
      if (!isDistrictOf(input.governorate, district)) problems.push('district');
      else {
        data['governorate'] = input.governorate;
        data['district'] = district;
      }
    }
  }
  if (input.city !== undefined) {
    const city = clean(input.city, 80);
    if (city.length < 2) problems.push('city');
    else data['city'] = city;
  }
  if (input.capacity !== undefined) data['capacity'] = input.capacity;
  if (input.since !== undefined) data['since'] = input.since;

  if (problems.length > 0) return { ok: false, problems };

  const updated = await controlDb().provider.updateMany({
    where: ownWhere(scope),
    data,
  });
  if (updated.count === 0) return { ok: false, problems: ['notFound'] };

  await recordAudit({
    tenantId: null,
    actorId: userId,
    action: 'provider.update',
    entity: 'Provider',
    entityId: scope.providerId,
    metadata: { fields: Object.keys(data).join(' ') },
  });
  return { ok: true };
}

/**
 * Lo que se publica en un idioma del portal.
 *
 * REEMPLAZA la traducción entera de ese idioma. Un nombre vacío la borra: es la
 * forma de retirar un idioma que se escribió y ya no se quiere.
 */
export async function setTranslation(
  scope: ProviderScope,
  userId: string,
  locale: string,
  input: { name: string; tagline: string; description: string; services: string[] },
): Promise<{ ok: boolean }> {
  const prisma = controlDb();
  const name = clean(input.name, 120);

  if (name.length === 0) {
    await prisma.providerTranslation.deleteMany({
      where: { providerId: scope.providerId, locale },
    });
  } else {
    const data = {
      name,
      tagline: clean(input.tagline, 160) || null,
      description: input.description.trim().slice(0, 2000) || null,
      services: input.services.map((line) => clean(line, 60)).filter((line) => line.length > 0).slice(0, 20),
    };
    await prisma.providerTranslation.upsert({
      where: { providerId_locale: { providerId: scope.providerId, locale } },
      update: data,
      create: { providerId: scope.providerId, locale, ...data },
    });
  }

  await recordAudit({
    tenantId: null,
    actorId: userId,
    action: name.length === 0 ? 'provider.translation.remove' : 'provider.translation.set',
    entity: 'Provider',
    entityId: scope.providerId,
    // El idioma sí; el texto NO. Un historial no es una copia del contenido.
    metadata: { locale },
  });
  return { ok: true };
}

/**
 * Las categorías, reemplazando la lista entera.
 *
 * Igual que los miembros de un grupo de invitados: guardando lo que llega en vez
 * de añadiendo, porque una casilla desmarcada no manda nada y sin reemplazar no
 * se podría quitar ninguna.
 */
export async function setCategories(
  scope: ProviderScope,
  userId: string,
  categories: readonly string[],
  primary: string,
): Promise<{ ok: true } | { ok: false; problems: ProviderProblem[] }> {
  const unique = [...new Set(categories)];
  if (unique.some((category) => !isCategory(category)) || !isCategory(primary)) {
    return { ok: false, problems: ['category'] };
  }
  if (unique.length > MAX_CATEGORIES) return { ok: false, problems: ['tooManyCategories'] };
  if (!unique.includes(primary)) return { ok: false, problems: ['category'] };

  const prisma = controlDb();
  // En una transacción: entre quitar y poner, un proveedor sin categorías no
  // sale en ningún listado, y eso se vería como «ha desaparecido».
  await prisma.$transaction(async (tx) => {
    await tx.providerCategoryLink.deleteMany({ where: { providerId: scope.providerId } });
    for (const category of unique) {
      await tx.providerCategoryLink.create({
        data: { providerId: scope.providerId, category, isPrimary: category === primary },
      });
    }
  });

  await recordAudit({
    tenantId: null,
    actorId: userId,
    action: 'provider.categories.set',
    entity: 'Provider',
    entityId: scope.providerId,
    metadata: { categories: unique.join(' '), primary },
  });
  return { ok: true };
}

/** Un canal de contacto, con su propio interruptor de publicación. */
export async function setContact(
  scope: ProviderScope,
  userId: string,
  channel: string,
  value: string,
  isPublic: boolean,
): Promise<{ ok: true } | { ok: false; problems: ProviderProblem[] }> {
  if (!isContactChannel(channel)) return { ok: false, problems: ['channel'] };

  const prisma = controlDb();
  const trimmed = value.trim().slice(0, 200);

  if (trimmed.length === 0) {
    await prisma.providerContact.deleteMany({
      where: { providerId: scope.providerId, channel },
    });
  } else {
    await prisma.providerContact.upsert({
      where: { providerId_channel: { providerId: scope.providerId, channel } },
      update: { value: trimmed, isPublic },
      create: { providerId: scope.providerId, channel, value: trimmed, isPublic },
    });
  }

  await recordAudit({
    tenantId: null,
    actorId: userId,
    action: 'provider.contact.set',
    entity: 'Provider',
    entityId: scope.providerId,
    // El canal y si se publica; NUNCA el número ni el correo. El historial no
    // repite el dato personal en otra tabla.
    metadata: { channel, isPublic },
  });
  return { ok: true };
}

/**
 * Manda el perfil a revisión.
 *
 * Solo desde `draft` o `rejected`: volver a mandar algo que ya está aprobado lo
 * sacaría del directorio mientras alguien lo mira otra vez, que es justo lo que
 * no se quiere. Y arranca el reloj de las veinticuatro horas.
 */
export async function submitForReview(
  scope: ProviderScope,
  userId: string,
): Promise<{ ok: true } | { ok: false; problems: ProviderProblem[] }> {
  const prisma = controlDb();

  const provider = await prisma.provider.findFirst({
    where: ownWhere(scope),
    select: { status: true, translations: { select: { locale: true } }, categories: { select: { id: true } } },
  });
  if (provider === null) return { ok: false, problems: ['notFound'] };
  if (provider.status !== 'draft' && provider.status !== 'rejected') {
    return { ok: false, problems: ['notDraft'] };
  }
  // Sin nombre en algún idioma no hay nada que revisar, y sin categoría no
  // aparecería en ningún listado aunque se aprobara.
  if (provider.translations.length === 0) return { ok: false, problems: ['name'] };
  if (provider.categories.length === 0) return { ok: false, problems: ['category'] };

  await prisma.provider.updateMany({
    where: ownWhere(scope),
    data: { status: 'pending_review', submittedAt: new Date(), rejectedNote: null },
  });
  await prisma.providerReview.create({
    data: { providerId: scope.providerId, action: 'submitted', actorId: userId },
  });

  await recordAudit({
    tenantId: null,
    actorId: userId,
    action: 'provider.submit',
    entity: 'Provider',
    entityId: scope.providerId,
    metadata: {},
  });
  return { ok: true };
}
