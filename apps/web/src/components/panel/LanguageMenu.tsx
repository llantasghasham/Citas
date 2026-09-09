import { setPanelLocaleAction } from '@/app/panel/actions-locale';
import { LOCALE_NAMES } from '@/lib/create/options';
import { LOCALES, type Dictionary, type Locale } from '@/lib/types';

/**
 * El idioma del panel, en un icono de mundo.
 *
 * Cuatro botones sueltos ocupaban un cuarto de la cabecera y en árabe, con los
 * nombres en su propia escritura, más. Aquí van plegados detrás del icono que
 * todo el mundo reconoce.
 *
 * Se abre con `<details>`, que es un desplegable de verdad del navegador: sin
 * JavaScript de cliente, como el resto de este proyecto, y funcionando con
 * teclado y con lector de pantalla sin que haya que escribirlo.
 *
 * La elección se guarda en la cuenta de quien lee, no en la oficina: dos
 * personas del mismo mostrador pueden trabajar en idiomas distintos.
 */
export function LanguageMenu({
  locale,
  dictionary,
}: {
  locale: Locale;
  dictionary: Dictionary;
}) {
  const label = dictionary.admin.panel.language;

  return (
    <details className="relative ms-auto">
      <summary
        aria-label={`${label}: ${LOCALE_NAMES[locale]}`}
        title={label}
        className="flex cursor-pointer list-none items-center gap-2 px-2 py-1 text-[#6a6456] hover:text-[#23201a]"
      >
        <Globe />
        <span className="text-xs" lang={locale}>
          {LOCALE_NAMES[locale]}
        </span>
      </summary>

      <form
        action={setPanelLocaleAction}
        // Colgado del borde de arranque del icono, que en árabe es el derecho:
        // `inset-inline-end` lo resuelve solo en las dos direcciones.
        className="absolute end-0 z-30 mt-2 flex min-w-40 flex-col border border-[#ddd6c6] bg-[#f4efe6] py-1 shadow-[0_8px_24px_-12px_rgba(35,32,26,0.5)]"
      >
        {LOCALES.map((option) => (
          <button
            key={option}
            type="submit"
            name="locale"
            value={option}
            lang={option}
            aria-current={option === locale ? 'true' : undefined}
            className={`px-4 py-2 text-start text-sm hover:bg-[#e9e2d3] ${
              option === locale ? 'text-[#8a6c22]' : 'text-[#23201a]'
            }`}
          >
            {LOCALE_NAMES[option]}
          </button>
        ))}
      </form>
    </details>
  );
}

/** Un mundo. Dibujado, no una fuente de iconos: son dos trazos. */
function Globe() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </svg>
  );
}
