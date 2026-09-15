import { SecretField, SettingField, type SecretProps, type SettingProps } from '@/components/panel/SettingField';
import type { Dictionary } from '@/lib/types';

/**
 * Por dónde salen los códigos de acceso. Sin esto, nadie entra con código.
 *
 * Las contraseñas son VARIAS porque hay dos emisores: el servidor de correo de
 * siempre y la API de Resend. Se enseñan las dos a la vez, cada una diciendo en
 * su pista a cuál pertenece, y no se esconde la que no se usa: esta pantalla no
 * lleva JavaScript de cliente, así que esconderla exigiría recargar la página
 * para cambiar de emisor — y un campo que aparece y desaparece solo es peor de
 * entender que dos campos con su nombre al lado.
 */
export function MailSection({
  action,
  fields,
  secrets,
  dictionary,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: SettingProps[];
  secrets: SecretProps[];
  dictionary: Dictionary;
}) {
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      <input type="hidden" name="sector" value="mail" />
      {fields.map((field) => (
        <SettingField key={field.name} {...field} dictionary={dictionary} />
      ))}
      {secrets.map((one) => (
        <SecretField key={one.name} {...one} dictionary={dictionary} />
      ))}
      <SaveButton dictionary={dictionary} />
    </form>
  );
}

export function SaveButton({ dictionary }: { dictionary: Dictionary }) {
  return (
    <button
      type="submit"
      className="self-start bg-[#23201a] px-6 py-3 text-base text-[#f4efe6] hover:opacity-90"
    >
      {dictionary.admin.config.save}
    </button>
  );
}
