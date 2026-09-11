import { controlDb } from '@/lib/db/client';
import { BRAND_KINDS, type BrandKind } from '@/lib/brand/assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ kind: string }>;
}

/**
 * GET /api/brand/logo · /api/brand/icon
 *
 * PÚBLICA, y a diferencia de la foto de perfil eso es lo correcto: el logo sale
 * en la portada y el icono en la pestaña de cualquiera que abra una invitación.
 * Es la marca del negocio, que existe justamente para verse.
 *
 * La clase se comprueba contra la lista: sin eso, la ruta aceptaría cualquier
 * cosa que llegue en la dirección para ir a buscarla a la base.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { kind } = await context.params;
  const valid = BRAND_KINDS.find((candidate) => candidate === kind) as BrandKind | undefined;
  if (valid === undefined) return new Response(null, { status: 404 });

  const asset = await controlDb().brandAsset.findUnique({ where: { kind: valid } });
  if (asset === null) return new Response(null, { status: 404 });

  const etag = `"${asset.version}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  // La huella va en la dirección, así que estos bytes no cambian jamás: se
  // pueden cachear para siempre, y un logo nuevo llega con otra dirección.
  const fresh = new URL(request.url).searchParams.get('v') === asset.version;

  return new Response(new Uint8Array(asset.data), {
    headers: {
      'content-type': asset.type,
      'content-length': String(asset.data.byteLength),
      etag,
      'cache-control': fresh ? 'public, max-age=31536000, immutable' : 'public, no-cache',
    },
  });
}
