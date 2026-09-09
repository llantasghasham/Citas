import { latinOnly } from '@/lib/typography';
import { CONFIG_SECTIONS, type ConfigSection, type Dictionary, type Locale } from '@citas/core';

/**
 * Los sectores de la configuración.
 *
 * Enlaces, no pestañas de JavaScript: cada sector es una dirección propia, así
 * que se puede guardar en marcadores, abrir en otra pestaña y volver con el
 * botón de atrás. Esta pantalla no tiene JavaScript de cliente, como el resto.
 */
export function ConfigNav({
  current,
  dictionary,
  locale,
}: {
  current: ConfigSection;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.admin.config;

  return (
    <nav className="flex flex-wrap gap-x-1 gap-y-2 border-b border-[#ddd6c6]">
      {CONFIG_SECTIONS.map((section) => {
        const active = section === current;
        return (
          <a
            key={section}
            href={`/panel/configuracion?s=${section}`}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm ${latinOnly(locale, 'tracking-[0.02em]')} ${
              active
                ? 'border-[#8a6c22] text-[#8a6c22]'
                : 'border-transparent text-[#6a6456] hover:text-[#23201a]'
            }`}
          >
            {copy.sections[section]}
          </a>
        );
      })}
    </nav>
  );
}
