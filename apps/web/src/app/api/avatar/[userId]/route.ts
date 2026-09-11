import { getSession } from '@/lib/auth/session';
import { controlDb } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

/**
 * GET /api/avatar/[userId] → la foto de perfil de esa persona.
 *
 * Lleva sesión, y no por costumbre: la cara y el nombre de quien trabaja en una
 * agencia son datos de esa agencia. Sin comprobación, cualquiera de fuera podría
 * recorrer identificadores y sacar el álbum del personal de todas las oficinas.
 *
 * Quién puede verla: uno mismo, cualquiera de la MISMA oficina, y el
 * superadministrador. La comprobación es del servidor, como todas: que la
 * pantalla no enseñe una foto no impide que alguien pida su dirección.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const session = await getSession();
  if (session === null) return new Response(null, { status: 404 });

  const { userId } = await context.params;

  const user = await controlDb().user.findUnique({
    where: { id: userId },
    select: {
      avatarData: true,
      avatarType: true,
      avatarVersion: true,
      memberships: { select: { tenantId: true } },
    },
  });

  // La misma respuesta para «no existe» y para «no es cosa suya». Distinguirlas
  // convertiría esta ruta en una forma de averiguar qué identificadores hay.
  if (user === null || user.avatarData === null || user.avatarVersion === null) {
    return new Response(null, { status: 404 });
  }

  const sameOffice =
    session.tenantId !== null &&
    user.memberships.some((membership) => membership.tenantId === session.tenantId);
  if (userId !== session.userId && !session.isSuperadmin && !sameOffice) {
    return new Response(null, { status: 404 });
  }

  const etag = `"${user.avatarVersion}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  // La huella va en la dirección, así que estos bytes no cambian jamás: el
  // navegador puede quedárselos y una foto nueva llega con otra dirección.
  // `private` porque hay un proxy delante y esto no es de todo el mundo.
  const fresh = new URL(request.url).searchParams.get('v') === user.avatarVersion;

  return new Response(new Uint8Array(user.avatarData), {
    headers: {
      'content-type': user.avatarType ?? 'image/webp',
      'content-length': String(user.avatarData.byteLength),
      etag,
      'cache-control': fresh ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    },
  });
}
