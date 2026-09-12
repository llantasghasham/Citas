import { savePreferencesAction } from '@/app/i/[slug]/actions';
import type { AuthorizedAct } from '@/lib/acts/access';
import { PREFERENCE_KEYS, PREFERENCE_OPTIONS } from '@/lib/checkin/preferences';
import type { PreferenceKey, PreferenceRow } from '@/lib/checkin/preferences';
import { resolveActNames } from '@/lib/acts/translations';
import type { TenantScope } from '@/lib/db/tenant';
import type { Dictionary, Locale } from '@citas/core';
import { interpolate } from '@citas/core';

/**
 * Lo que el invitado necesita para que la fiesta le sirva: qué come, cómo
 * llega, qué necesita para moverse y si quiere salir en las fotos.
 *
 * Tres decisiones que se ven aquí:
 *
 *   1. **Solo con enlace personal.** Esto cuelga de un invitado concreto, y sin
 *      token no hay invitado. Quien llega por un reenvío ve el programa y el
 *      formulario abierto de siempre, no esto.
 *   2. **Todo son listas cerradas**, las preguntas y las respuestas. Lo que se
 *      guarda es un código (`gluten_free`), y lo que se lee lo pone el
 *      diccionario. La razón larga está en `lib/checkin/preferences.ts`: son
 *      datos de salud de gente que no tiene cuenta aquí.
 *   3. **«Sin indicar» es una opción de verdad**, la primera y la de por
 *      defecto, y elegirla BORRA la fila. Retirar lo dicho tiene que poder
 *      hacerse desde la misma pantalla donde se dijo.
 *
 * Y el bloque por acto solo aparece si hay más de un acto: en una boda de un
 * solo acto es la misma pregunta dos veces. Va dentro de un `<details>` porque
 * lo normal es comer lo mismo en los tres sitios; quien necesita distinguir la
 * cena de la henna lo abre.
 *
 * Sin JavaScript de cliente: cada bloque es su propio formulario.
 */
interface Props {
  slug: string;
  /** Los actos de SU agenda, ya decididos por el servidor. */
  acts: AuthorizedAct[];
  saved: PreferenceRow[];
  dictionary: Dictionary;
  /** La oficina de esta invitación: sus traducciones están en SU base. */
  scope: TenantScope;
  /** El idioma del INVITADO, no el de la oficina. */
  locale: Locale;
}

type ResolvedNames = Awaited<ReturnType<typeof resolveActNames>>;

function Selects({
  copy,
  saved,
  actId,
}: {
  copy: Dictionary['preferences'];
  saved: PreferenceRow[];
  actId: string | null;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {PREFERENCE_KEYS.map((key) => {
        const current = saved.find((row) => row.actId === actId && row.key === key);
        return (
          <label key={key} className="flex flex-col gap-1 text-xs">
            {copy.keys[key]}
            <select
              name={key}
              defaultValue={current?.value ?? ''}
              className="h-10 min-w-40 border border-[color:var(--inv-accent)] bg-white/70 px-2 text-sm"
            >
              <option value="">{copy.none}</option>
              {PREFERENCE_OPTIONS[key].map((option) => (
                <option key={option} value={option}>
                  {/* El índice es seguro: la lista de opciones y la del
                      diccionario son la misma, y el tipo lo comprueba. */}
                  {copy.options[key][option as keyof (typeof copy.options)[PreferenceKey]]}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}

export async function GuestPreferences({
  slug,
  acts,
  saved,
  dictionary,
  scope,
  locale,
}: Props) {
  const copy = dictionary.preferences;
  // El mismo nombre que el invitado acaba de leer en el programa, resuelto por
  // el mismo sitio: dos formas de nombrar el mismo acto en la misma página es
  // cómo alguien acaba diciéndole «sin gluten» a la cena equivocada.
  const names: ResolvedNames =
    acts.length > 1 ? await resolveActNames(scope, acts, locale) : new Map();

  return (
    <section id="preferencias" className="flex w-full flex-col gap-3">
      <h2 className="text-center text-lg text-[color:var(--inv-primary)]">{copy.heading}</h2>
      <p className="text-center text-xs opacity-70">{copy.hint}</p>

      <form
        action={savePreferencesAction}
        className="flex flex-col gap-3 border border-[color:var(--inv-accent)] p-4"
      >
        <input type="hidden" name="slug" value={slug} />
        <Selects copy={copy} saved={saved} actId={null} />
        <button
          type="submit"
          className="h-10 self-start border border-[color:var(--inv-primary)] px-4 text-sm"
        >
          {copy.save}
        </button>
      </form>

      {acts.length > 1 && (
        <details className="border border-[color:var(--inv-accent)] p-4">
          <summary className="cursor-pointer text-sm">{copy.forAct.replace('{act}', '…')}</summary>
          <div className="flex flex-col gap-5 pt-4">
            {acts.map((act) => (
              <form
                key={act.id}
                action={savePreferencesAction}
                className="flex flex-col gap-3 border-t border-[color:var(--inv-accent)] pt-3"
              >
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="actId" value={act.id} />
                <p className="text-sm">
                  {interpolate(copy.forAct, {
                    act: names.get(act.id)?.name ?? act.label ?? dictionary.actTypes[act.type],
                  })}
                </p>
                <Selects copy={copy} saved={saved} actId={act.id} />
                <button
                  type="submit"
                  className="h-10 self-start border border-[color:var(--inv-primary)] px-4 text-sm"
                >
                  {copy.save}
                </button>
              </form>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
