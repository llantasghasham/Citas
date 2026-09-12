import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

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
import { contactHref } from '../src/lib/directory/contacts';
import { directoryLocaleFrom } from '../src/lib/directory/locale';
import {
  categoryCounts,
  governorateCounts,
  listProviders,
  providerBySlug,
} from '../src/lib/directory/public';
import { providerSlug } from '../src/lib/directory/slug';

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
