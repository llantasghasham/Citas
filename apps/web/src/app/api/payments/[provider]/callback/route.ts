import { applySettlement } from '@/lib/billing/reconcile';
import { getPrisma } from '@/lib/db/client';
import { PAYMENT_PROVIDERS, providerFor } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ provider: string }>;
}

/**
 * POST /api/payments/[provider]/callback
 *
 * El aviso es una PISTA, no una prueba. Dice qué cobro hay que mirar; lo que
 * decide es preguntarle al proveedor. Nada de este cuerpo marca nada pagado.
 *
 * Y lo que pasa después es lo MISMO que hacen el enlace de la pareja, el botón
 * de la oficina y el repaso periódico: `applySettlement`. Esto no era así, y el
 * agujero era serio: el aviso escribía el pago como pagado pero no tocaba el
 * pedido, y como el repaso solo mira los pagos PENDIENTES, ese mismo aviso
 * apagaba la red de seguridad que habría arreglado el pedido más tarde. Una
 * boda podía pagarse, quedar cobrada en Whish, y no activarse nunca.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { provider: raw } = await context.params;
  // Se comprueba contra la lista, no contra el proveedor configurado hoy: un
  // aviso de Whish tiene que seguir entrando después de cambiar de pasarela.
  const name = PAYMENT_PROVIDERS.find((candidate) => candidate === raw);
  if (name === undefined) {
    return Response.json({ error: 'unknown_provider' }, { status: 404 });
  }

  const rawBody = await request.text();

  try {
    const provider = providerFor(name);
    if (provider === null) return Response.json({ error: 'unknown_provider' }, { status: 404 });

    const result = await provider.verifyCallback(request.headers, rawBody);
    const prisma = getPrisma();

    // Por la clave COMPLETA. Buscar solo por la referencia podría dar con el
    // cobro de otra pasarela que use el mismo formato de identificador.
    const payment = await prisma.payment.findUnique({
      where: { provider_providerRef: { provider: name, providerRef: result.providerRef } },
      select: {
        id: true,
        currency: true,
        order: {
          select: {
            id: true,
            tenantId: true,
            amount: true,
            description: true,
            packageGuests: true,
          },
        },
      },
    });
    if (payment === null) return Response.json({ error: 'unknown_payment' }, { status: 404 });

    // Se guarda crudo: cuando un cobro se discute, esto es lo único que sirve.
    // Y se guarda ANTES de preguntar, porque el aviso llegó aunque la consulta
    // que viene ahora se caiga.
    await prisma.paymentEvent.create({
      data: { paymentId: payment.id, kind: 'callback', payload: { rawBody } },
    });

    // La moneda sale de la fila que ya tenemos, NUNCA del cuerpo del aviso: ese
    // cuerpo no va firmado, y con él se elige en qué cobro se mira.
    const status = await provider.getStatus(result.providerRef, payment.currency);
    await applySettlement(payment.order, payment.id, status, 'callback');

    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    console.error(`[payments] callback rejected: ${message}`);
    return Response.json({ error: 'invalid_callback' }, { status: 400 });
  }
}
