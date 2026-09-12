import { getSession, sessionCan } from '@/lib/auth/session';
import { readableMedia } from '@/lib/directory/media';
import { storeFor } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ mediaId: string }>;
}

/**
 * GET /api/d/media/[mediaId] → los bytes de una imagen del directorio.
 *
 * Todo pasa por aquí, y no por una dirección firmada del almacén, por una razón
 * concreta: una dirección firmada que ya se entregó SIGUE VALIENDO hasta que
 * caduque. Una imagen retirada por una reclamación de derechos seguiría viéndose
 * horas, y la retirada inmediata es un requisito, no una preferencia. Esta ruta
 * mira el estado antes de devolver un byte.
 *
 * Por lo mismo, `private, no-store`. Una caché de un año se come la retirada
 * igual que se la come una firma larga, y el truco del `?v=` NO lo arregla: el
 * archivo es EXACTAMENTE el mismo cuando pasa de `approved` a `hidden`, así que
 * su huella no cambia y la dirección tampoco. Cuando el tráfico pida un CDN se
 * añadirá con purga explícita y con la ventana residual escrita donde se vea.
 *
 * `?t=1` devuelve la miniatura, que es el mismo archivo recortado.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { mediaId } = await context.params;
  const session = await getSession();

  const variant = new URL(request.url).searchParams.get('t') === '1' ? 'thumb' : 'full';

  const media = await readableMedia(
    mediaId,
    {
      userId: session?.userId ?? null,
      isSuperadmin: session?.isSuperadmin ?? false,
      canModerate: sessionCan(session, 'directory:moderate'),
    },
    variant,
  );
  // Una sola respuesta para «no existe», «no está aprobada» y «no es cosa
  // suya». Distinguirlas convertiría esta dirección en una forma de averiguar
  // qué negocios están esperando revisión.
  if (media === null) return new Response(null, { status: 404 });

  const object = await storeFor().get(media.key);
  // La fila decía que hay un objeto y no lo hay. No es un 500: para quien mira,
  // la imagen no está — y el repaso de huérfanos es quien tiene que enterarse.
  if (object === null) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(object.body), {
    headers: {
      'content-type': object.contentType || media.mimeType,
      'content-length': String(object.body.byteLength),
      'cache-control': 'private, no-store',
      // Los bytes salieron recodificados por `sharp`, así que son lo que dicen
      // ser; aun así, nada de adivinar el tipo.
      'x-content-type-options': 'nosniff',
    },
  });
}
