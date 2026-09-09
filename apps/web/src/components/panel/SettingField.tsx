import { FIELD_CLASS } from '@/components/create/Field';
import type { Dictionary } from '@/lib/types';

type Origin = 'panel' | 'entorno' | 'nada';

/** Lo que la pantalla necesita saber de un ajuste para dibujarlo. */
export interface SettingProps {
  name: string;
  label: string;
  value: string;
  origin: Origin;
}

/** Lo mismo para una contraseña, que se escribe pero no se lee. */
export interface SecretProps {
  name: string;
  label: string;
  isSet: boolean;
}

/**
 * Un ajuste, con su valor y de dónde salió.
 *
 * Decir el origen no es un adorno: mientras queden instalaciones con variables
 * en el servidor, «viene del servidor» explica por qué el campo tiene un valor
 * que nadie escribió aquí, y que guardar lo reemplaza.
 */
export function SettingField({
  name,
  label,
  value,
  origin,
  dictionary,
  type = 'text',
}: SettingProps & { dictionary: Dictionary; type?: string }) {
  const copy = dictionary.admin.config;
  const marca =
    origin === 'panel' ? copy.fromPanel : origin === 'entorno' ? copy.fromEnv : copy.missing;

  return (
    <label className="flex flex-col gap-2 text-sm text-[#23201a]">
      <span>
        {label}
        <span className="opacity-60"> · {marca}</span>
      </span>
      <input
        className={FIELD_CLASS}
        type={type}
        name={name}
        defaultValue={value}
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}

/**
 * Una contraseña. Se escribe, nunca se lee: el campo sale vacío aunque haya una
 * guardada, y dejarlo vacío significa «déjala como está».
 */
export function SecretField({
  name,
  label,
  isSet,
  dictionary,
}: SecretProps & { dictionary: Dictionary }) {
  const copy = dictionary.admin.config;

  return (
    <label className="flex flex-col gap-2 text-sm text-[#23201a]">
      <span>
        {label}
        <span className={isSet ? 'text-[#2f6b3a]' : 'text-[#8c2f1e]'}>
          {' · '}
          {isSet ? copy.secretSet : copy.secretUnset}
        </span>
      </span>
      <input
        className={FIELD_CLASS}
        type="password"
        name={name}
        defaultValue=""
        dir="ltr"
        autoComplete="new-password"
      />
      <span className="text-xs text-[#6a6456]">{copy.secretHint}</span>
    </label>
  );
}
