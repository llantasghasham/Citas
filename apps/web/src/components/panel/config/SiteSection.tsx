import { SaveButton } from '@/components/panel/config/MailSection';
import { SettingField, type SettingProps } from '@/components/panel/SettingField';
import type { Dictionary } from '@/lib/types';

/**
 * La dirección pública y el contacto del pie.
 *
 * Un contacto sin poner NO sale en la portada: un número inventado en un sitio
 * en producción es peor que ninguno.
 */
export function SiteSection({
  action,
  fields,
  dictionary,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: SettingProps[];
  dictionary: Dictionary;
}) {
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      <input type="hidden" name="sector" value="site" />
      {fields.map((field) => (
        <SettingField key={field.name} {...field} dictionary={dictionary} />
      ))}
      <SaveButton dictionary={dictionary} />
    </form>
  );
}
