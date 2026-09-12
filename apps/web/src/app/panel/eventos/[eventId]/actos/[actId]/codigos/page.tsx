import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAdminContext } from '@/lib/admin/context';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { codeSheet } from '@/lib/checkin/codes';
import { displayFont } from '@/lib/typography';

interface PageProps {
  params: Promise<{ eventId: string; actId: string }>;
}

/**
 * Los códigos de la puerta, en papel.
 *
 * Un recuadro por invitado AUTORIZADO a este acto, con su nombre, el nombre del
 * acto y su QR. Se recorta y se reparte, o se pega en la tarjeta: es lo que
 * convierte la puerta en «leer un código» en vez de «teclear veinte caracteres
 * con quince personas esperando».
 *
 * Va por ACTO y el nombre del acto sale en cada recuadro, porque el código
 * también es por acto: el de la recepción no abre la henna, y cien papeles
 * iguales sin decir de cuál son es exactamente cómo se reparten mal.
 *
 * Sale solo lo que se lleva al papel —la cabecera del panel ya no se imprime,
 * como en la lista de mesas— y no hay botón de imprimir: eso lo trae el
 * navegador, y un botón exigiría JavaScript de cliente, que aquí no hay.
 */
export default async function GateCodesPage({ params }: PageProps) {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:read') || session.tenantId === null) {
    redirect('/panel');
  }

  const { eventId, actId } = await params;
  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.gate;

  // El acto y el evento se comprueban dentro, contra la oficina de la SESIÓN:
  // los dos ids vienen de la dirección, o sea del cliente.
  const sheet = await codeSheet(scopeOf(session), eventId, actId);
  if (sheet === null) redirect('/panel');

  const actName = sheet.label ?? dictionary.actTypes[sheet.type];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 bg-white p-8 text-[#23201a] print:p-0">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[#ddd6c6] pb-3">
        <h1 className={`${displayFont(locale)} text-2xl`}>{copy.print}</h1>
        <span className="text-sm text-[#6a6456]">
          {actName} · {sheet.date}
        </span>
        <span className="text-sm text-[#6a6456]">{copy.codesHint}</span>
        {/* No se imprime: es para volver, no para el papel. */}
        <Link
          href={`/panel/eventos/${eventId}/puerta?acto=${sheet.actId}`}
          className="ms-auto text-sm text-[#8a6c22] underline print:hidden"
        >
          {copy.back}
        </Link>
      </header>

      {/* Una hoja vacía no es una hoja: quien la mande a imprimir tiene que
          leer por qué no hay nada, y no que «todavía no ha entrado nadie», que
          es de la otra pantalla y aquí no vendría a cuento. */}
      {sheet.rows.length === 0 && <p className="text-sm text-[#6a6456]">{copy.codesNobody}</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {sheet.rows.map((row) => (
          // Un recuadro no se parte entre dos hojas: la mitad de un QR no se
          // lee, y quien recorta no se entera hasta que está en la puerta.
          <section
            key={row.guestId}
            className="flex break-inside-avoid flex-col items-center gap-2 border border-[#ddd6c6] p-3 text-center"
          >
            {/* El SVG lo dibuja `lib/checkin/codes.ts` en el servidor; va
                incrustado y no por `<img>` para que la hoja se imprima entera
                aunque el navegador no llegue a pedir doscientas imágenes. */}
            <div
              className="w-32 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: row.svg }}
            />
            <span className="text-sm font-medium">{row.name}</span>
            <span className="text-xs text-[#6a6456]">{actName}</span>
          </section>
        ))}
      </div>
    </main>
  );
}
