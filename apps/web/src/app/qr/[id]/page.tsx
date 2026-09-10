import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { getAdminContext } from '@/lib/admin/context';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { connectionState } from '@/lib/whatsapp/connections';
import { bodyFont } from '@/lib/typography';
import { hasExpired, isWaiting } from '@/lib/whatsapp/waiting';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

const VOLVER = '/panel/configuracion?s=whatsapp';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ esperando?: string }>;
}

/**
 * El código QR de un número, en un documento aparte para meterlo en un marco.
 *
 * Vive FUERA de `/panel` a propósito, y son dos razones distintas.
 *
 * La primera es visible: dentro de `/panel` heredaría la cabecera del panel, y
 * un menú de navegación dentro de un recuadro de trescientos píxeles no es una
 * pantalla, es un accidente.
 *
 * La segunda es la que arregla un fallo de verdad. Esta pantalla se recarga
 * sola con `<meta refresh>` mientras espera el código, y ese temporizador NO lo
 * guarda la etiqueta: lo guarda el documento, junto con la dirección que tenía
 * cuando se leyó. Como el panel navega sin recargar la página, el temporizador
 * armado en la pantalla de WhatsApp seguía vivo después de irse a otra
 * pantalla, y cinco segundos más tarde arrastraba el navegador de vuelta —
 * entrabas al perfil y te plantaba en WhatsApp. Quitar la etiqueta del `head`
 * no lo cancela; solo destruir el documento lo cancela. Metido en un marco, el
 * documento es el del marco: al salir de la pantalla desaparece el marco, y el
 * temporizador se va con él.
 */
export default async function QrPage({ params, searchParams }: PageProps) {
  const session = await getSession();
  if (session === null) redirect('/entrar');
  if (!sessionCan(session, 'tenant:manage') || session.tenantId === null) notFound();

  const { id } = await params;
  const { esperando } = await searchParams;

  // Con el scope de la sesión: el id viaja en la dirección, así que sin esto
  // cualquiera con sesión miraría el código de otra oficina — y quien ve un
  // código lo escanea y escribe desde el WhatsApp de ese cliente.
  const connection = await connectionState(scopeOf(session), id);
  if (connection === null) notFound();

  const { dictionary, direction, locale } = await getAdminContext(session.tenantId, session.locale);
  const copy = dictionary.admin.whatsapp;

  const waiting = isWaiting(connection, esperando);
  const expired = hasExpired(connection, esperando);

  return (
    // El idioma del marco lo manda la SESIÓN, igual que en el resto del panel.
    // El `<html>` de fuera lo resuelve el proxy por la ruta, y esta ruta no es
    // suya: sin esto, el árabe se dibujaría dentro de un documento declarado en
    // inglés y de izquierda a derecha.
    <div
      dir={direction}
      lang={locale}
      className={`${bodyFont(locale)} flex flex-col gap-3 p-1 text-sm text-[#23201a]`}
    >
      {/* El fondo lo pinta el documento del marco, y el suyo es el del sitio:
          sobre la tarjeta blanca del panel se veía un recuadro más oscuro. */}
      <style>{'body{background:transparent}'}</style>

      {/* Solo mientras se espera de verdad. Un número que ya está conectado no
          tiene por qué recargar nada, y uno cuyo código caducó tampoco: seguir
          recargando sería quedarse dando vueltas sin decirlo. */}
      {waiting ? <meta httpEquiv="refresh" content="4" /> : null}

      {connection.status === 'qr' && connection.qrCode !== null && waiting ? (
        <>
          <p>{copy.scan}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- una imagen
              en data:, dibujada en el servidor. */}
          <img src={connection.qrCode} alt="" width={260} height={260} />
          <p className="text-xs text-[#6a6456]">{copy.refresh}</p>
        </>
      ) : waiting ? (
        <p className="text-[#8a6c22]">{copy.waiting}</p>
      ) : (
        <>
          <p className={connection.status === 'connected' ? 'text-[#2f6b3a]' : 'text-[#8a6c22]'}>
            {expired ? copy.expired : copy.states[connection.status]}
          </p>
          {connection.lastError === null ? null : (
            <p className="text-xs text-[#8c2f1e]">{connection.lastError}</p>
          )}
          {/* `_top` porque esto vive en un marco: sin él, la pantalla del panel
              se abriría DENTRO del recuadro. Y es un enlace y no una recarga
              automática porque un marco no puede llevarse a la página que lo
              contiene sin JavaScript, y ese es justo el precio de que el
              temporizador no pueda perseguir a nadie. */}
          <a href={VOLVER} target="_top" className="underline text-[#8a6c22]">
            {copy.continueHere}
          </a>
        </>
      )}
    </div>
  );
}
