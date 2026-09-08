import { NextResponse } from 'next/server';

import { getInvitationBySlug } from '@/lib/invitations';
import { RENDER_HEIGHT, RENDER_WIDTH, renderInvitationPng } from '@/lib/render/png';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/** GET /api/render/[slug] → a 1080×1920 PNG of the invitation. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { slug } = await context.params;
  const invitation = getInvitationBySlug(slug);
  if (invitation === undefined) {
    return NextResponse.json({ error: 'invitation_not_found', slug }, { status: 404 });
  }

  const captureUrl = new URL(`/render/${invitation.slug}`, request.url).toString();

  try {
    const png = await renderInvitationPng(captureUrl);
    const body = new Blob([png], { type: 'image/png' });
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': String(body.size),
        'content-disposition': `attachment; filename="${invitation.slug}.png"`,
        'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
        'x-render-size': `${RENDER_WIDTH}x${RENDER_HEIGHT}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    console.error(`[render] ${invitation.slug}: ${message}`);
    return NextResponse.json({ error: 'render_failed', detail: message }, { status: 500 });
  }
}
