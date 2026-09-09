'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { requestHost } from '@/lib/admin/context';
import { beginPublicPayment } from '@/lib/billing/checkout';

/**
 * Manda a quien paga a la pantalla de Whish.
 *
 * La cobranza se abre AQUÍ y no al crear el pedido, porque un enlace de cobro
 * caduca y entre lo uno y lo otro pueden pasar días.
 *
 * No se comprueba ninguna sesión, y es a propósito: la pareja no tiene cuenta.
 * Lo que autoriza es el token del enlace, que no se puede adivinar, y lo único
 * que puede hacer quien lo tenga es pagar el pedido al que apunta.
 */
export async function payAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (token.length === 0) redirect('/');

  const origin = `https://${requestHost(await headers())}`;
  const result = await beginPublicPayment(token, origin);

  if ('error' in result) {
    if (result.error === 'notFound') redirect('/');
    if (result.error === 'alreadyPaid') redirect(`/pagar/${token}?volvio=1`);
    redirect(`/pagar/${token}?fallo=pasarela`);
  }

  redirect(result.payUrl);
}
