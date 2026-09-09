import { saveHomeTextsAction } from '@/app/panel/configuracion/actions';
import { SaveButton } from '@/components/panel/config/MailSection';
import { FIELD_CLASS } from '@/components/create/Field';
import { SettingField, type SettingProps } from '@/components/panel/SettingField';
import { LOCALE_NAMES } from '@/lib/create/options';
import type { HomeText } from '@/lib/settings/home';
import { displayFont, latinOnly } from '@/lib/typography';
import { LOCALES, type Dictionary, type Locale } from '@citas/core';

/**
 * Cada texto de la portada, editable.
 *
 * La lista NO está escrita aquí: se genera recorriendo el bloque `home` del
 * diccionario, así que añadir una frase a los cuatro idiomas la hace aparecer
 * sola. Una lista escrita a mano se habría quedado desfasada en la primera
 * frase nueva, y el resultado habría sido una pantalla que promete editarlo
 * todo y edita la mitad.
 *
 * Un campo vacío significa «el texto original». No hay forma de dejar un texto
 * en blanco, y es a propósito: una portada con huecos es peor que una portada
 * con la frase de fábrica.
 */
export function HomeSection({
  editing,
  texts,
  sections,
  showcase,
  defaultLocale,
  dictionary,
  locale,
}: {
  editing: Locale;
  texts: HomeText[];
  sections: SettingProps;
  showcase: SettingProps;
  defaultLocale: SettingProps;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.admin.config;

  return (
    <div className="flex flex-col gap-8">
      {/* Lo que NO es texto: qué bloques salen y qué se enseña. */}
      <form action={saveHomeTextsAction} className="flex max-w-2xl flex-col gap-5">
        <input type="hidden" name="sector" value="home-layout" />
        <SettingField {...sections} dictionary={dictionary} />
        <SettingField {...showcase} dictionary={dictionary} />
        <SettingField {...defaultLocale} dictionary={dictionary} />
        <SaveButton dictionary={dictionary} />
      </form>

      <section className="flex flex-col gap-4 border-t border-[#ddd6c6] pt-6">
        <h2 className={`${displayFont(locale)} text-xl`}>{copy.homeLanguage}</h2>
        <nav className="flex flex-wrap gap-2">
          {LOCALES.map((option) => (
            <a
              key={option}
              href={`/panel/configuracion?s=home&idioma=${option}`}
              aria-current={option === editing ? 'page' : undefined}
              className={`border px-4 py-2 text-sm ${
                option === editing
                  ? 'border-[#8a6c22] bg-[#fdf9ef] text-[#8a6c22]'
                  : 'border-[#ddd6c6] text-[#6a6456] hover:text-[#23201a]'
              }`}
            >
              {LOCALE_NAMES[option]}
            </a>
          ))}
        </nav>
        <p className="text-sm text-[#6a6456]">{copy.homeReset}</p>
      </section>

      <form action={saveHomeTextsAction} className="flex max-w-3xl flex-col gap-6">
        <input type="hidden" name="sector" value="home-texts" />
        <input type="hidden" name="idioma" value={editing} />

        {texts.map((text) => (
          <label
            key={text.path}
            // El árabe de la portada se edita en árabe y de derecha a izquierda
            // aunque el panel esté en español: se escribe lo que se ve.
            dir={editing === 'ar' ? 'rtl' : 'ltr'}
            className="flex flex-col gap-2 text-sm text-[#23201a]"
          >
            <span className={`font-mono text-xs ${latinOnly(locale, 'tracking-[0.04em]')} text-[#8a6c22]`} dir="ltr">
              {text.path}
              {text.overridden ? ' ·' : null}
              {text.overridden ? <span className="text-[#2f6b3a]"> {copy.fromPanel}</span> : null}
            </span>
            <textarea
              name={`t:${text.path}`}
              defaultValue={text.overridden ? text.value : ''}
              placeholder={text.fallback}
              rows={text.fallback.length > 90 ? 3 : 1}
              className={FIELD_CLASS}
            />
          </label>
        ))}

        <SaveButton dictionary={dictionary} />
      </form>
    </div>
  );
}
