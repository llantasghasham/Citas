import { SaveButton } from '@/components/panel/config/MailSection';
import { SettingField, type SettingProps } from '@/components/panel/SettingField';
import type { ResolvedSite } from '@/lib/home/site';
import { displayFont } from '@/lib/typography';
import type { Dictionary, Locale } from '@/lib/types';

/**
 * Cómo se llama esto y con qué se ve.
 *
 * El logo y el icono se dan por dirección y no se suben aquí a propósito: subir
 * archivos es otra cosa —permisos, tamaño, tipo, almacenamiento— y meterla de
 * refilón en la pantalla de configuración es como se cuela una carga de
 * archivos sin límite de tamaño. La dirección funciona hoy con cualquier CDN o
 * con un archivo en `public/`.
 */
export function BrandSection({
  action,
  fields,
  site,
  dictionary,
  locale,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: SettingProps[];
  site: ResolvedSite;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.admin.config;

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      <input type="hidden" name="sector" value="brand" />

      {/* Lo que se está configurando, dibujado igual que sale en la cabecera:
          un logo mal recortado se ve aquí y no en producción. */}
      <div className="flex items-center gap-4 border border-[#ddd6c6] bg-[#14120E] px-5 py-4">
        {site.logoUrl === null ? null : (
          // eslint-disable-next-line @next/next/no-img-element -- una dirección
          // que escribe el operador, de cualquier origen: no pasa por el
          // optimizador de Next, que solo sirve orígenes declarados.
          <img src={site.logoUrl} alt="" className="max-h-10 w-auto" />
        )}
        <span className={`${displayFont(locale)} text-xl text-[#F4EFE6]`}>{site.brand}</span>
        <span className="ms-auto text-xs text-[#786F5D]">{copy.brandPreview}</span>
      </div>

      {fields.map((field) => (
        <SettingField key={field.name} {...field} dictionary={dictionary} />
      ))}
      <SaveButton dictionary={dictionary} />
    </form>
  );
}
