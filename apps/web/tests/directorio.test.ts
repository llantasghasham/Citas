import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { randomUUID } from 'node:crypto';

import sharp from 'sharp';

import { NEVER_GRANTABLE } from '../src/lib/auth/role-config';
import { controlDb } from '../src/lib/db/client';
import { isDistrictOf, isGovernorate } from '../src/lib/directory/categories';
import { providerScopeFor, ownWhere, unsafeProviderScope } from '../src/lib/directory/scope';
import {
  createProvider,
  readProvider,
  setCategories,
  setContact,
  setTranslation,
  submitForReview,
  updateProvider,
} from '../src/lib/directory/service';
import {
  businessHoursBetween,
  hoursLeft,
  isOverdue,
} from '../src/lib/directory/clock';
import { contactHref } from '../src/lib/directory/contacts';
import {
  addListingProvider,
  approvedListingSlugs,
  createListing,
  listingProviders,
  listingsForProvider,
  removeListingProvider,
  setProviderApproval,
  deleteListing,
  listPublicListings,
  listingBySlug,
  listingForEvent,
  submitListing,
} from '../src/lib/directory/listings';
import { tenantScope, type TenantScope } from '../src/lib/db/tenant';
import {
  fileReport,
  openReports,
  purgeReportIps,
  resolveReport,
} from '../src/lib/directory/reports';
import {
  approveProvider,
  decideListing,
  listingQueue,
  rejectProvider,
  restoreProvider,
  reviewQueue,
  setVerified,
  suspendProvider,
} from '../src/lib/directory/moderation';
import {
  addImage,
  listMedia,
  moveMedia,
  readableMedia,
  removeMedia,
  setVideo,
  MAX_IMAGES,
} from '../src/lib/directory/media';
import { asObjectKey, forgetStore, storeFor } from '../src/lib/storage';
import { directoryLocaleFrom } from '../src/lib/directory/locale';
import {
  approvedSlugs,
  categoryCounts,
  governorateCounts,
  listProviders,
  providerBySlug,
} from '../src/lib/directory/public';
import {
  currentProviderScope,
  myProviders,
  panelLocale,
} from '../src/lib/directory/session';
import { listingSlug, providerSlug } from '../src/lib/directory/slug';

import {
  CATEGORIES,
  CATEGORY_GROUPS,
  CONTACT_CHANNELS,
  GOVERNORATES,
  GOVERNORATE_KEYS,
} from '../src/lib/directory/categories';
import {
  DIRECTORY_LOCALES,
  directoryDirection,
  getDirectoryDictionary,
  isDirectoryLocale,
} from '@citas/core';

import { HAS_DB, withDatabase } from './helpers';

/**
 * Los cinco idiomas del portal contra las listas cerradas del servidor.
 *
 * Esto NO necesita base de datos y por eso no se salta nunca: es la comprobación
 * que impide que alguien añada una categoría en el código y la deje sin traducir
 * en alguno de los cinco. El fallo sin esta prueba es una tarjeta que dice
 * «undefined» en el portal de un negocio real.
 */
describe('los cinco idiomas del portal', () => {
  it('traducen TODAS las categorías, en los cinco', () => {
    for (const locale of DIRECTORY_LOCALES) {
      const copy = getDirectoryDictionary(locale);
      for (const category of CATEGORIES) {
        const name = copy.categories[category];
        assert.ok(
          name !== undefined && name.trim().length > 0,
          `falta la categoría «${category}» en ${locale}`,
        );
      }
      // Y al revés: una traducción de una categoría que ya no existe es una
      // frase que nadie va a ver y que alguien mantendrá por error.
      for (const key of Object.keys(copy.categories)) {
        assert.ok(
          (CATEGORIES as readonly string[]).includes(key),
          `sobra la categoría «${key}» en ${locale}`,
        );
      }
    }
  });

  it('traducen las ocho gobernaciones y todos sus distritos', () => {
    const districts = Object.values(GOVERNORATES).flat();
    for (const locale of DIRECTORY_LOCALES) {
      const copy = getDirectoryDictionary(locale);
      for (const governorate of GOVERNORATE_KEYS) {
        assert.ok(
          (copy.governorates[governorate] ?? '').length > 0,
          `falta la gobernación «${governorate}» en ${locale}`,
        );
      }
      for (const district of districts) {
        assert.ok(
          (copy.districts[district] ?? '').length > 0,
          `falta el distrito «${district}» en ${locale}`,
        );
      }
    }
  });

  it('traducen los grupos y los canales de contacto', () => {
    for (const locale of DIRECTORY_LOCALES) {
      const copy = getDirectoryDictionary(locale);
      for (const group of Object.keys(CATEGORY_GROUPS)) {
        assert.ok(
          (copy.groups[group as keyof typeof copy.groups] ?? '').length > 0,
          `falta el grupo «${group}» en ${locale}`,
        );
      }
      for (const channel of CONTACT_CHANNELS) {
        assert.ok((copy.channels[channel] ?? '').length > 0, `falta «${channel}» en ${locale}`);
      }
    }
  });

  it('el francés está, y el árabe sigue siendo el único de derecha a izquierda', () => {
    assert.deepEqual([...DIRECTORY_LOCALES], ['ar', 'en', 'fr', 'es', 'pt']);
    assert.equal(isDirectoryLocale('fr'), true);
    assert.equal(isDirectoryLocale('de'), false);

    assert.equal(directoryDirection('ar'), 'rtl');
    for (const locale of DIRECTORY_LOCALES.filter((one) => one !== 'ar')) {
      assert.equal(directoryDirection(locale), 'ltr');
    }
  });

  it('ninguna traducción se dejó a medias copiando del inglés', () => {
    // Una comprobación tonta y que sirve: si el francés y el inglés tienen el
    // mismo título de portada, alguien copió el archivo y no lo tradujo.
    const en = getDirectoryDictionary('en');
    for (const locale of ['fr', 'es', 'pt', 'ar'] as const) {
      const copy = getDirectoryDictionary(locale);
      assert.notEqual(copy.home.title, en.home.title, `${locale} parece copiado del inglés`);
      assert.notEqual(copy.search.submit, en.search.submit, `${locale} parece copiado del inglés`);
    }
  });
});

/**
 * El directorio: que un proveedor no pueda tocar a otro, y que nada suyo llegue
 * a la parte privada de una boda.
 *
 * Esto se prueba contra PostgreSQL de verdad y ANTES de escribir una sola
 * pantalla, porque es lo que decide si el directorio se puede vender: la
 * alternativa es enterarse el día que un salón vea la lista de invitados de una
 * boda, y ese día ya no hay nada que arreglar.
 */
describe('el directorio', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  let unoId = '';
  let dosId = '';
  let usuarioUno = '';
  let usuarioDos = '';

  const alta = async (nombre: string, email: string): Promise<{ providerId: string; userId: string }> => {
    const user = await controlDb().user.create({
      data: { email, locale: 'ar' },
      select: { id: true },
    });
    const result = await createProvider(user.id, {
      legalName: nombre,
      governorate: 'beirut',
      district: 'beirut',
      city: 'Beirut',
      mainLocale: 'ar',
    });
    assert.ok(result.ok, 'no se pudo dar de alta');
    return { providerId: result.id, userId: user.id };
  };

  beforeEach(async () => {
    const prisma = controlDb();
    await prisma.provider.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { startsWith: 'prov-' } } });

    const uno = await alta('Salon Uno', 'prov-uno@example.com');
    const dos = await alta('Salon Dos', 'prov-dos@example.com');
    unoId = uno.providerId;
    dosId = dos.providerId;
    usuarioUno = uno.userId;
    usuarioDos = dos.userId;
  });

  // ------------------------------------------------------------ el ámbito

  it('el ámbito solo se acuña con la membresía de verdad', async () => {
    // Este es el cierre entero: un providerId que llegue de un formulario no se
    // convierte en permiso porque alguien lo escriba. Hay que tener membresía.
    assert.notEqual(await providerScopeFor(usuarioUno, unoId), null);

    // El de Dos contra el negocio de Uno: nada.
    assert.equal(await providerScopeFor(usuarioDos, unoId), null);
    // Y al revés.
    assert.equal(await providerScopeFor(usuarioUno, dosId), null);
    // Un id inventado tampoco.
    assert.equal(await providerScopeFor(usuarioUno, 'cmtyinventadoinventado00'), null);
    assert.equal(await providerScopeFor(usuarioUno, ''), null);
  });

  it('quien crea un negocio queda dentro, en la MISMA transacción', async () => {
    // Un proveedor sin nadie que lo administre es una fila que nadie puede tocar
    // nunca más, ni siquiera para borrarla.
    const miembros = await controlDb().providerMembership.findMany({
      where: { providerId: unoId },
      select: { userId: true, role: true },
    });
    assert.deepEqual(miembros, [{ userId: usuarioUno, role: 'PROVIDER_ADMIN' }]);
  });

  // ---------------------------------------------- Dos contra todo lo de Uno

  it('Dos no lee, no edita y no traduce el negocio de Uno', async () => {
    const deUno = unsafeProviderScope(unoId);
    const deDos = unsafeProviderScope(dosId);

    // Con el ámbito de Dos, lo que se lee es lo de Dos. Nunca lo de Uno.
    const leido = await readProvider(deDos);
    assert.equal(leido?.id, dosId);
    assert.notEqual(leido?.id, unoId);

    // Editar con el ámbito de Dos no toca a Uno: la consulta lleva el id en el
    // WHERE, así que no encuentra fila.
    await updateProvider(deDos, usuarioDos, { legalName: 'Robado' });
    const uno = await readProvider(deUno);
    assert.equal(uno?.legalName, 'Salon Uno');

    // Y traducir tampoco.
    await setTranslation(deDos, usuarioDos, 'ar', {
      name: 'اسم مسروق', tagline: '', description: '', services: [],
    });
    const traducciones = await controlDb().providerTranslation.findMany({
      where: { providerId: unoId },
    });
    assert.equal(traducciones.length, 0);
  });

  it('las categorías y los contactos de Uno no se tocan desde Dos', async () => {
    const deUno = unsafeProviderScope(unoId);
    const deDos = unsafeProviderScope(dosId);

    await setCategories(deUno, usuarioUno, ['wedding_hall', 'catering'], 'wedding_hall');
    await setContact(deUno, usuarioUno, 'whatsapp', '+96170111111', true);

    // Dos escribe lo suyo: lo de Uno sigue igual.
    await setCategories(deDos, usuarioDos, ['dj'], 'dj');
    await setContact(deDos, usuarioDos, 'whatsapp', '+96170222222', true);

    const categorias = await controlDb().providerCategoryLink.findMany({
      where: { providerId: unoId },
      select: { category: true, isPrimary: true },
      orderBy: { category: 'asc' },
    });
    assert.deepEqual(categorias, [
      { category: 'catering', isPrimary: false },
      { category: 'wedding_hall', isPrimary: true },
    ]);

    const contacto = await controlDb().providerContact.findFirst({
      where: { providerId: unoId, channel: 'whatsapp' },
      select: { value: true },
    });
    assert.equal(contacto?.value, '+96170111111');
  });

  // ------------------------------------------------------ lo que impide la base

  it('un proveedor tiene UNA categoría principal, y lo impide la base', async () => {
    const deUno = unsafeProviderScope(unoId);
    await setCategories(deUno, usuarioUno, ['wedding_hall', 'catering'], 'wedding_hall');

    // A mano, saltándose el servicio: el índice único parcial no deja dos.
    await assert.rejects(
      controlDb().providerCategoryLink.updateMany({
        where: { providerId: unoId, category: 'catering' },
        data: { isPrimary: true },
      }),
    );
  });

  it('una sesión no puede ser de una oficina Y de un proveedor', async () => {
    // Es lo único que impide que quien administra un salón y además trabaja en
    // una oficina acabe con una sesión que vale para los dos sitios.
    await assert.rejects(
      controlDb().session.create({
        data: {
          userId: usuarioUno,
          tenantId: fixture.get().tenantId,
          providerId: unoId,
          tokenHash: `prueba-${Date.now()}`,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      }),
      /Session_one_scope|violates check/i,
    );

    // Cada una por separado sí.
    const sola = await controlDb().session.create({
      data: {
        userId: usuarioUno,
        providerId: unoId,
        tokenHash: `prueba-solo-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3600_000),
      },
      select: { id: true, tenantId: true, providerId: true },
    });
    assert.equal(sola.tenantId, null);
    assert.equal(sola.providerId, unoId);
  });

  it('el mapa exige dirección pública', async () => {
    // Publicar por descuido dónde vive quien hace pasteles en su cocina no se
    // arregla después.
    await assert.rejects(
      controlDb().provider.updateMany({
        where: ownWhere(unsafeProviderScope(unoId)),
        data: { lat: 33.8938, lng: 35.5018 },
      }),
      /Provider_map_needs_address|violates check/i,
    );
  });

  it('una denuncia de copyright sin correo no entra', async () => {
    await assert.rejects(
      controlDb().providerReport.create({
        data: { providerId: unoId, reason: 'copyright', message: 'son mis fotos' },
      }),
      /copyright_needs_email|violates check/i,
    );

    // Con correo sí, y las demás denuncias no lo exigen.
    await controlDb().providerReport.create({
      data: {
        providerId: unoId,
        reason: 'copyright',
        reporterEmail: 'fotografo@example.com',
        message: 'son mis fotos',
      },
    });
    await controlDb().providerReport.create({
      data: { providerId: unoId, reason: 'wrong_number' },
    });
  });

  it('una imagen oculta lleva motivo, y una imagen tiene llave', async () => {
    const prisma = controlDb();

    // Sin llave no es una imagen.
    await assert.rejects(
      prisma.providerMedia.create({ data: { providerId: unoId, kind: 'image' } }),
      /image_or_video|violates check/i,
    );
    // Un vídeo con llave tampoco.
    await assert.rejects(
      prisma.providerMedia.create({
        data: {
          providerId: unoId,
          kind: 'video',
          externalUrl: 'https://youtu.be/x',
          objectKey: 'providers/x/y.webp',
        },
      }),
      /image_or_video|violates check/i,
    );

    const media = await prisma.providerMedia.create({
      data: {
        providerId: unoId,
        kind: 'image',
        // Una imagen ocupa un hueco; sin él la base la rechaza, que es el tope
        // de diez visto desde abajo.
        slot: 0,
        objectKey: `providers/${unoId}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp`,
        status: 'approved',
      },
      select: { id: true },
    });

    // Ocultarla sin decir por qué, no.
    await assert.rejects(
      prisma.providerMedia.update({ where: { id: media.id }, data: { status: 'hidden' } }),
      /hidden_needs_reason|violates check/i,
    );
    await prisma.providerMedia.update({
      where: { id: media.id },
      data: { status: 'hidden', hiddenReason: 'copyright' },
    });
  });

  // ------------------------------------------------------------ la revisión

  it('sin nombre ni categoría no hay nada que revisar', async () => {
    const deUno = unsafeProviderScope(unoId);

    assert.deepEqual(await submitForReview(deUno, usuarioUno), {
      ok: false,
      problems: ['name'],
    });

    await setTranslation(deUno, usuarioUno, 'ar', {
      name: 'قاعة الأرز', tagline: '', description: '', services: [],
    });
    assert.deepEqual(await submitForReview(deUno, usuarioUno), {
      ok: false,
      problems: ['category'],
    });

    await setCategories(deUno, usuarioUno, ['wedding_hall'], 'wedding_hall');
    assert.deepEqual(await submitForReview(deUno, usuarioUno), { ok: true });

    const despues = await readProvider(deUno);
    assert.equal(despues?.status, 'pending_review');
    assert.notEqual(despues?.submittedAt, null);
  });

  it('lo ya aprobado no se manda otra vez a revisión', async () => {
    const deUno = unsafeProviderScope(unoId);
    await setTranslation(deUno, usuarioUno, 'ar', {
      name: 'قاعة', tagline: '', description: '', services: [],
    });
    await setCategories(deUno, usuarioUno, ['wedding_hall'], 'wedding_hall');
    await controlDb().provider.updateMany({
      where: ownWhere(deUno),
      data: { status: 'approved', publishedAt: new Date() },
    });

    // Volver a mandarlo lo sacaría del directorio mientras alguien lo mira otra
    // vez, que es justo lo que no se quiere.
    assert.deepEqual(await submitForReview(deUno, usuarioUno), {
      ok: false,
      problems: ['notDraft'],
    });
  });

  // ------------------------------------------------ el historial no cuenta de más

  it('el historial anota QUÉ pasó, nunca el teléfono ni el texto', async () => {
    const deUno = unsafeProviderScope(unoId);
    await setContact(deUno, usuarioUno, 'whatsapp', '+96170999888', true);
    await setTranslation(deUno, usuarioUno, 'fr', {
      name: 'Salle des Cedres', tagline: 'un secreto', description: 'otro secreto', services: [],
    });

    const filas = await controlDb().auditLog.findMany({
      where: { entityId: unoId },
      select: { action: true, metadata: true },
    });
    const todo = JSON.stringify(filas);
    assert.equal(todo.includes('70999888'), false, 'el historial se llevó el teléfono');
    assert.equal(todo.includes('un secreto'), false, 'el historial se llevó el texto');
    assert.equal(todo.includes('Salle des Cedres'), false, 'el historial se llevó el nombre');
    // Y sí dice lo que pasó.
    assert.ok(filas.some((fila) => fila.action === 'provider.contact.set'));
    assert.ok(filas.some((fila) => fila.action === 'provider.translation.set'));
  });

  // ---------------------------------------------- las listas cerradas y el slug

  it('una categoría o una región inventadas no entran', async () => {
    const deUno = unsafeProviderScope(unoId);

    assert.deepEqual(await setCategories(deUno, usuarioUno, ['discoteca'], 'discoteca'), {
      ok: false,
      problems: ['category'],
    });
    // Y no más de tres.
    assert.deepEqual(
      await setCategories(
        deUno,
        usuarioUno,
        ['wedding_hall', 'catering', 'dj', 'flowers'],
        'dj',
      ),
      { ok: false, problems: ['tooManyCategories'] },
    );
    // La principal tiene que estar entre las elegidas.
    assert.deepEqual(
      await setCategories(deUno, usuarioUno, ['wedding_hall'], 'catering'),
      { ok: false, problems: ['category'] },
    );

    assert.equal(isGovernorate('beirut'), true);
    assert.equal(isGovernorate('madrid'), false);
    // Un distrito suelto no significa nada: tiene que ser de SU gobernación.
    assert.equal(isDistrictOf('beirut', 'beirut'), true);
    assert.equal(isDistrictOf('beirut', 'tripoli'), false);
    assert.equal(isDistrictOf('north', 'tripoli'), true);
  });

  it('un nombre árabe NO se translitera en la dirección', async () => {
    // La misma regla que los slugs de invitación: transliterar un nombre propio
    // automáticamente es lo que este proyecto prohíbe, y además lo hace mal.
    const arabe = providerSlug('قاعة الأرز للأفراح', []);
    assert.match(arabe, /^p-[a-f0-9]{8}$/);

    // Uno en latino sí sale legible.
    assert.equal(providerSlug('Salle des Cedres', []), 'salle-des-cedres');
    // Y no pisa una ruta del sitio.
    assert.match(providerSlug('panel', []), /^p-[a-f0-9]{8}$/);
    // Ocupado: azar, no un contador que cuente cuántos hay con ese nombre.
    assert.match(providerSlug('Salle des Cedres', ['salle-des-cedres']), /^salle-des-cedres-[a-f0-9]{4}$/);
  });

  // --------------------------------------------------------------- el candado

  it('`directory:moderate` no se puede repartir desde una pantalla', () => {
    // Un proveedor que pudiera concederse ese permiso se aprobaría a sí mismo, y
    // entonces la moderación deja de existir.
    assert.ok(NEVER_GRANTABLE.includes('directory:moderate'));
    assert.ok(NEVER_GRANTABLE.includes('platform:manage'));
  });
});

/**
 * Lo que ve la calle.
 *
 * La regla que sostiene el directorio entero es que `status` decide, y decide en
 * la CONSULTA: si el filtro viviera en cada pantalla, la pantalla número seis se
 * escribiría sin él y un negocio en revisión —o suspendido por una denuncia—
 * volvería a la calle sin que nadie tocara nada.
 */
describe('el portal público', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  let enRevision = '';
  let publicado = '';
  let duenoPublicado = '';

  const alta = async (nombre: string, email: string): Promise<{ id: string; userId: string }> => {
    const user = await controlDb().user.create({ data: { email, locale: 'ar' }, select: { id: true } });
    const result = await createProvider(user.id, {
      legalName: nombre,
      governorate: 'mount_lebanon',
      district: 'jbeil',
      city: 'Jbeil',
      mainLocale: 'ar',
    });
    assert.ok(result.ok, 'no se pudo dar de alta');
    await setTranslation(unsafeProviderScope(result.id), user.id, 'ar', {
      name: nombre,
      tagline: '',
      description: '',
      services: [],
    });
    await setCategories(unsafeProviderScope(result.id), user.id, ['wedding_hall'], 'wedding_hall');
    return { id: result.id, userId: user.id };
  };

  beforeEach(async () => {
    const prisma = controlDb();
    await prisma.provider.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { startsWith: 'pub-' } } });

    enRevision = (await alta('En revision', 'pub-uno@example.com')).id;
    const dos = await alta('Publicado', 'pub-dos@example.com');
    publicado = dos.id;
    duenoPublicado = dos.userId;

    await prisma.provider.update({
      where: { id: enRevision },
      data: { status: 'pending_review', submittedAt: new Date() },
    });
    await prisma.provider.update({
      where: { id: publicado },
      data: { status: 'approved', publishedAt: new Date() },
    });
  });

  it('solo sale lo aprobado, y lo demás no existe ni por su dirección', async () => {
    const prisma = controlDb();
    const enRevisionSlug = (await prisma.provider.findUniqueOrThrow({
      where: { id: enRevision },
      select: { slug: true },
    })).slug;
    const publicadoSlug = (await prisma.provider.findUniqueOrThrow({
      where: { id: publicado },
      select: { slug: true },
    })).slug;

    const lista = await listProviders('ar');
    assert.deepEqual(lista.map((uno) => uno.slug), [publicadoSlug]);

    // Y por su dirección tampoco. «Todavía no publicado» y «no existe» se
    // contestan igual: decir lo primero ya es contar algo de un negocio que no
    // ha decidido publicarse.
    assert.notEqual(await providerBySlug(publicadoSlug, 'ar'), null);
    assert.equal(await providerBySlug(enRevisionSlug, 'ar'), null);

    // Suspender lo saca de la calle inmediatamente, sin borrar nada.
    await prisma.provider.update({ where: { id: publicado }, data: { status: 'suspended' } });
    assert.equal(await providerBySlug(publicadoSlug, 'ar'), null);
    assert.deepEqual(await listProviders('ar'), []);
  });

  it('los recuentos cuentan lo aprobado y nada más', async () => {
    assert.equal((await categoryCounts()).get('wedding_hall'), 1);
    assert.equal((await governorateCounts()).get('mount_lebanon'), 1);

    await controlDb().provider.update({
      where: { id: enRevision },
      data: { status: 'approved', publishedAt: new Date() },
    });
    assert.equal((await categoryCounts()).get('wedding_hall'), 2);
    assert.equal((await governorateCounts()).get('mount_lebanon'), 2);
  });

  it('sin nombre en ningún idioma no hay ficha, en vez de una tarjeta vacía', async () => {
    await controlDb().providerTranslation.deleteMany({ where: { providerId: publicado } });
    assert.deepEqual(await listProviders('ar'), []);
  });

  it('el idioma cae al del negocio antes que a nada', async () => {
    // Escrito en árabe y leído en francés: sale el árabe, porque el respaldo es
    // `mainLocale`. No se traduce solo.
    const enFrances = await listProviders('fr');
    assert.equal(enFrances.length, 1);
    assert.equal(enFrances[0]?.name, 'Publicado');

    await setTranslation(unsafeProviderScope(publicado), duenoPublicado, 'fr', {
      name: 'Publié',
      tagline: '',
      description: '',
      services: [],
    });
    assert.equal((await listProviders('fr'))[0]?.name, 'Publié');
    // Y el árabe sigue siendo el árabe.
    assert.equal((await listProviders('ar'))[0]?.name, 'Publicado');
  });

  it('un contacto que no es público no sale', async () => {
    const scope = unsafeProviderScope(publicado);
    await setContact(scope, duenoPublicado, 'phone', '+96181000000', false);
    const slug = (await controlDb().provider.findUniqueOrThrow({
      where: { id: publicado },
      select: { slug: true },
    })).slug;

    assert.deepEqual((await providerBySlug(slug, 'ar'))?.contacts, []);

    await setContact(scope, duenoPublicado, 'phone', '+96181000000', true);
    assert.deepEqual((await providerBySlug(slug, 'ar'))?.contacts, [
      { channel: 'phone', value: '+96181000000' },
    ]);
  });

  it('los filtros filtran, y un distrito de otra región no encuentra nada', async () => {
    assert.equal((await listProviders('ar', { governorate: 'mount_lebanon' })).length, 1);
    assert.equal((await listProviders('ar', { governorate: 'beirut' })).length, 0);
    assert.equal((await listProviders('ar', { district: 'jbeil' })).length, 1);
    assert.equal((await listProviders('ar', { category: 'wedding_hall' })).length, 1);
    assert.equal((await listProviders('ar', { category: 'dj' })).length, 0);
    assert.equal((await listProviders('ar', { query: 'Public' })).length, 1);
    assert.equal((await listProviders('ar', { query: 'no existe eso' })).length, 0);
  });

  void fixture;
});

/**
 * El idioma de quien llega a `/d` sin decir cuál, y a dónde lleva cada contacto.
 *
 * Sin base de datos: son dos funciones puras y se comprueban siempre.
 */
describe('la puerta del portal', () => {
  it('negocia el idioma, y el francés cuenta aquí aunque no en el producto', () => {
    assert.equal(directoryLocaleFrom('fr-LB,fr;q=0.9,ar;q=0.8'), 'fr');
    assert.equal(directoryLocaleFrom('ar-LB,ar;q=0.9'), 'ar');
    assert.equal(directoryLocaleFrom('pt-BR'), 'pt');
    // El peso manda sobre el orden de escritura.
    assert.equal(directoryLocaleFrom('de;q=1.0,es;q=0.9,en;q=0.95'), 'en');
    // Nada conocido, y nada escrito: árabe, que es el idioma del mercado.
    assert.equal(directoryLocaleFrom('de-DE,ja;q=0.8'), 'ar');
    assert.equal(directoryLocaleFrom(''), 'ar');
  });

  it('cada canal lleva a donde tiene que llevar', () => {
    assert.equal(contactHref('phone', '+9611234567'), 'tel:+9611234567');
    // `wa.me` quiere el número sin el «+»: con él, el enlace no abre nada.
    assert.equal(contactHref('whatsapp', '+961 81 000 000'), 'https://wa.me/96181000000');
    assert.equal(contactHref('email', 'hola@example.com'), 'mailto:hola@example.com');
    assert.equal(contactHref('website', 'example.com'), 'https://example.com');
    assert.equal(contactHref('website', 'https://example.com'), 'https://example.com');
    assert.equal(contactHref('instagram', '@salon'), 'https://instagram.com/salon');
    assert.equal(contactHref('tiktok', 'salon'), 'https://tiktok.com/@salon');
    // Un canal que no está en la lista no se convierte en un enlace roto.
    assert.equal(contactHref('telegrama', 'algo'), null);
  });
});

/**
 * Las imágenes: el tope de diez, y quién puede ver qué.
 *
 * Sobre el tope hay que ser preciso, porque aquí ya se contó una mentira una
 * vez: la prueba de las doce subidas a la vez comprueba el COMPORTAMIENTO —que
 * de doce entren diez— pero NO demuestra por sí sola que aguante una carrera.
 * Se escribió creyendo que sí, y pasaba igual con el bloqueo quitado, porque
 * Prisma serializa hoy esas transacciones. Una prueba que pasa con el candado
 * puesto y quitado no está probando el candado.
 *
 * Lo que sostiene el tope es el índice único parcial sobre `(providerId, slot)`,
 * y eso se comprueba donde se puede comprobar de verdad: en `npm run db:check`,
 * mirando que el índice EXISTE sobre una base migrada desde cero. Aquí abajo se
 * comprueba lo otro que sí es determinista — que la base RECHAZA dos imágenes
 * en el mismo hueco— sin depender de ganar ninguna carrera.
 */
describe('las imágenes del directorio', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  let providerId = '';
  let duenoId = '';
  let ajenoId = '';

  /** Una imagen de verdad, del tamaño mínimo que acepta el procesado. */
  const foto = async (): Promise<File> => {
    const png = await sharp({
      create: { width: 600, height: 600, channels: 3, background: '#c9a227' },
    })
      .png()
      .toBuffer();
    return new File([new Uint8Array(png)], 'foto.png', { type: 'image/png' });
  };

  beforeEach(async () => {
    const prisma = controlDb();
    forgetStore();
    await prisma.provider.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { startsWith: 'med-' } } });

    const dueno = await prisma.user.create({
      data: { email: 'med-dueno@example.com', locale: 'ar' },
      select: { id: true },
    });
    const ajeno = await prisma.user.create({
      data: { email: 'med-ajeno@example.com', locale: 'ar' },
      select: { id: true },
    });
    const result = await createProvider(dueno.id, {
      legalName: 'Salon con fotos',
      governorate: 'beirut',
      district: 'beirut',
      city: 'Beirut',
      mainLocale: 'ar',
    });
    assert.ok(result.ok, 'no se pudo dar de alta');

    providerId = result.id;
    duenoId = dueno.id;
    ajenoId = ajeno.id;
  });

  it('la BASE rechaza dos imágenes en el mismo hueco', async () => {
    // Esta es la prueba del tope, y no depende de ninguna carrera: se intenta a
    // mano lo que haría una segunda subida que eligiera un hueco ya ocupado.
    const prisma = controlDb();
    const comun = {
      providerId,
      kind: 'image' as const,
      mimeType: 'image/webp',
      status: 'pending_review' as const,
    };

    await prisma.providerMedia.create({
      data: { ...comun, slot: 0, objectKey: `providers/${providerId}/${randomUUID()}.webp` },
    });

    await assert.rejects(
      prisma.providerMedia.create({
        data: { ...comun, slot: 0, objectKey: `providers/${providerId}/${randomUUID()}.webp` },
      }),
      'la base admitió dos imágenes en el hueco 0',
    );

    // Y un hueco fuera de rango tampoco: sin eso, «hueco once» sería válido y el
    // tope no sería un tope.
    await assert.rejects(
      prisma.providerMedia.create({
        data: { ...comun, slot: 10, objectKey: `providers/${providerId}/${randomUUID()}.webp` },
      }),
      'la base admitió el hueco 10',
    );
  });

  it('de doce subidas a la vez entran diez', async () => {
    const scope = unsafeProviderScope(providerId);
    const archivos = await Promise.all(Array.from({ length: 12 }, () => foto()));

    const resultados = await Promise.all(
      archivos.map((file) => addImage(scope, duenoId, file)),
    );

    const aceptadas = resultados.filter((one) => one.ok).length;
    const rechazadas = resultados.filter((one) => !one.ok).length;
    assert.equal(aceptadas, MAX_IMAGES, `se aceptaron ${aceptadas}`);
    assert.equal(rechazadas, 12 - MAX_IMAGES);

    // Y la base dice lo mismo, que es lo que de verdad se cuenta.
    const enBase = await controlDb().providerMedia.count({
      where: { providerId, kind: 'image' },
    });
    assert.equal(enBase, MAX_IMAGES);

    // Las que perdieron la carrera no dejan bytes detrás: se retiran del almacén
    // en el mismo camino que las rechaza.
    const filas = await controlDb().providerMedia.findMany({
      where: { providerId },
      select: { objectKey: true },
    });
    const store = storeFor();
    for (const fila of filas) {
      const key = asObjectKey(fila.objectKey ?? '');
      assert.ok(key !== null && (await store.head(key)) !== null, 'falta el objeto de una fila');
    }
  });

  it('lo subido nace EN REVISIÓN y no lo ve la calle', async () => {
    const scope = unsafeProviderScope(providerId);
    const subida = await addImage(scope, duenoId, await foto());
    assert.ok(subida.ok);

    const fila = await controlDb().providerMedia.findUniqueOrThrow({
      where: { id: subida.id },
      select: { status: true, mimeType: true, width: true, height: true },
    });
    assert.equal(fila.status, 'pending_review');
    // Recodificada: entró un PNG y se guarda WEBP.
    assert.equal(fila.mimeType, 'image/webp');
    assert.equal(fila.width, 600);
    assert.equal(fila.height, 600);

    const nadie = { userId: null, isSuperadmin: false, canModerate: false };
    assert.equal(await readableMedia(subida.id, nadie, 'full'), null);
    // Su dueño sí la ve: es la suya y la tiene que poder mirar antes de que la
    // aprueben.
    assert.notEqual(
      await readableMedia(subida.id, { ...nadie, userId: duenoId }, 'full'),
      null,
    );
    // Quien modera también, que es de lo que va moderar.
    assert.notEqual(await readableMedia(subida.id, { ...nadie, canModerate: true }, 'full'), null);
    // Y alguien de fuera con cuenta, no.
    assert.equal(await readableMedia(subida.id, { ...nadie, userId: ajenoId }, 'full'), null);
  });

  it('suspender el negocio saca sus fotos de la calle, aunque estén aprobadas', async () => {
    const prisma = controlDb();
    const scope = unsafeProviderScope(providerId);
    const subida = await addImage(scope, duenoId, await foto());
    assert.ok(subida.ok);

    await prisma.providerMedia.update({
      where: { id: subida.id },
      data: { status: 'approved', publishedAt: new Date() },
    });
    await prisma.provider.update({
      where: { id: providerId },
      data: { status: 'approved', publishedAt: new Date() },
    });

    const nadie = { userId: null, isSuperadmin: false, canModerate: false };
    assert.notEqual(await readableMedia(subida.id, nadie, 'full'), null);

    // Las DOS cosas tienen que estar aprobadas. Con solo la imagen, suspender un
    // negocio le dejaría la galería sirviéndose.
    await prisma.provider.update({ where: { id: providerId }, data: { status: 'suspended' } });
    assert.equal(await readableMedia(subida.id, nadie, 'full'), null);
  });

  it('la miniatura es otro objeto, y existe', async () => {
    const scope = unsafeProviderScope(providerId);
    const subida = await addImage(scope, duenoId, await foto());
    assert.ok(subida.ok);

    const conModerador = { userId: null, isSuperadmin: false, canModerate: true };
    const grande = await readableMedia(subida.id, conModerador, 'full');
    const chica = await readableMedia(subida.id, conModerador, 'thumb');
    assert.ok(grande !== null && chica !== null);
    assert.notEqual(grande.key, chica.key);

    const store = storeFor();
    const bytesGrande = await store.get(grande.key);
    const bytesChica = await store.get(chica.key);
    assert.ok(bytesGrande !== null && bytesChica !== null);
    assert.ok(bytesChica.body.byteLength < bytesGrande.body.byteLength);
  });

  it('quitar una borra la fila Y el objeto, y una de otro negocio no se toca', async () => {
    const scope = unsafeProviderScope(providerId);
    const subida = await addImage(scope, duenoId, await foto());
    assert.ok(subida.ok);

    const fila = await controlDb().providerMedia.findUniqueOrThrow({
      where: { id: subida.id },
      select: { objectKey: true, thumbKey: true },
    });
    const store = storeFor();
    const key = asObjectKey(fila.objectKey ?? '');
    const thumb = asObjectKey(fila.thumbKey ?? '');
    assert.ok(key !== null && thumb !== null);

    // Con el ámbito de OTRO negocio no encuentra fila, en vez de encontrarla y
    // borrarla.
    const otro = await createProvider(ajenoId, {
      legalName: 'Otro salon',
      governorate: 'beirut',
      district: 'beirut',
      city: 'Beirut',
      mainLocale: 'ar',
    });
    assert.ok(otro.ok);
    assert.deepEqual(await removeMedia(unsafeProviderScope(otro.id), ajenoId, subida.id), {
      ok: false,
      problems: ['notFound'],
    });
    assert.notEqual(await store.head(key), null);

    assert.deepEqual(await removeMedia(scope, duenoId, subida.id), { ok: true });
    assert.equal(await controlDb().providerMedia.count({ where: { providerId } }), 0);
    assert.equal(await store.head(key), null);
    assert.equal(await store.head(thumb), null);
  });

  it('subir y bajar intercambia el orden, y en el extremo no hace nada', async () => {
    const scope = unsafeProviderScope(providerId);
    const uno = await addImage(scope, duenoId, await foto());
    const dos = await addImage(scope, duenoId, await foto());
    assert.ok(uno.ok && dos.ok);

    const orden = async (): Promise<string[]> =>
      (await listMedia(scope)).filter((one) => one.kind === 'image').map((one) => one.id);

    assert.deepEqual(await orden(), [uno.id, dos.id]);
    assert.deepEqual(await moveMedia(scope, dos.id, 'up'), { ok: true });
    assert.deepEqual(await orden(), [dos.id, uno.id]);

    // Ya está arriba del todo: no es un error, es que no hay a dónde.
    assert.deepEqual(await moveMedia(scope, dos.id, 'up'), { ok: true });
    assert.deepEqual(await orden(), [dos.id, uno.id]);
  });

  it('el vídeo es UNO, de un sitio conocido, y vaciar lo quita', async () => {
    const scope = unsafeProviderScope(providerId);

    // Una dirección cualquiera no entra: un `<iframe>` a una página cualquiera
    // en la ficha de un salón ejecuta lo que quiera en nuestro dominio.
    assert.deepEqual(await setVideo(scope, duenoId, 'https://malo.example/v'), {
      ok: false,
      problems: ['badVideo'],
    });
    assert.deepEqual(await setVideo(scope, duenoId, 'http://youtube.com/watch?v=x'), {
      ok: false,
      problems: ['badVideo'],
    });

    assert.deepEqual(await setVideo(scope, duenoId, 'https://www.youtube.com/watch?v=abc'), {
      ok: true,
    });
    const primeros = (await listMedia(scope)).filter((one) => one.kind === 'video');
    assert.equal(primeros.length, 1);

    // Poner otro REEMPLAZA: uno, no dos.
    assert.deepEqual(await setVideo(scope, duenoId, 'https://vimeo.com/12345'), { ok: true });
    const segundos = (await listMedia(scope)).filter((one) => one.kind === 'video');
    assert.equal(segundos.length, 1);
    assert.match(segundos[0]?.externalUrl ?? '', /vimeo\.com/);

    assert.deepEqual(await setVideo(scope, duenoId, '  '), { ok: true });
    assert.equal((await listMedia(scope)).filter((one) => one.kind === 'video').length, 0);
  });

  it('el historial anota los bytes, jamás el nombre del archivo', async () => {
    const scope = unsafeProviderScope(providerId);
    const subida = await addImage(scope, duenoId, await foto());
    assert.ok(subida.ok);

    const linea = await controlDb().auditLog.findFirst({
      where: { action: 'provider.media.upload', entityId: providerId },
      select: { metadata: true },
    });
    const texto = JSON.stringify(linea?.metadata ?? {});
    assert.match(texto, /bytes/);
    assert.doesNotMatch(texto, /foto\.png/);
  });

  void fixture;
});

/**
 * Quién administra qué, resuelto para una pantalla.
 *
 * El `providerId` viaja en la dirección y en un campo oculto —tiene que viajar,
 * hay quien administra dos— así que es un dato del cliente. Esto es lo que hace
 * que no sea además un permiso.
 */
describe('el panel del proveedor', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  let unoId = '';
  let dosId = '';
  let usuario = '';
  let otro = '';

  beforeEach(async () => {
    const prisma = controlDb();
    await prisma.provider.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { startsWith: 'pan-' } } });

    const a = await prisma.user.create({ data: { email: 'pan-a@example.com', locale: 'ar' }, select: { id: true } });
    const b = await prisma.user.create({ data: { email: 'pan-b@example.com', locale: 'es' }, select: { id: true } });
    usuario = a.id;
    otro = b.id;

    const uno = await createProvider(a.id, {
      legalName: 'Negocio de A', governorate: 'beirut', district: 'beirut', city: 'Beirut', mainLocale: 'ar',
    });
    const dos = await createProvider(b.id, {
      legalName: 'Negocio de B', governorate: 'north', district: 'tripoli', city: 'Tripoli', mainLocale: 'ar',
    });
    assert.ok(uno.ok && dos.ok);
    unoId = uno.id;
    dosId = dos.id;
  });

  it('con uno solo no hay que elegir; con el de otro no hay ámbito', async () => {
    const solo = await currentProviderScope(usuario, undefined);
    assert.equal(solo?.providerId, unoId);

    // El id de OTRO en la dirección no abre nada. Es el caso entero: sin esta
    // comprobación, cambiar un parámetro edita el perfil de un competidor.
    assert.equal(await currentProviderScope(usuario, dosId), null);
    assert.equal(await currentProviderScope(otro, unoId), null);
    // Uno inventado tampoco.
    assert.equal(await currentProviderScope(usuario, 'cmtyinventadoinventado00'), null);
  });

  it('con dos, NO se adivina cuál', async () => {
    // Se le añade a A un segundo negocio.
    const tres = await createProvider(usuario, {
      legalName: 'Segundo de A', governorate: 'bekaa', district: 'zahle', city: 'Zahle', mainLocale: 'ar',
    });
    assert.ok(tres.ok);

    // Sin pedir cuál, ninguno: adivinar es publicar una foto en el negocio
    // equivocado.
    assert.equal(await currentProviderScope(usuario, undefined), null);
    // Pidiéndolo, el suyo.
    assert.equal((await currentProviderScope(usuario, tres.id))?.providerId, tres.id);
    assert.equal((await currentProviderScope(usuario, unoId))?.providerId, unoId);

    const mios = await myProviders(usuario);
    assert.deepEqual(mios.map((one) => one.legalName).sort(), ['Negocio de A', 'Segundo de A']);
  });

  it('el idioma del panel sale del perfil, y el francés solo si se pide', () => {
    assert.equal(panelLocale(undefined, 'ar'), 'ar');
    assert.equal(panelLocale(undefined, 'es'), 'es');
    // El francés no está en el perfil de nadie —el producto habla cuatro— así
    // que solo puede llegar por la dirección.
    assert.equal(panelLocale('fr', 'es'), 'fr');
    // Basura en la dirección no cambia nada.
    assert.equal(panelLocale('de', 'es'), 'es');
    // Y sin nada, árabe.
    assert.equal(panelLocale(undefined, null), 'ar');
  });

  void fixture;
});

/**
 * El reloj de las veinticuatro horas HÁBILES.
 *
 * Sin base de datos, así que no se salta nunca. Y hace falta porque una fórmula
 * cerrada —días por ocho, más los extremos— es donde se cuelan los errores de un
 * día: el fin de semana, el cambio de hora y empezar y terminar la misma tarde.
 */
describe('el plazo de la moderación', () => {
  // Todo en Asia/Beirut, que es la zona de la plataforma. Las fechas se escriben
  // como instantes UTC y se comprueba lo que marca allí.
  const beirut = (iso: string): Date => new Date(iso);

  it('un martes por la mañana cuenta las horas de la jornada', () => {
    // Martes 10:00 → martes 15:00 en Beirut (UTC+3 en verano).
    const desde = beirut('2026-09-15T07:00:00Z');
    const hasta = beirut('2026-09-15T12:00:00Z');
    assert.equal(businessHoursBetween(desde, hasta), 5);
  });

  it('la noche no cuenta', () => {
    // Martes 16:00 → miércoles 10:00. Una hora del martes y una del miércoles.
    const desde = beirut('2026-09-15T13:00:00Z');
    const hasta = beirut('2026-09-16T07:00:00Z');
    assert.equal(businessHoursBetween(desde, hasta), 2);
  });

  it('el fin de semana no cuenta, y por eso el viernes por la tarde no está atrasado el sábado', () => {
    // Viernes 16:00 en Beirut.
    const viernes = beirut('2026-09-18T13:00:00Z');
    // Sábado a mediodía: ha pasado una jornada de nada.
    assert.equal(businessHoursBetween(viernes, beirut('2026-09-19T09:00:00Z')), 1);
    assert.equal(isOverdue(viernes, beirut('2026-09-19T09:00:00Z')), false);
    // Domingo tampoco.
    assert.equal(isOverdue(viernes, beirut('2026-09-20T09:00:00Z')), false);
    // El lunes por la tarde van 1 + 8 = 9 horas hábiles: sigue en plazo.
    assert.equal(isOverdue(viernes, beirut('2026-09-21T13:00:00Z')), false);
    // El miércoles por la tarde ya son más de veinticuatro.
    assert.equal(isOverdue(viernes, beirut('2026-09-23T13:00:00Z')), true);
  });

  it('veinticuatro horas hábiles son TRES jornadas', () => {
    // Lunes a las 9:00 en Beirut.
    const lunes = beirut('2026-09-14T06:00:00Z');
    // Jueves a las 9:00: lunes, martes y miércoles enteros.
    assert.equal(businessHoursBetween(lunes, beirut('2026-09-17T06:00:00Z')), 24);
    assert.equal(isOverdue(lunes, beirut('2026-09-17T06:00:00Z')), true);
    // Un minuto antes, no.
    assert.equal(isOverdue(lunes, beirut('2026-09-16T13:00:00Z')), false);
  });

  it('hacia atrás y en el mismo instante es cero, no un número negativo', () => {
    const ahora = beirut('2026-09-15T07:00:00Z');
    assert.equal(businessHoursBetween(ahora, ahora), 0);
    assert.equal(businessHoursBetween(ahora, beirut('2026-09-14T07:00:00Z')), 0);
    assert.equal(hoursLeft(ahora, ahora), 24);
    // Y lo que queda nunca baja de cero.
    assert.equal(hoursLeft(beirut('2026-09-01T06:00:00Z'), ahora), 0);
  });
});

/**
 * La moderación: lo que decide si el directorio se puede enseñar.
 */
describe('la moderación', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  let providerId = '';
  let duenoId = '';
  let moderadorId = '';

  beforeEach(async () => {
    const prisma = controlDb();
    await prisma.provider.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { startsWith: 'mod-' } } });

    const dueno = await prisma.user.create({
      data: { email: 'mod-dueno@example.com', locale: 'ar' },
      select: { id: true },
    });
    const moderador = await prisma.user.create({
      data: { email: 'mod-quien@example.com', locale: 'es', isSuperadmin: true },
      select: { id: true },
    });
    duenoId = dueno.id;
    moderadorId = moderador.id;

    const result = await createProvider(dueno.id, {
      legalName: 'Salon a revisar',
      governorate: 'beirut',
      district: 'beirut',
      city: 'Beirut',
      mainLocale: 'ar',
    });
    assert.ok(result.ok);
    providerId = result.id;

    await setTranslation(unsafeProviderScope(providerId), dueno.id, 'ar', {
      name: 'قاعة',
      tagline: '',
      description: '',
      services: [],
    });
    await setCategories(unsafeProviderScope(providerId), dueno.id, ['wedding_hall'], 'wedding_hall');
    await submitForReview(unsafeProviderScope(providerId), dueno.id);
  });

  it('lo mandado sale en la cola, lo más viejo primero', async () => {
    const cola = await reviewQueue();
    assert.equal(cola.length, 1);
    assert.equal(cola[0]?.id, providerId);
    assert.equal(cola[0]?.overdue, false);

    // Aprobarlo lo saca de la cola y lo pone en la calle.
    assert.deepEqual(await approveProvider(providerId, moderadorId), { ok: true });
    assert.deepEqual(await reviewQueue(), []);
    assert.equal((await listProviders('ar')).length, 1);
  });

  it('rechazar EXIGE motivo, y el motivo se le enseña a quien lo mandó', async () => {
    assert.deepEqual(await rejectProvider(providerId, moderadorId, '  '), {
      ok: false,
      problems: ['note'],
    });
    // Y sigue en revisión: un rechazo que falla no cambia nada.
    assert.equal((await reviewQueue()).length, 1);

    assert.deepEqual(
      await rejectProvider(providerId, moderadorId, 'Las fotos son de otro salón.'),
      { ok: true },
    );
    const fila = await controlDb().provider.findUniqueOrThrow({
      where: { id: providerId },
      select: { status: true, rejectedNote: true },
    });
    assert.equal(fila.status, 'rejected');
    assert.equal(fila.rejectedNote, 'Las fotos son de otro salón.');
    assert.deepEqual(await listProviders('ar'), []);
  });

  it('suspender saca de la calle; volver a publicar NO reescribe la fecha de estreno', async () => {
    await approveProvider(providerId, moderadorId);
    const estreno = (
      await controlDb().provider.findUniqueOrThrow({
        where: { id: providerId },
        select: { publishedAt: true },
      })
    ).publishedAt;
    assert.ok(estreno !== null);

    assert.deepEqual(await suspendProvider(providerId, moderadorId, 'Un cliente denunció.'), {
      ok: true,
    });
    assert.deepEqual(await listProviders('ar'), []);

    assert.deepEqual(await restoreProvider(providerId, moderadorId), { ok: true });
    assert.equal((await listProviders('ar')).length, 1);

    // La fecha de estreno es la de la PRIMERA vez: es lo que ordena el listado,
    // y reescribirla mandaría arriba del todo lo que solo se revisó otra vez.
    const despues = await controlDb().provider.findUniqueOrThrow({
      where: { id: providerId },
      select: { publishedAt: true },
    });
    assert.equal(despues.publishedAt?.getTime(), estreno.getTime());
  });

  it('verificado NO es lo mismo que aprobado', async () => {
    await approveProvider(providerId, moderadorId);
    assert.equal((await listProviders('ar'))[0]?.verified, false);

    assert.deepEqual(await setVerified(providerId, moderadorId, true), { ok: true });
    assert.equal((await listProviders('ar'))[0]?.verified, true);

    assert.deepEqual(await setVerified(providerId, moderadorId, false), { ok: true });
    assert.equal((await listProviders('ar'))[0]?.verified, false);
  });

  it('cada decisión deja su línea, con quién la tomó', async () => {
    await approveProvider(providerId, moderadorId);
    await setVerified(providerId, moderadorId, true);
    await suspendProvider(providerId, moderadorId, 'Se fue del pueblo.');

    const lineas = await controlDb().providerReview.findMany({
      where: { providerId },
      orderBy: { createdAt: 'asc' },
      select: { action: true, actorId: true, note: true },
    });
    // La primera la escribió el propio proveedor al mandarlo a revisión.
    assert.deepEqual(
      lineas.map((one) => one.action),
      ['submitted', 'approved', 'verified', 'suspended'],
    );
    assert.equal(lineas[1]?.actorId, moderadorId);
    assert.equal(lineas[3]?.note, 'Se fue del pueblo.');
    // Y quien lo mandó fue el dueño, no quien modera.
    assert.equal(lineas[0]?.actorId, duenoId);
  });

  it('un proveedor que no existe no se aprueba', async () => {
    assert.deepEqual(await approveProvider('cmtyinventadoinventado00', moderadorId), {
      ok: false,
      problems: ['notFound'],
    });
  });

  void fixture;
});

/**
 * Las denuncias.
 *
 * Un formulario público y sin cuenta es una puerta abierta, así que lo que se
 * comprueba aquí es qué NO puede hacer: no puede cerrar el negocio de nadie, no
 * puede tumbar la foto de un tercero, y no puede dejar una galería escondida
 * para siempre con una reclamación falsa.
 */
describe('las denuncias', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  let providerId = '';
  let otroId = '';
  let slug = '';
  let duenoId = '';
  let moderadorId = '';
  let fotoId = '';
  let fotoAjenaId = '';

  const publicar = async (nombre: string, email: string): Promise<{ id: string; slug: string; userId: string }> => {
    const prisma = controlDb();
    const user = await prisma.user.create({ data: { email, locale: 'ar' }, select: { id: true } });
    const result = await createProvider(user.id, {
      legalName: nombre, governorate: 'beirut', district: 'beirut', city: 'Beirut', mainLocale: 'ar',
    });
    assert.ok(result.ok);
    await setTranslation(unsafeProviderScope(result.id), user.id, 'ar', {
      name: nombre, tagline: '', description: '', services: [],
    });
    await setCategories(unsafeProviderScope(result.id), user.id, ['wedding_hall'], 'wedding_hall');
    await prisma.provider.update({
      where: { id: result.id },
      data: { status: 'approved', publishedAt: new Date() },
    });
    const row = await prisma.provider.findUniqueOrThrow({
      where: { id: result.id }, select: { slug: true },
    });
    return { id: result.id, slug: row.slug, userId: user.id };
  };

  const foto = async (id: string): Promise<string> => {
    const png = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#8a6c22' } })
      .png()
      .toBuffer();
    const subida = await addImage(
      unsafeProviderScope(id),
      duenoId,
      new File([new Uint8Array(png)], 'f.png', { type: 'image/png' }),
    );
    assert.ok(subida.ok);
    await controlDb().providerMedia.update({
      where: { id: subida.id },
      data: { status: 'approved', publishedAt: new Date() },
    });
    return subida.id;
  };

  beforeEach(async () => {
    const prisma = controlDb();
    forgetStore();
    await prisma.provider.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { startsWith: 'den-' } } });

    const uno = await publicar('Salon denunciado', 'den-uno@example.com');
    const dos = await publicar('Salon de al lado', 'den-dos@example.com');
    providerId = uno.id;
    slug = uno.slug;
    duenoId = uno.userId;
    otroId = dos.id;

    const mod = await prisma.user.create({
      data: { email: 'den-mod@example.com', locale: 'es', isSuperadmin: true },
      select: { id: true },
    });
    moderadorId = mod.id;

    fotoId = await foto(providerId);
    fotoAjenaId = await foto(otroId);
  });

  it('una reclamación de derechos oculta las fotos AL MOMENTO, y solo las fotos', async () => {
    const antes = await controlDb().provider.findUniqueOrThrow({
      where: { id: providerId }, select: { status: true },
    });
    assert.equal(antes.status, 'approved');

    const result = await fileReport({
      slug, reason: 'copyright', message: 'Esa foto es mía.',
      reporterEmail: 'fotografo@example.com', ip: '203.0.113.7',
    });
    assert.ok(result.ok);
    assert.equal(result.hiddenImages, 1);

    // La foto deja de verse YA.
    const nadie = { userId: null, isSuperadmin: false, canModerate: false };
    assert.equal(await readableMedia(fotoId, nadie, 'full'), null);

    // Y el NEGOCIO sigue publicado. No se cierra el negocio de nadie con un
    // formulario anónimo.
    const despues = await controlDb().provider.findUniqueOrThrow({
      where: { id: providerId }, select: { status: true },
    });
    assert.equal(despues.status, 'approved');
    assert.equal((await listProviders('ar')).length, 2);
  });

  it('sin correo no hay reclamación de derechos', async () => {
    assert.deepEqual(
      await fileReport({ slug, reason: 'copyright', message: 'mía', reporterEmail: '' }),
      { ok: false, problems: ['email'] },
    );
    // Y no ocultó nada: un intento fallido no toca la galería.
    const nadie = { userId: null, isSuperadmin: false, canModerate: false };
    assert.notEqual(await readableMedia(fotoId, nadie, 'full'), null);

    // Los demás motivos no lo piden: quien avisa de un número equivocado no
    // tiene por qué dejar su correo.
    const otra = await fileReport({ slug, reason: 'wrong_number', message: 'No contestan', reporterEmail: '' });
    assert.ok(otra.ok);
    assert.equal(otra.hiddenImages, 0);
  });

  it('la foto de OTRO negocio no se puede tumbar desde esta ficha', async () => {
    const result = await fileReport({
      slug, reason: 'copyright', message: 'esa', reporterEmail: 'a@example.com',
      mediaId: fotoAjenaId,
    });
    assert.ok(result.ok);
    // El `mediaId` ajeno se ignora, así que la denuncia queda contra la ficha
    // entera — y lo que se oculta son las fotos de ESTA, no la del vecino.
    const nadie = { userId: null, isSuperadmin: false, canModerate: false };
    assert.notEqual(await readableMedia(fotoAjenaId, nadie, 'full'), null);
    assert.equal(await readableMedia(fotoId, nadie, 'full'), null);
  });

  it('una ficha que no está publicada no se puede denunciar', async () => {
    await controlDb().provider.update({
      where: { id: providerId }, data: { status: 'pending_review' },
    });
    assert.deepEqual(
      await fileReport({ slug, reason: 'scam', message: '', reporterEmail: '' }),
      { ok: false, problems: ['notFound'] },
    );
    assert.deepEqual(
      await fileReport({ slug: 'no-existe', reason: 'scam', message: '', reporterEmail: '' }),
      { ok: false, problems: ['notFound'] },
    );
  });

  it('el mismo origen no puede mandar cien', async () => {
    for (let i = 0; i < 5; i += 1) {
      const one = await fileReport({ slug, reason: 'scam', message: `n${i}`, reporterEmail: '', ip: '198.51.100.4' });
      assert.ok(one.ok, `la ${i + 1} deberia pasar`);
    }
    assert.deepEqual(
      await fileReport({ slug, reason: 'scam', message: 'seis', reporterEmail: '', ip: '198.51.100.4' }),
      { ok: false, problems: ['tooMany'] },
    );
    // Desde otro sitio sí: el freno es por dirección, no global.
    assert.ok((await fileReport({ slug, reason: 'scam', message: 'otra', reporterEmail: '', ip: '198.51.100.5' })).ok);
  });

  it('desestimarla devuelve la foto a la calle; darle la razón la borra de verdad', async () => {
    const store = storeFor();
    const nadie = { userId: null, isSuperadmin: false, canModerate: false };

    // Primera: falsa. Se oculta, se desestima, y la foto vuelve.
    await fileReport({ slug, reason: 'copyright', message: 'mía', reporterEmail: 'a@example.com', mediaId: fotoId });
    assert.equal(await readableMedia(fotoId, nadie, 'full'), null);

    const abiertas = await openReports();
    assert.equal(abiertas.length, 1);
    assert.deepEqual(
      await resolveReport(abiertas[0]?.id ?? '', moderadorId, 'dismissed', 'No aportó nada.'),
      { ok: true },
    );
    // Sin esto, una reclamación falsa deja la galería escondida para siempre.
    assert.notEqual(await readableMedia(fotoId, nadie, 'full'), null);

    // Segunda: buena. Se le da la razón y la foto se va, bytes incluidos.
    const fila = await controlDb().providerMedia.findUniqueOrThrow({
      where: { id: fotoId }, select: { objectKey: true },
    });
    const key = asObjectKey(fila.objectKey ?? '');
    assert.ok(key !== null && (await store.head(key)) !== null);

    await fileReport({ slug, reason: 'copyright', message: 'de verdad', reporterEmail: 'b@example.com', mediaId: fotoId });
    const segunda = await openReports();
    assert.deepEqual(
      await resolveReport(segunda[0]?.id ?? '', moderadorId, 'upheld', 'Enseñó el original.'),
      { ok: true },
    );

    assert.equal(await controlDb().providerMedia.count({ where: { id: fotoId } }), 0);
    assert.equal(await store.head(key), null);
    assert.deepEqual(await openReports(), []);
  });

  it('la dirección de quien denunció se borra a los treinta días', async () => {
    await fileReport({ slug, reason: 'scam', message: 'x', reporterEmail: '', ip: '203.0.113.9' });
    const vieja = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await controlDb().providerReport.updateMany({ data: { createdAt: vieja } });

    assert.equal(await purgeReportIps(), 1);
    const filas = await controlDb().providerReport.findMany({ select: { ip: true, reason: true } });
    // Se va la dirección; la denuncia SE QUEDA — es el registro de lo que pasó.
    assert.equal(filas.length, 1);
    assert.equal(filas[0]?.ip, null);
    assert.equal(filas[0]?.reason, 'scam');
  });

  void fixture;
});

/**
 * El mapa del sitio.
 *
 * Lo que se comprueba es lo único que puede hacer daño: que no liste lo que no
 * está publicado. Un mapa del sitio con las fichas en revisión dentro le entrega
 * a un buscador la lista de lo que todavía no ha salido — y encima lo indexa
 * para devolver un 404 después.
 */
describe('el mapa del sitio', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  it('solo lleva lo aprobado', async () => {
    const prisma = controlDb();
    await prisma.provider.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { startsWith: 'map-' } } });

    const user = await prisma.user.create({
      data: { email: 'map-a@example.com', locale: 'ar' },
      select: { id: true },
    });

    const publicado = await createProvider(user.id, {
      legalName: 'Salon publicado', governorate: 'beirut', district: 'beirut', city: 'Beirut', mainLocale: 'ar',
    });
    const enRevision = await createProvider(user.id, {
      legalName: 'Salon en revision', governorate: 'beirut', district: 'beirut', city: 'Beirut', mainLocale: 'ar',
    });
    assert.ok(publicado.ok && enRevision.ok);

    await prisma.provider.update({
      where: { id: publicado.id },
      data: { status: 'approved', publishedAt: new Date() },
    });
    await prisma.provider.update({
      where: { id: enRevision.id },
      data: { status: 'pending_review', submittedAt: new Date() },
    });

    const slugs = await approvedSlugs();
    const publicadoSlug = (
      await prisma.provider.findUniqueOrThrow({ where: { id: publicado.id }, select: { slug: true } })
    ).slug;

    assert.deepEqual(slugs.map((one) => one.slug), [publicadoSlug]);

    // Y suspender lo saca del mapa igual que lo saca del listado.
    await prisma.provider.update({ where: { id: publicado.id }, data: { status: 'suspended' } });
    assert.deepEqual(await approvedSlugs(), []);
  });

  void fixture;
});

/**
 * La publicación de una fiesta.
 *
 * Lo que se comprueba es la decisión de fondo: que sea una COPIA. Si la
 * publicación fuera una marca dentro de `Event`, lo único que separaría la lista
 * de invitados de la calle sería que ninguna consulta pública se olvidara de un
 * `where` — y una red que depende de que nadie se olvide no es una red.
 */
describe('publicar una fiesta', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  let scope: TenantScope;
  let otraOficina: TenantScope;
  let userId = '';
  let moderadorId = '';
  const eventId = 'evento-de-prueba-publicacion';

  const buenos = {
    title: 'Zaffe en Jbeil',
    description: 'Una boda de trescientos.',
    locale: 'ar',
    eventType: 'wedding' as const,
    dateMode: 'month',
    date: '',
    governorate: 'mount_lebanon',
    district: 'jbeil',
    city: 'Jbeil',
    venueName: '',
    contactMode: 'none',
  };
  const permiso = { by: 'Rami y Sara', text: 'Autorizamos publicar las fotos y el nombre.' };

  beforeEach(async () => {
    const prisma = controlDb();
    await prisma.publicListing.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { startsWith: 'pub-fiesta-' } } });

    const tenant = await prisma.tenant.findFirstOrThrow({
      where: { isRoot: true },
      select: { id: true, databaseName: true },
    });
    scope = tenantScope(tenant.id, tenant.databaseName);
    // Una oficina que no existe sirve igual para lo que se comprueba: que su
    // ámbito no encuentre lo de la otra.
    otraOficina = tenantScope('oficina-de-al-lado', null);

    const user = await prisma.user.create({
      data: { email: 'pub-fiesta-a@example.com', locale: 'ar' },
      select: { id: true },
    });
    const mod = await prisma.user.create({
      data: { email: 'pub-fiesta-mod@example.com', locale: 'es', isSuperadmin: true },
      select: { id: true },
    });
    userId = user.id;
    moderadorId = mod.id;
  });

  it('nace en borrador y no sale a la calle hasta que alguien la aprueba', async () => {
    const creada = await createListing(scope, userId, eventId, buenos, permiso);
    assert.ok(creada.ok);

    // Ni en el listado ni por su dirección.
    assert.deepEqual(await listPublicListings('ar'), []);
    assert.equal(await listingBySlug(creada.slug, 'ar'), null);

    assert.deepEqual(await submitListing(scope, userId, creada.id), { ok: true });
    assert.equal((await listingQueue()).length, 1);
    assert.deepEqual(await listPublicListings('ar'), []);

    assert.deepEqual(await decideListing(creada.id, moderadorId, 'approved', ''), { ok: true });
    const publicadas = await listPublicListings('ar');
    assert.equal(publicadas.length, 1);
    assert.equal(publicadas[0]?.title, 'Zaffe en Jbeil');
    assert.notEqual(await listingBySlug(creada.slug, 'ar'), null);
  });

  it('sin autorización no se crea, y la base tampoco la deja salir del borrador', async () => {
    assert.deepEqual(await createListing(scope, userId, eventId, buenos, { by: '', text: '' }), {
      ok: false,
      problems: ['authorization'],
    });
    // Un texto de dos palabras tampoco: un permiso que no se puede enseñar no
    // sirve para defenderse de una queja.
    assert.deepEqual(
      await createListing(scope, userId, eventId, buenos, { by: 'Rami', text: 'vale' }),
      { ok: false, problems: ['authorization'] },
    );

    // Y a mano, saltándose el servicio: la base lo impide.
    await assert.rejects(
      controlDb().publicListing.create({
        data: {
          slug: 'f-sin-permiso',
          title: 'Sin permiso',
          eventType: 'wedding',
          governorate: 'beirut',
          district: 'beirut',
          city: 'Beirut',
          status: 'approved',
        },
      }),
      /needs_authorization|violates check/i,
    );
  });

  it('la fecha exacta se comprueba contra el CALENDARIO', async () => {
    // Un 30 de febrero pasa el patrón y `Date.parse` lo corre al 2 de marzo.
    assert.deepEqual(
      await createListing(
        scope, userId, eventId,
        { ...buenos, dateMode: 'exact', date: '2026-02-30' },
        permiso,
      ),
      { ok: false, problems: ['date'] },
    );
    // Y en modo `month` no se guarda ninguna fecha, aunque venga en el envío: la
    // base lo exige.
    const creada = await createListing(
      scope, userId, eventId, { ...buenos, dateMode: 'month', date: '2026-06-14' }, permiso,
    );
    assert.ok(creada.ok);
    const fila = await controlDb().publicListing.findUniqueOrThrow({
      where: { id: creada.id }, select: { date: true, dateMode: true },
    });
    assert.equal(fila.dateMode, 'month');
    assert.equal(fila.date, null);
  });

  it('un evento tiene UNA publicación', async () => {
    assert.ok((await createListing(scope, userId, eventId, buenos, permiso)).ok);
    assert.deepEqual(await createListing(scope, userId, eventId, buenos, permiso), {
      ok: false,
      problems: ['exists'],
    });
  });

  it('la oficina de al lado no la ve, no la manda y no la borra', async () => {
    const creada = await createListing(scope, userId, eventId, buenos, permiso);
    assert.ok(creada.ok);

    assert.equal(await listingForEvent(otraOficina, eventId), null);
    assert.deepEqual(await submitListing(otraOficina, userId, creada.id), {
      ok: false,
      problems: ['notFound'],
    });
    assert.deepEqual(await deleteListing(otraOficina, userId, creada.id), {
      ok: false,
      problems: ['notFound'],
    });
    // Y la suya sigue ahí.
    assert.notEqual(await listingForEvent(scope, eventId), null);
  });

  it('quitarla de la web la BORRA, y no deja un estado del que fiarse', async () => {
    const creada = await createListing(scope, userId, eventId, buenos, permiso);
    assert.ok(creada.ok);
    await submitListing(scope, userId, creada.id);
    await decideListing(creada.id, moderadorId, 'approved', '');
    assert.equal((await listPublicListings('ar')).length, 1);

    assert.deepEqual(await deleteListing(scope, userId, creada.id), { ok: true });
    assert.equal(await controlDb().publicListing.count({ where: { id: creada.id } }), 0);
    assert.deepEqual(await listPublicListings('ar'), []);
    assert.deepEqual(await approvedListingSlugs(), []);
  });

  it('rechazar exige motivo, y suspender saca de la calle', async () => {
    const creada = await createListing(scope, userId, eventId, buenos, permiso);
    assert.ok(creada.ok);
    await submitListing(scope, userId, creada.id);

    assert.deepEqual(await decideListing(creada.id, moderadorId, 'rejected', ' '), {
      ok: false,
      problems: ['note'],
    });

    await decideListing(creada.id, moderadorId, 'approved', '');
    assert.equal((await listPublicListings('ar')).length, 1);
    assert.deepEqual(
      await decideListing(creada.id, moderadorId, 'suspended', 'La pareja pidió quitarla.'),
      { ok: true },
    );
    assert.deepEqual(await listPublicListings('ar'), []);
  });

  it('un nombre árabe NO se translitera, y una fiesta no se confunde con un salón', () => {
    const arabe = listingSlug('زفاف رامي وسارة', []);
    assert.match(arabe, /^f-[a-f0-9]{8}$/);
    // El prefijo distingue: con el mismo, `p-3a9c…` podría ser un salón o una
    // boda y quien lea un registro no sabría cuál.
    assert.match(providerSlug('قاعة الأرز', []), /^p-[a-f0-9]{8}$/);
    assert.equal(listingSlug('Zaffe in Jbeil', []), 'zaffe-in-jbeil');
  });

  void fixture;
});

/**
 * Quién participó en una fiesta.
 *
 * Es el permiso de un TERCERO dentro de la página de otro. La oficina que
 * organiza la boda dice quién participó; si eso bastara para publicarlo, un
 * salón aparecería en la página de la boda de un cliente sin que nadie se lo
 * preguntara.
 */
describe('apuntar a un proveedor en una fiesta', { skip: HAS_DB ? false : 'sin DATABASE_URL' }, () => {
  const fixture = withDatabase();

  let scope: TenantScope;
  let otraOficina: TenantScope;
  let userId = '';
  let moderadorId = '';
  let listingId = '';
  let salonId = '';
  let salonSlug = '';
  let borradorSlug = '';

  const publicarProveedor = async (
    nombre: string,
    email: string,
    categorias: string[],
    aprobar: boolean,
  ): Promise<{ id: string; slug: string }> => {
    const prisma = controlDb();
    const user = await prisma.user.create({ data: { email, locale: 'ar' }, select: { id: true } });
    const result = await createProvider(user.id, {
      legalName: nombre, governorate: 'beirut', district: 'beirut', city: 'Beirut', mainLocale: 'ar',
    });
    assert.ok(result.ok);
    await setTranslation(unsafeProviderScope(result.id), user.id, 'ar', {
      name: nombre, tagline: '', description: '', services: [],
    });
    await setCategories(unsafeProviderScope(result.id), user.id, categorias, categorias[0] ?? '');
    if (aprobar) {
      await prisma.provider.update({
        where: { id: result.id },
        data: { status: 'approved', publishedAt: new Date() },
      });
    }
    const row = await prisma.provider.findUniqueOrThrow({
      where: { id: result.id }, select: { slug: true },
    });
    return { id: result.id, slug: row.slug };
  };

  beforeEach(async () => {
    const prisma = controlDb();
    await prisma.publicListing.deleteMany({});
    await prisma.provider.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { startsWith: 'tag-' } } });

    const tenant = await prisma.tenant.findFirstOrThrow({
      where: { isRoot: true }, select: { id: true, databaseName: true },
    });
    scope = tenantScope(tenant.id, tenant.databaseName);
    otraOficina = tenantScope('oficina-de-al-lado', null);

    const user = await prisma.user.create({
      data: { email: 'tag-oficina@example.com', locale: 'ar' }, select: { id: true },
    });
    const mod = await prisma.user.create({
      data: { email: 'tag-mod@example.com', locale: 'es', isSuperadmin: true }, select: { id: true },
    });
    userId = user.id;
    moderadorId = mod.id;

    const salon = await publicarProveedor('Salon del Cedro', 'tag-salon@example.com', ['wedding_hall'], true);
    salonId = salon.id;
    salonSlug = salon.slug;
    const borrador = await publicarProveedor('Sin publicar', 'tag-borrador@example.com', ['dj'], false);
    borradorSlug = borrador.slug;

    const creada = await createListing(
      scope, userId, 'evento-tag',
      {
        title: 'Boda de prueba', description: '', locale: 'ar', eventType: 'wedding',
        dateMode: 'month', date: '', governorate: 'beirut', district: 'beirut', city: 'Beirut',
        venueName: '', contactMode: 'none',
      },
      { by: 'La pareja', text: 'Autorizamos publicar esta boda.' },
    );
    assert.ok(creada.ok);
    listingId = creada.id;
    await submitListing(scope, userId, listingId);
    await decideListing(listingId, moderadorId, 'approved', '');
  });

  it('apuntado NO es publicado: hace falta que el negocio lo confirme', async () => {
    assert.deepEqual(
      await addListingProvider(scope, userId, listingId, salonSlug, 'wedding_hall'),
      { ok: true },
    );

    // La oficina lo ve apuntado y sin confirmar.
    const apuntados = await listingProviders(scope, listingId);
    assert.equal(apuntados.length, 1);
    assert.equal(apuntados[0]?.approvedByProvider, false);

    // Y la calle NO lo ve.
    const publica = await listPublicListings('ar');
    assert.deepEqual(publica[0]?.providers, []);

    // El negocio dice que sí, y entonces sale.
    assert.deepEqual(
      await setProviderApproval(unsafeProviderScope(salonId), listingId, true),
      { ok: true },
    );
    const despues = await listPublicListings('ar');
    assert.equal(despues[0]?.providers.length, 1);
    assert.equal(despues[0]?.providers[0]?.name, 'Salon del Cedro');

    // Y lo puede RETIRAR. Un permiso que solo se puede dar no es un permiso.
    assert.deepEqual(
      await setProviderApproval(unsafeProviderScope(salonId), listingId, false),
      { ok: true },
    );
    assert.deepEqual((await listPublicListings('ar'))[0]?.providers, []);
  });

  it('no se puede apuntar a un negocio que no está publicado', async () => {
    // Seria sacarlo a la calle por la puerta de atras, sin pasar por su propia
    // revision.
    assert.deepEqual(await addListingProvider(scope, userId, listingId, borradorSlug, 'dj'), {
      ok: false,
      problems: ['provider'],
    });
    assert.deepEqual(await addListingProvider(scope, userId, listingId, 'no-existe', ''), {
      ok: false,
      problems: ['provider'],
    });
  });

  it('el papel tiene que ser una de SUS categorías', async () => {
    assert.deepEqual(await addListingProvider(scope, userId, listingId, salonSlug, 'dj'), {
      ok: false,
      problems: ['role'],
    });
    // Vacío toma la principal.
    assert.deepEqual(await addListingProvider(scope, userId, listingId, salonSlug, ''), { ok: true });
    assert.equal((await listingProviders(scope, listingId))[0]?.role, 'wedding_hall');
  });

  it('se acepta la dirección entera, que es lo que se copia de la barra', async () => {
    assert.deepEqual(
      await addListingProvider(
        scope, userId, listingId,
        `https://citas.posxml.com/d/es/p/${salonSlug}`,
        'wedding_hall',
      ),
      { ok: true },
    );
    assert.equal((await listingProviders(scope, listingId))[0]?.slug, salonSlug);
  });

  it('no se apunta dos veces al mismo', async () => {
    assert.deepEqual(await addListingProvider(scope, userId, listingId, salonSlug, ''), { ok: true });
    assert.deepEqual(await addListingProvider(scope, userId, listingId, salonSlug, ''), {
      ok: false,
      problems: ['already'],
    });
  });

  it('la oficina de al lado no apunta ni quita en esta fiesta', async () => {
    assert.deepEqual(await addListingProvider(otraOficina, userId, listingId, salonSlug, ''), {
      ok: false,
      problems: ['notFound'],
    });

    await addListingProvider(scope, userId, listingId, salonSlug, '');
    assert.deepEqual(await removeListingProvider(otraOficina, userId, listingId, salonId), {
      ok: false,
      problems: ['notFound'],
    });
    assert.equal((await listingProviders(scope, listingId)).length, 1);
    // Y desde la suya, sí.
    assert.deepEqual(await removeListingProvider(scope, userId, listingId, salonId), { ok: true });
  });

  it('un negocio no confirma por otro', async () => {
    await addListingProvider(scope, userId, listingId, salonSlug, '');
    const otro = await publicarProveedor('Otro salon', 'tag-otro@example.com', ['wedding_hall'], true);

    // Con el ámbito del vecino no hay fila que tocar.
    assert.deepEqual(await setProviderApproval(unsafeProviderScope(otro.id), listingId, true), {
      ok: false,
      problems: ['notFound'],
    });
    assert.equal((await listingProviders(scope, listingId))[0]?.approvedByProvider, false);
  });

  it('confirmado sí, pero si la fiesta deja de estar publicada tampoco sale', async () => {
    await addListingProvider(scope, userId, listingId, salonSlug, '');
    await setProviderApproval(unsafeProviderScope(salonId), listingId, true);
    assert.equal((await listPublicListings('ar'))[0]?.providers.length, 1);

    // Y si al salón lo suspenden, desaparece de la boda sin tocar la boda.
    await controlDb().provider.update({ where: { id: salonId }, data: { status: 'suspended' } });
    const despues = await listPublicListings('ar');
    assert.equal(despues.length, 1);
    assert.deepEqual(despues[0]?.providers, []);
  });

  it('lo ve en SU panel, con el estado de la fiesta', async () => {
    await addListingProvider(scope, userId, listingId, salonSlug, '');
    const suyas = await listingsForProvider(salonId);
    assert.equal(suyas.length, 1);
    assert.equal(suyas[0]?.title, 'Boda de prueba');
    assert.equal(suyas[0]?.listingStatus, 'approved');
    assert.equal(suyas[0]?.approvedByProvider, false);

    // Y el vecino no ve nada.
    const otro = await publicarProveedor('Tercero', 'tag-tercero@example.com', ['dj'], true);
    assert.deepEqual(await listingsForProvider(otro.id), []);
  });

  void fixture;
});
