import { getPrisma } from '@/lib/db/client';
import { getPaymentProvider } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ provider: string }>;
}

/**
 * POST /api/payments/[provider]/callback
 *
 * The callback is a hint, not proof. It says which order to look at; the order
 * is then settled by asking the provider directly. Nothing here marks anything
 * paid from the request body.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { provider: name } = await context.params;
  const provider = await getPaymentProvider();
  if (provider.id !== name) {
    return Response.json({ error: 'unknown_provider' }, { status: 404 });
  }

  const rawBody = await request.text();

  try {
    const result = await provider.verifyCallback(request.headers, rawBody);
    const prisma = getPrisma();
    const payment = await prisma.payment.findFirst({
      where: { providerRef: result.providerRef },
      select: { id: true, currency: true },
    });
    if (payment === null) return Response.json({ error: 'unknown_payment' }, { status: 404 });

    // Recorded verbatim: when a payment is disputed this is the only evidence.
    await prisma.paymentEvent.create({
      data: { paymentId: payment.id, kind: 'callback', payload: { rawBody } },
    });

    // La moneda sale de la fila que ya tenemos, NUNCA del cuerpo del callback:
    // ese cuerpo no va firmado, y con él se elige en qué cobro se mira.
    const status = await provider.getStatus(result.providerRef, payment.currency);
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status,
        lastCheckedAt: new Date(),
        paidAt: status === 'paid' ? new Date() : null,
      },
    });

    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    console.error(`[payments] callback rejected: ${message}`);
    return Response.json({ error: 'invalid_callback' }, { status: 400 });
  }
}
