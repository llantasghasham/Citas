import { saveRolesAction } from '@/app/panel/configuracion/roles-actions';
import type { Role } from '@/generated/prisma/enums';
import type { Capability } from '@/lib/auth/permissions';
import { GRANTABLE, NEVER_GRANTABLE } from '@/lib/auth/role-config';
import { displayFont } from '@/lib/typography';
import type { Dictionary, Locale } from '@/lib/types';

export interface RoleRow {
  role: Role;
  /** Lo que puede hoy. */
  capabilities: readonly Capability[];
  /** True cuando alguien lo cambió aquí; false si es lo de fábrica. */
  customised: boolean;
  /** SUPERADMIN no se edita: es el candado. */
  editable: boolean;
}

/**
 * El reparto de permisos, escrito y editable.
 *
 * Antes vivía solo en un archivo de código, así que quien administra el sistema
 * no tenía forma de saber qué estaba concediendo al elegir un rol para alguien.
 * Ahora se ve, con la frase entera de lo que cada permiso permite.
 *
 * Dos casillas no existen, y no por descuido:
 *
 * - **SUPERADMIN** entero. Recortarle permisos al único rol que puede volver a
 *   ampliarlos es cerrarse la puerta desde dentro.
 * - **`platform:manage`**, en cualquier rol. Abre la configuración de todas las
 *   oficinas, el correo y el cobro. Si se pudiera conceder, un administrador de
 *   oficina se lo concedería a su propio rol.
 */
export function RolesSection({
  roles,
  dictionary,
  locale,
}: {
  roles: RoleRow[];
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.admin.config.roles;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <p className="border border-[#c9a227] bg-[#fdf9ef] p-4 text-sm text-[#8a6c22]">
        {copy.neverGrantable}
      </p>

      {roles.map((row) => (
        <form
          key={row.role}
          action={saveRolesAction}
          className="flex flex-col gap-3 border border-[#ddd6c6] bg-white/60 p-5"
        >
          <input type="hidden" name="role" value={row.role} />

          <div className="flex flex-wrap items-baseline gap-x-4">
            <h2 className={`${displayFont(locale)} text-lg`}>
              {dictionary.admin.roles[row.role]}
            </h2>
            <span className="text-xs text-[#6a6456]">
              {!row.editable ? copy.fixed : row.customised ? copy.custom : null}
            </span>
          </div>

          <ul className="flex flex-col gap-2">
            {[...GRANTABLE, ...NEVER_GRANTABLE].map((capability) => {
              const blocked = NEVER_GRANTABLE.includes(capability);
              const held = row.capabilities.includes(capability);

              return (
                <li key={capability}>
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      name="capability"
                      value={capability}
                      defaultChecked={held}
                      // El permiso de plataforma se enseña para que se sepa que
                      // existe y quién lo tiene, y no se deja tocar.
                      disabled={!row.editable || blocked}
                      className="mt-1"
                    />
                    <span className={row.editable && !blocked ? '' : 'opacity-60'}>
                      {copy.capability[capability]}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {row.editable ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                className="border border-[#23201a] px-5 py-2 text-sm hover:opacity-70"
              >
                {dictionary.admin.config.save}
              </button>
              {row.customised ? (
                <button
                  type="submit"
                  name="reset"
                  value="1"
                  className="text-sm underline text-[#6a6456]"
                >
                  {copy.reset}
                </button>
              ) : null}
            </div>
          ) : null}
        </form>
      ))}
    </div>
  );
}
