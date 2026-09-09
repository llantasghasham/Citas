import type { Metadata } from 'next';

import { payAction } from './actions';

import { enabledMethods, loadPublicOrder, settlePublicOrder } from '@/lib/billing/checkout';
import { setting } from '@/lib/settings';
import { formatMoney } from '@/lib/billing/plans';
import { resolvePayLocale } from '@/lib/billing/pay-locale';
import { bodyFont, displayFont } from '@/lib/typography';
import { getDictionary, interpolate } from '@citas/core';

export const dynamic = 'force-dynamic';
// El cobro de una pareja concreta no se indexa. Nunca.
export const metadata: Metadata = { robots: { index: false, follow: false } };

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ volvio?: string; fallo?: string; lang?: string }>;
}

/**
 * El cobro de un paquete, para la pareja que se casa.
 *
 * Público a propósito, por la misma razón que el formulario de confirmación:
 * quien paga no tiene cuenta aquí y no va a abrirse una para pagar. Lo que
 * autoriza es el token del enlace, y lo único que abre es este pedido.
 *
 * Volver a esta URL NO cobra nada ni prueba nada. Si el navegador dice que
 * vuelve del proveedor, se le pregunta al proveedor: `settlePublicOrder()`.
 */
export default async function PayPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { volvio, fallo, lang } = await searchParams;

  const order = await loadPublicOrder(token);
  const locale = resolvePayLocale(order, lang);
  const dictionary = getDictionary(locale);
  const copy = dictionary.pay;

  if (order === null) {
    return (
      <Shell locale={locale}>
        <p className="text-[#8c2f1e]">{copy.notFound}</p>
      </Shell>
    );
  }

  // Solo cuando el navegador dice que viene de pagar: cada comprobación es una
  // llamada al proveedor, y no se le llama por recargar la página de espera.
  const status = volvio === '1' ? ((await settlePublicOrder(token)) ?? order.status) : order.status;

  // Lo que se le puede ofrecer. Whish manda a su propia pantalla; el efectivo
  // no manda a ningún sitio, solo dice dónde y cómo pagar. Lo que no esté
  // encendido en la configuración no aparece.
  const methods = await enabledMethods();
  const cashText = (await setting('CASH_INSTRUCTIONS')) ?? copy.cashDefault;

  return (
    <Shell locale={locale}>
      <header className="flex flex-col gap-2">
        <h1 className={`${displayFont(locale)} text-3xl`}>{copy.heading}</h1>
        {order.eventTitle.length === 0 ? null : (
          <p className={`${displayFont(locale)} text-lg text-[#8a6c22]`}>
            {interpolate(copy.forWedding, { names: order.eventTitle })}
          </p>
        )}
        <p className="text-sm text-[#6a6456]">
          {interpolate(copy.fromOffice, { office: order.officeName })}
        </p>
      </header>

      <dl className="flex flex-col border-t border-[#ddd6c6]">
        <Row label={copy.packageLabel}>
          {interpolate(copy.guestsLine, { guests: String(order.guests) })}
        </Row>
        <Row label={copy.total}>
          <span className="tabular-nums">
            {formatMoney(order.amount, order.currency, locale)}
          </span>
        </Row>
      </dl>

      {status === 'paid' ? (
        <section className="flex flex-col gap-2 border border-[#4a6b3a] bg-[#f2f7ee] p-5">
          <h2 className={`${displayFont(locale)} text-xl text-[#3d5a2f]`}>{copy.paidTitle}</h2>
          <p className="text-sm text-[#4a5340]">{copy.paidBody}</p>
        </section>
      ) : (
        <>
          {fallo === 'pasarela' ? (
            <p role="alert" className="border border-[#8c2f1e] bg-[#fdf4f2] p-4 text-sm text-[#8c2f1e]">
              {copy.providerError}
            </p>
          ) : null}

          {status === 'failed' || status === 'expired' ? (
            <section className="flex flex-col gap-2 border border-[#8c2f1e] bg-[#fdf4f2] p-5">
              <h2 className={`${displayFont(locale)} text-xl text-[#8c2f1e]`}>{copy.failedTitle}</h2>
              <p className="text-sm text-[#6a6456]">{copy.failedBody}</p>
            </section>
          ) : volvio === '1' ? (
            // Volvió del proveedor y el proveedor todavía no dice «pagado».
            // No se le enseña un «gracias» que no consta.
            <section className="flex flex-col gap-2 border border-[#c9a227] bg-[#fdf9ef] p-5">
              <h2 className={`${displayFont(locale)} text-xl text-[#8a6c22]`}>{copy.pendingTitle}</h2>
              <p className="text-sm text-[#6a6456]">{copy.pendingBody}</p>
              <a className="text-sm underline text-[#8a6c22]" href={`/pagar/${token}?volvio=1`}>
                {copy.checkAgain}
              </a>
            </section>
          ) : null}

          {methods.includes('whish') ? (
            <form action={payAction} className="flex flex-col gap-3">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="border border-[#23201a] bg-[#23201a] px-6 py-3 text-white hover:opacity-80"
              >
                {copy.payNow}
              </button>
              {/* Dicho antes de pulsar, no después: quien paga tiene que saber
                  dónde acaba, y que aquí no se le pide ningún número. */}
              <p className="text-xs text-[#6a6456]">{copy.hosted}</p>
            </form>
          ) : null}

          {methods.includes('cash') ? (
            <section className="flex flex-col gap-2 border border-[#ddd6c6] bg-white/60 p-5">
              <h2 className={`${displayFont(locale)} text-lg`}>{copy.cashTitle}</h2>
              {/* Sin botón: en efectivo no hay nada que pulsar. Lo anota la
                  oficina cuando recibe el dinero, y hasta entonces esto sigue
                  diciendo lo que dice. */}
              <p className="text-sm whitespace-pre-line text-[#6a6456]">{cashText}</p>
            </section>
          ) : null}

          {methods.length === 0 ? (
            <p role="alert" className="border border-[#8c2f1e] bg-[#fdf4f2] p-4 text-sm text-[#8c2f1e]">
              {copy.orNothing}
            </p>
          ) : null}
        </>
      )}
    </Shell>
  );
}

function Shell({ locale, children }: { locale: Parameters<typeof bodyFont>[0]; children: React.ReactNode }) {
  return (
    <main className={`${bodyFont(locale)} mx-auto flex min-h-screen max-w-xl flex-col gap-8 px-6 py-16`}>
      {children}
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[#ddd6c6] py-4 sm:flex-row sm:gap-6">
      <dt className="text-sm text-[#6a6456] sm:w-40">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
