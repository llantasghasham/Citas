import { changePasswordAction } from '@/app/panel/perfil/actions';
import { Field, FIELD_CLASS } from '@/components/create/Field';
import { displayFont } from '@/lib/typography';
import { interpolate, type Dictionary, type Locale } from '@citas/core';

/**
 * La contraseña propia.
 *
 * Solo aparece para quien puede tener una: el superadministrador y los
 * administradores de oficina. Al resto no se le enseña, y —lo que de verdad
 * importa— la acción vuelve a comprobarlo en el servidor: esconder el bloque no
 * es un permiso.
 *
 * Quien ya tiene una escribe la de ahora. Quien no tiene ninguna la pone sin
 * más: ya entró con su código, que es lo mismo que le pediríamos para
 * recuperarla.
 */
export function PasswordSection({
  hasPassword,
  minLength,
  result,
  dictionary,
  locale,
}: {
  hasPassword: boolean;
  minLength: number;
  /** Cómo fue el último intento: `ok`, `mismatch`, `tooShort`… */
  result?: string;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.admin.profile.password;
  const errors = copy.errors as Record<string, string>;

  return (
    <section className="flex max-w-xl flex-col gap-5 border-t border-[#ddd6c6] pt-8">
      <div className="flex flex-col gap-2">
        <h2 className={`${displayFont(locale)} text-2xl`}>{copy.title}</h2>
        <p className="text-sm text-[#6a6456]">{hasPassword ? copy.intro : copy.introNone}</p>
      </div>

      {result === 'ok' ? (
        <p className="text-sm text-[#2f6b3a]">{copy.saved}</p>
      ) : result === undefined ? null : (
        <p role="alert" className="text-sm text-[#8c2f1e]">
          {errors[result] ?? errors['generic']}
        </p>
      )}

      <form action={changePasswordAction} className="flex flex-col gap-5">
        {hasPassword ? (
          <Field label={copy.current}>
            <input
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              required
              className={FIELD_CLASS}
              dir="ltr"
            />
          </Field>
        ) : null}

        <Field label={copy.next} hint={interpolate(copy.rule, { n: String(minLength) })}>
          <input
            type="password"
            name="newPassword"
            autoComplete="new-password"
            minLength={minLength}
            required
            className={FIELD_CLASS}
            dir="ltr"
          />
        </Field>

        <Field label={copy.repeat}>
          <input
            type="password"
            name="repeatPassword"
            autoComplete="new-password"
            minLength={minLength}
            required
            className={FIELD_CLASS}
            dir="ltr"
          />
        </Field>

        <button
          type="submit"
          className="self-start border border-[#23201a] px-5 py-2.5 text-sm hover:opacity-70"
        >
          {hasPassword ? copy.change : copy.set}
        </button>
      </form>
    </section>
  );
}
