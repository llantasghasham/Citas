import { SaveButton } from '@/components/panel/config/MailSection';
import { SettingField, type SettingProps } from '@/components/panel/SettingField';
import type { ResolvedSite } from '@/lib/home/site';
import { displayFont } from '@/lib/typography';
import { interpolate, type Dictionary, type Locale } from '@/lib/types';

/**
 * Cómo se llama esto y con qué se ve.
 *
 * El logo y el icono se SUBEN. Antes se pedían como dirección de imagen, y eso
 * es pedirle a quien monta su negocio algo que no tiene: nadie tiene una URL de
 * su logo, tiene un archivo en el ordenador. Y una dirección de fuera es además
 * una dependencia que se rompe sola el día que caduque ese alojamiento.
 *
 * El servidor los reajusta y los guarda: el logo conserva su forma —recortar un
 * logo apaisado a cuadrado es destrozarlo— y el icono sí sale cuadrado, porque
 * una pestaña lo es.
 */
export function BrandSection({
  action,
  fields,
  urlFields,
  site,
  problem,
  maxMb,
  dictionary,
  locale,
}: {
  action: (formData: FormData) => Promise<void>;
  /** Solo el nombre. Las dos direcciones van plegadas, como alternativa. */
  fields: SettingProps[];
  urlFields: SettingProps[];
  site: ResolvedSite;
  /** Qué falló al subir: `tooBig` o `notAnImage`. */
  problem?: string;
  maxMb: number;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const copy = dictionary.admin.config;

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-6">
      <input type="hidden" name="sector" value="brand" />

      {problem === undefined ? null : (
        <p role="alert" className="text-sm text-[#8c2f1e]">
          {problem === 'tooBig'
            ? interpolate(copy.brandTooBig, { mb: String(maxMb) })
            : copy.brandNotAnImage}
        </p>
      )}

      {/* Lo que se está configurando, dibujado igual que sale en la cabecera:
          un logo mal recortado se ve aquí y no en producción. */}
      <div className="flex items-center gap-4 border border-[#ddd6c6] bg-[#14120E] px-5 py-4">
        {site.logoUrl === null ? null : (
          // eslint-disable-next-line @next/next/no-img-element -- o son bytes
          // que sirve este mismo proceso, o una dirección de fuera: ninguna de
          // las dos pasa por el optimizador de Next.
          <img src={site.logoUrl} alt="" referrerPolicy="no-referrer" className="max-h-10 w-auto" />
        )}
        <span className={`${displayFont(locale)} text-xl text-[#F4EFE6]`}>{site.brand}</span>
        <span className="ms-auto text-xs text-[#786F5D]">{copy.brandPreview}</span>
      </div>

      {fields.map((field) => (
        <SettingField key={field.name} {...field} dictionary={dictionary} />
      ))}

      <BrandUpload
        kind="logo"
        label={copy.brandLogo}
        hint={interpolate(copy.brandLogoHint, { mb: String(maxMb) })}
        current={site.logoUrl}
        dark
        copy={copy}
      />
      <BrandUpload
        kind="icon"
        label={copy.brandIcon}
        hint={interpolate(copy.brandIconHint, { mb: String(maxMb) })}
        current={site.iconUrl}
        copy={copy}
      />

      {/* Las dos direcciones siguen aquí, plegadas. No es la forma de poner un
          logo —para eso está el archivo— pero hay instalaciones que ya tienen
          una puesta, y sin este campo no habría manera de quitarla. */}
      <details className="border-t border-[#ddd6c6] pt-5">
        <summary className="cursor-pointer text-sm text-[#6a6456] hover:text-[#23201a]">
          {copy.brandByUrl}
        </summary>
        <div className="mt-5 flex flex-col gap-5">
          {urlFields.map((field) => (
            <SettingField key={field.name} {...field} dictionary={dictionary} />
          ))}
        </div>
      </details>

      <SaveButton dictionary={dictionary} />
    </form>
  );
}

/**
 * Una imagen de la marca: la que hay, el archivo nuevo y la casilla de quitar.
 *
 * El logo se enseña sobre fondo oscuro porque es donde va a vivir. Un logo con
 * fondo blanco pegado sobre la cabecera del panel se ve aquí, que es donde
 * todavía tiene arreglo.
 */
function BrandUpload({
  kind,
  label,
  hint,
  current,
  dark = false,
  copy,
}: {
  kind: 'logo' | 'icon';
  label: string;
  hint: string;
  current: string | null;
  dark?: boolean;
  copy: Dictionary['admin']['config'];
}) {
  return (
    <div className="flex flex-wrap items-start gap-5 border-t border-[#ddd6c6] pt-6">
      <div
        className={`grid size-20 shrink-0 place-items-center border border-[#ddd6c6] ${
          dark ? 'bg-[#14120E]' : 'bg-white'
        }`}
      >
        {current === null ? (
          <span aria-hidden className={`text-2xl ${dark ? 'text-[#3d372c]' : 'text-[#ddd6c6]'}`}>
            &#9633;
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- ver arriba.
          <img
            src={current}
            alt=""
            referrerPolicy="no-referrer"
            className="max-h-16 max-w-16 object-contain"
          />
        )}
      </div>

      <div className="flex min-w-60 flex-1 flex-col gap-3">
        {/* El nombre y la explicación, en dos líneas. En una sola separadas por
            un punto, la explicación —que es lo largo— empujaba el nombre fuera
            de la vista en cuanto la ventana se estrechaba. */}
        <label className="flex cursor-pointer flex-col gap-1">
          <span className="text-sm font-medium text-[#23201a]">{label}</span>
          <span className="text-xs leading-relaxed text-[#6a6456]">{hint}</span>
          {/* `image/*` a secas: enumerar `image/heic` haría que un iPhone
              mandara el HEIC tal cual, y el descodificador de este servidor no
              trae HEVC. Sin enumerarlo, iOS lo convierte al enviarlo. */}
          <input type="file" name={kind} accept="image/*" className="file-field mt-1" />
        </label>

        {current === null ? null : (
          <label className="flex items-center gap-2 text-sm text-[#8c2f1e]">
            <input type="checkbox" name={`remove-${kind}`} value="1" />
            {copy.brandRemove}
          </label>
        )}
      </div>
    </div>
  );
}
