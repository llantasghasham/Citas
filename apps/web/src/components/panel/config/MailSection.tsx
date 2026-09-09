import { SecretField, SettingField, type SecretProps, type SettingProps } from '@/components/panel/SettingField';
import type { Dictionary } from '@/lib/types';

/** Por dónde salen los códigos de acceso. Sin esto, nadie entra con código. */
export function MailSection({
  action,
  fields,
  password,
  dictionary,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: SettingProps[];
  password: SecretProps;
  dictionary: Dictionary;
}) {
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      <input type="hidden" name="sector" value="mail" />
      {fields.map((field) => (
        <SettingField key={field.name} {...field} dictionary={dictionary} />
      ))}
      <SecretField {...password} dictionary={dictionary} />
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
