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
