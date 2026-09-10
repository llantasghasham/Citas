import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAdminContext } from '@/lib/admin/context';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { readSeating, type SeatedGuest } from '@/lib/tables/service';
import { displayFont } from '@/lib/typography';
import { interpolate } from '@citas/core';

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ vista?: string }>;
}

/**
 * Las dos listas que se llevan al salón, en papel.
 *
 * Son dos porque se usan en sitios distintos y por gente distinta. La de mesas
 * la mira quien monta la sala y quien sirve la comida. La de invitados, en
 * orden alfabético, la mira quien está en la puerta y tiene que responder
 * «¿dónde me siento?» en dos segundos — y con la lista por mesas eso obliga a
 * recorrer veinte mesas buscando un nombre.
 *
 * Sale solo lo que se lleva al papel: sin cabecera del panel, sin menús y sin
 * un botón de imprimir, que es una cosa que el navegador ya trae.
 */
export default async function PrintSeatingPage({ params, searchParams }: PageProps) {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'event:read') || session.tenantId === null) {
    redirect('/panel');
  }

  const { eventId } = await params;
  const { vista } = await searchParams;
  const byGuest = vista === 'invitado';
  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.tables;

  const seating = await readSeating(scopeOf(session), eventId);
  if (seating === null) redirect('/panel');

  // Quien se sienta, con el nombre de su mesa al lado. Solo los que vienen: en
  // la puerta no se busca a quien no ha confirmado.
  const guests: (SeatedGuest & { table: string })[] = seating.tables
    .flatMap((table) => table.guests.map((guest) => ({ ...guest, table: table.name })))
    .concat(seating.unseated.map((guest) => ({ ...guest, table: copy.noTable })))
    .filter((guest) => guest.seats > 0)
    .sort((a, b) => a.name.localeCompare(b.name, locale));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 bg-white p-8 text-[#23201a] print:p-0">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[#ddd6c6] pb-3">
        <h1 className={`${displayFont(locale)} text-2xl`}>{copy.heading}</h1>
        <span className="text-sm text-[#6a6456]">
          {byGuest ? copy.printByGuest : copy.printByTable}
        </span>
        <span className="text-sm tabular-nums text-[#6a6456]">
          {interpolate(copy.balance, {
            needed: String(seating.needed),
            available: String(seating.available),
          })}
        </span>
        {/* No se imprime: es para volver, no para el papel. */}
        <Link
          href={`/panel/eventos/${eventId}/mesas`}
          className="ms-auto text-sm text-[#8a6c22] underline print:hidden"
        >
          {copy.back}
        </Link>
      </header>

      {byGuest ? (
        <ul className="flex flex-col">
          {guests.map((guest) => (
            <li
              key={guest.id}
              className="flex items-baseline justify-between gap-4 border-b border-[#e7e0d2] py-1.5 text-sm"
            >
              <span>
                {guest.name}
                {guest.seats > 1 ? (
                  <span className="tabular-nums text-xs text-[#6a6456]"> ×{guest.seats}</span>
                ) : null}
              </span>
              <span className="font-medium">{guest.table}</span>
            </li>
          ))}
        </ul>
      ) : (
        // Cada mesa entera en su hoja cuando toque; partir una por la mitad es
        // lo que hace que en el salón falte gente al montarla.
        <div className="flex flex-col gap-6">
          {seating.tables.map((table) => (
            <section key={table.id} className="flex break-inside-avoid flex-col gap-2">
              <h2 className="flex items-baseline gap-3 border-b border-[#23201a] pb-1">
                <span className={`${displayFont(locale)} text-lg`}>{table.name}</span>
                <span className="text-sm tabular-nums text-[#6a6456]">
                  {interpolate(copy.occupancy, {
                    taken: String(table.taken),
                    seats: String(table.seats),
                  })}
                </span>
              </h2>
              {table.guests.filter((guest) => guest.seats > 0).length === 0 ? (
                <p className="text-sm text-[#6a6456]">{copy.seatedNobody}</p>
              ) : (
                <ol className="flex list-inside list-decimal flex-col gap-1 text-sm">
                  {table.guests
                    .filter((guest) => guest.seats > 0)
                    .map((guest) => (
                      <li key={guest.id}>
                        {guest.name}
                        {guest.seats > 1 ? (
                          <span className="tabular-nums text-xs text-[#6a6456]"> ×{guest.seats}</span>
                        ) : null}
                      </li>
                    ))}
                </ol>
              )}
            </section>
          ))}

          {seating.unseated.length === 0 ? null : (
            <section className="flex break-inside-avoid flex-col gap-2">
              <h2 className="border-b border-[#8c2f1e] pb-1 text-lg text-[#8c2f1e]">
                {copy.unseated} · {seating.unseated.length}
              </h2>
              <ul className="flex flex-col gap-1 text-sm">
                {seating.unseated.map((guest) => (
                  <li key={guest.id}>{guest.name}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
