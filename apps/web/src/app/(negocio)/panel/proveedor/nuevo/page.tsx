import { redirect } from 'next/navigation';

import { PanelNotice } from '@/components/directory/PanelNotice';
import { getSession } from '@/lib/auth/session';
import { GOVERNORATES, GOVERNORATE_KEYS } from '@/lib/directory/categories';
import { panelLocale } from '@/lib/directory/session';
import { DIRECTORY_LOCALES, getDirectoryDictionary } from '@citas/core';

import { createProviderAction } from '../actions';

interface Props {
  searchParams: Promise<{ error?: string }>;
}

const CAJA = 'w-full border border-[#ddd6c6] bg-white px-3 py-2 text-sm text-[#23201a]';
const ETIQUETA = 'flex flex-col gap-1 text-xs text-[#6a6456]';

/**
 * Dar de alta un negocio.
 *
 * Pide lo mínimo —nombre, dónde está y en qué idioma escribe— y nada más. El
 * resto se rellena después: un formulario de veinte campos antes de ver nada es
 * como se pierde a quien iba a pagar por estar aquí.
 *
 * Nace en BORRADOR. No sale al directorio hasta que su dueño lo mande a revisión
 * y alguien lo mire.
 */
export default async function NewProviderPage({ searchParams }: Props) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  if (session === null) redirect('/entrar');

  const locale = panelLocale(undefined, session.locale);
  const copy = getDirectoryDictionary(locale);

  // Todos los distritos, agrupados por su gobernación: sin JavaScript de cliente
  // no hay dos casillas encadenadas, y el servicio comprueba que el distrito sea
  // de esa gobernación antes de escribir nada.
  return (
    <>
      <h1 className="text-2xl">{copy.panel.newTitle}</h1>
      <p className="text-sm text-[#6a6456]">{copy.panel.newHelp}</p>

      <PanelNotice params={params} copy={copy} />

      <form
        action={createProviderAction}
        className="flex flex-col gap-3 border border-[#ddd6c6] bg-[#fbf6ec] p-4"
      >
        <label className={ETIQUETA}>
          {copy.panel.legalName}
          <input name="legalName" required maxLength={120} className={CAJA} />
          <span className="opacity-70">{copy.panel.legalNameHelp}</span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={ETIQUETA}>
            {copy.search.governorate}
            <select name="governorate" defaultValue="beirut" className={CAJA}>
              {GOVERNORATE_KEYS.map((one) => (
                <option key={one} value={one}>
                  {copy.governorates[one]}
                </option>
              ))}
            </select>
          </label>

          <label className={ETIQUETA}>
            {copy.search.district}
            <select name="district" defaultValue="beirut" className={CAJA}>
              {GOVERNORATE_KEYS.map((governorate) => (
                <optgroup key={governorate} label={copy.governorates[governorate]}>
                  {GOVERNORATES[governorate].map((district) => (
                    <option key={district} value={district}>
                      {copy.districts[district]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className={ETIQUETA}>
            {copy.panel.city}
            <input name="city" required maxLength={80} className={CAJA} />
          </label>

          <label className={ETIQUETA}>
            {copy.panel.mainLocale}
            <select name="mainLocale" defaultValue={locale} className={CAJA}>
              {DIRECTORY_LOCALES.map((one) => (
                <option key={one} value={one}>
                  {one.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="submit"
          className="self-start bg-[#8a6c22] px-5 py-2 text-sm text-[#fbf6ec] hover:opacity-90"
        >
          {copy.panel.create}
        </button>
      </form>
    </>
  );
}
