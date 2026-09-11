import { NextResponse } from 'next/server';

import { getInvitationRepository } from '@/lib/repositories';
import { contentHashOf } from '@/lib/render/hash';
import { captureUrl } from '@/lib/render/origin';
import { RENDER_HEIGHT, RENDER_WIDTH, renderInvitationPng } from '@/lib/render/png';
import { getRenderStore } from '@/lib/render/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * GET /api/render/[slug] → a 1080×1920 PNG of the invitation.
 *
 * The image is generated once per version and kept, because this URL is also
 * the preview a messaging app fetches: on the afternoon an invitation is
 * forwarded around a WhatsApp group, rendering per request would mean one
 * Chromium per guest. Add `?download=1` to get it as a file attachment.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { slug } = await context.params;
  const invitation = await getInvitationRepository().findBySlug(slug);
  if (invitation === undefined) {
    return NextResponse.json({ error: 'invitation_not_found', slug }, { status: 404 });
  }

  const contentHash = contentHashOf(invitation);
  const etag = `"${contentHash}"`;

  // A browser that already holds this exact image needs no bytes at all.
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  const asAttachment = new URL(request.url).searchParams.get('download') === '1';
  const store = getRenderStore();

  try {
    let png = (await store?.find(invitation.id, contentHash))?.data;
    const cached = png !== undefined;

    if (png === undefined) {
      // La dirección del lienzo sale de un origen FIJO, nunca de la
      // petición: `request.url` lo arma Next con la cabecera `Host`, y esa la
      // escribe quien llama. Ver `lib/render/origin.ts`.
      png = await renderInvitationPng(captureUrl(invitation.slug));
      // Failing to keep the image must not fail the request that produced it.
      await store
        ?.save({
          versionId: invitation.id,
          contentHash,
          data: png,
          width: RENDER_WIDTH,
          height: RENDER_HEIGHT,
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'unknown_error';
          console.error(`[render] could not cache ${invitation.slug}: ${message}`);
        });
    }

    const body = new Blob([png], { type: 'image/png' });
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': String(body.size),
        'content-disposition': asAttachment
          ? `attachment; filename="${invitation.slug}.png"`
          : 'inline',
        'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
        etag,
        'x-render-size': `${RENDER_WIDTH}x${RENDER_HEIGHT}`,
        'x-render-cache': cached ? 'hit' : 'miss',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    console.error(`[render] ${invitation.slug}: ${message}`);
    return NextResponse.json({ error: 'render_failed', detail: message }, { status: 500 });
  }
}
