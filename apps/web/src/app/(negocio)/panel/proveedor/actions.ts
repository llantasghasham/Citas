'use server';

import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/session';
import { CONTACT_CHANNELS } from '@/lib/directory/categories';
import {
  addImage,
  moveMedia,
  removeMedia,
  setAltText,
  setVideo,
} from '@/lib/directory/media';
import { setProviderApproval } from '@/lib/directory/listings';
import { currentProviderScope } from '@/lib/directory/session';
import {
  createProvider,
  setCategories,
  setContact,
  setTranslation,
  submitForReview,
  updateProvider,
} from '@/lib/directory/service';
import { DIRECTORY_LOCALES } from '@citas/core';

/**
 * Las acciones del panel del proveedor.
 *
 * Todas empiezan igual y no es repetición ociosa: sesión, y después el ÁMBITO
 * resuelto contra la membresía. El `providerId` viaja en un campo oculto —tiene
 * que viajar, hay quien administra dos— así que es un dato del cliente y no un
 * permiso. `currentProviderScope` lo comprueba contra la base; si no es suyo, no
 * hay ámbito y no hay consulta que escriba nada.
 */

/** El id del negocio sobre el que se actúa, tal y como llegó del formulario. */
function requestedId(formData: FormData): string | undefined {
  const raw = String(formData.get('providerId') ?? '').trim();
  return raw.length === 0 ? undefined : raw;
}

function back(path: string, providerId: string, extra = ''): never {
  redirect(`/panel/proveedor${path}?p=${encodeURIComponent(providerId)}${extra}`);
}

/** Da de alta el negocio. Quien lo crea queda dentro como administrador. */
export async function createProviderAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const result = await createProvider(session.userId, {
    legalName: String(formData.get('legalName') ?? ''),
    governorate: String(formData.get('governorate') ?? ''),
    district: String(formData.get('district') ?? ''),
    city: String(formData.get('city') ?? ''),
    mainLocale: String(formData.get('mainLocale') ?? 'ar'),
  });

  if (!result.ok) {
    redirect(`/panel/proveedor/nuevo?error=${result.problems.join(',')}`);
  }
  back('', result.id, '&creado=1');
}

export async function updateProviderAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const scope = await currentProviderScope(session.userId, requestedId(formData));
  if (scope === null) redirect('/panel/proveedor');

  const capacity = Number.parseInt(String(formData.get('capacity') ?? ''), 10);
  const since = Number.parseInt(String(formData.get('since') ?? ''), 10);

  const result = await updateProvider(scope, session.userId, {
    legalName: String(formData.get('legalName') ?? ''),
    governorate: String(formData.get('governorate') ?? ''),
    district: String(formData.get('district') ?? ''),
    city: String(formData.get('city') ?? ''),
    mainLocale: String(formData.get('mainLocale') ?? 'ar'),
    addressPublic: String(formData.get('addressPublic') ?? ''),
    // Un campo vacío es «no lo sé», no «cero»: `NaN` se guarda como nulo.
    capacity: Number.isNaN(capacity) ? null : capacity,
    since: Number.isNaN(since) ? null : since,
  });

  if (!result.ok) back('', scope.providerId, `&error=${result.problems.join(',')}`);
  back('', scope.providerId, '&guardado=1');
}

export async function setTranslationAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const scope = await currentProviderScope(session.userId, requestedId(formData));
  if (scope === null) redirect('/panel/proveedor');

  const locale = String(formData.get('locale') ?? '');
  if (!(DIRECTORY_LOCALES as readonly string[]).includes(locale)) {
    back('', scope.providerId, '&error=notFound');
  }

  await setTranslation(scope, session.userId, locale, {
    name: String(formData.get('name') ?? ''),
    tagline: String(formData.get('tagline') ?? ''),
    description: String(formData.get('description') ?? ''),
    // Una cosa por línea. Lo que llega es un cuadro de texto porque «añadir
    // otro» necesitaría JavaScript de cliente, y aquí no lo hay.
    services: String(formData.get('services') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  });

  back('', scope.providerId, '&guardado=1');
}

export async function setCategoriesAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const scope = await currentProviderScope(session.userId, requestedId(formData));
  if (scope === null) redirect('/panel/proveedor');

  const chosen = formData.getAll('category').map((one) => String(one));
  const primary = String(formData.get('primary') ?? '');

  const result = await setCategories(scope, session.userId, chosen, primary);
  if (!result.ok) back('', scope.providerId, `&error=${result.problems.join(',')}`);
  back('', scope.providerId, '&guardado=1');
}

/**
 * Los contactos se guardan TODOS de una vez, y por lo mismo que los grupos de
 * invitados: una casilla desmarcada no manda nada, así que lo que llega es lo
 * que se queda y lo que falta es lo que salió.
 */
export async function setContactsAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const scope = await currentProviderScope(session.userId, requestedId(formData));
  if (scope === null) redirect('/panel/proveedor');

  for (const channel of CONTACT_CHANNELS) {
    await setContact(
      scope,
      session.userId,
      channel,
      String(formData.get(`value-${channel}`) ?? ''),
      formData.get(`public-${channel}`) !== null,
    );
  }

  back('', scope.providerId, '&guardado=1');
}

export async function submitForReviewAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const scope = await currentProviderScope(session.userId, requestedId(formData));
  if (scope === null) redirect('/panel/proveedor');

  const result = await submitForReview(scope, session.userId);
  if (!result.ok) back('/estado', scope.providerId, `&error=${result.problems.join(',')}`);
  back('/estado', scope.providerId, '&enviado=1');
}

export async function uploadImageAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const scope = await currentProviderScope(session.userId, requestedId(formData));
  if (scope === null) redirect('/panel/proveedor');

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    back('/medios', scope.providerId, '&error=notAnImage');
  }

  const result = await addImage(scope, session.userId, file);
  if (!result.ok) back('/medios', scope.providerId, `&error=${result.problems.join(',')}`);
  back('/medios', scope.providerId, '&guardado=1');
}

export async function removeMediaAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const scope = await currentProviderScope(session.userId, requestedId(formData));
  if (scope === null) redirect('/panel/proveedor');

  await removeMedia(scope, session.userId, String(formData.get('mediaId') ?? ''));
  back('/medios', scope.providerId, '&guardado=1');
}

export async function moveMediaAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const scope = await currentProviderScope(session.userId, requestedId(formData));
  if (scope === null) redirect('/panel/proveedor');

  await moveMedia(
    scope,
    String(formData.get('mediaId') ?? ''),
    formData.get('direction') === 'up' ? 'up' : 'down',
  );
  back('/medios', scope.providerId);
}

export async function setAltTextAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const scope = await currentProviderScope(session.userId, requestedId(formData));
  if (scope === null) redirect('/panel/proveedor');

  await setAltText(
    scope,
    String(formData.get('mediaId') ?? ''),
    String(formData.get('altText') ?? ''),
  );
  back('/medios', scope.providerId, '&guardado=1');
}

export async function setVideoAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const scope = await currentProviderScope(session.userId, requestedId(formData));
  if (scope === null) redirect('/panel/proveedor');

  const result = await setVideo(scope, session.userId, String(formData.get('videoUrl') ?? ''));
  if (!result.ok) back('/medios', scope.providerId, `&error=${result.problems.join(',')}`);
  back('/medios', scope.providerId, '&guardado=1');
}

/**
 * Aparecer, o no, en la fiesta de un cliente.
 *
 * Lo decide el NEGOCIO y solo él. La oficina que publicó la boda puede apuntarlo
 * y puede quitarlo, pero no puede confirmarlo por él: eso es lo que convierte
 * «sale en la boda de un cliente» en algo que el negocio eligió. Y se puede
 * retirar después — un permiso que solo se puede dar no es un permiso.
 */
export async function setAppearanceAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const scope = await currentProviderScope(session.userId, requestedId(formData));
  if (scope === null) redirect('/panel/proveedor');

  await setProviderApproval(
    scope,
    String(formData.get('listingId') ?? ''),
    formData.get('appear') === '1',
  );
  back('/fiestas', scope.providerId, '&guardado=1');
}
