import { SaveButton } from '@/components/panel/config/MailSection';
import {
  SecretField,
  SettingField,
  type SecretProps,
  type SettingProps,
} from '@/components/panel/SettingField';
import { FIELD_CLASS } from '@/components/create/Field';
import { displayFont } from '@/lib/typography';
import { PAYMENT_METHODS, type Dictionary, type Locale, type PaymentMethod } from '@citas/core';

/**
 * Los medios que hoy pueden encenderse.
 *
 * `sinpe` sí: no es una pasarela —no hay credenciales que pedirle a nadie—,
 * sino leer el correo del banco, y eso se configura en su propia pantalla.
 * Tilopay sigue apagado: espera su especificación y sus credenciales.
 */
const READY: Record<PaymentMethod, boolean> = {
  whish: true,
  cash: true,
  sinpe: true,
  tilopay: false,
};

interface Props {
  action: (formData: FormData) => Promise<void>;
  /** Lo guardado, en la lista separada por comas que se guarda. */
  enabled: string;
  whish: SettingProps[];
  whishSecret: SecretProps;
  cash: SettingProps;
  tilopay: SettingProps[];
  tilopayPassword: SecretProps;
  dictionary: Dictionary;
  locale: Locale;
}

/**
 * Cómo se cobra, y con qué credenciales.
 *
 * Tres medios, y no son tres pasarelas: el efectivo NO tiene pasarela. Es que
 * alguien de la oficina recibe el dinero, así que lo marca una persona con su
 * nombre y queda en el historial. Por eso la regla del proyecto —solo la
 * respuesta del proveedor marca pagada una factura— sigue intacta: donde hay
 * proveedor, decide el proveedor; donde no lo hay, decide una persona nombrada,
 * nunca el navegador de quien paga.
 *
 * Tilopay (SINPE Móvil, Costa Rica) aparece pero no puede encenderse: no hay
 * credenciales ni especificación. Se ve para que se sepa que está previsto, y
 * no se activa para que nadie crea que cobra.
 */
export function PaymentsSection({
  action,
  enabled,
  whish,
  whishSecret,
  cash,
  tilopay,
  tilopayPassword,
  dictionary,
  locale,
}: Props) {
  const copy = dictionary.admin.config;
  const chosen = new Set(enabled.split(',').map((entry) => entry.trim()));

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-8">
      <input type="hidden" name="sector" value="payments" />

      <fieldset className="flex flex-col gap-3">
        <legend className={`${displayFont(locale)} text-xl`}>{copy.methods.heading}</legend>
        <p className="text-sm text-[#6a6456]">{copy.methodsHint}</p>

        {PAYMENT_METHODS.map((method) => (
          <label key={method} className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="method"
              value={method}
              defaultChecked={chosen.has(method)}
              disabled={!READY[method]}
              className="mt-1"
            />
            <span className={READY[method] ? '' : 'opacity-50'}>
              {copy.methods[method]}
              {READY[method] ? null : (
                <span className="block text-xs text-[#8c2f1e]">{copy.tilopayPending}</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      <section className="flex flex-col gap-5 border-t border-[#ddd6c6] pt-6">
        <h2 className={`${displayFont(locale)} text-lg`}>{copy.methods.whish}</h2>
        {whish.map((field) => (
          <SettingField key={field.name} {...field} dictionary={dictionary} />
        ))}
        <SecretField {...whishSecret} dictionary={dictionary} />
      </section>

      <section className="flex flex-col gap-5 border-t border-[#ddd6c6] pt-6">
        <h2 className={`${displayFont(locale)} text-lg`}>{copy.methods.cash}</h2>
        {/* Un texto largo: es lo que lee quien va a pasar por la oficina, y
            tiene que caber una dirección y un horario. */}
        <label className="flex flex-col gap-2 text-sm text-[#23201a]">
          <span>{cash.label}</span>
          <textarea
            name={cash.name}
            defaultValue={cash.value}
            rows={3}
            className={FIELD_CLASS}
          />
        </label>
      </section>

      <section className="flex flex-col gap-5 border-t border-[#ddd6c6] pt-6">
        <h2 className={`${displayFont(locale)} text-lg`}>{copy.methods.tilopay}</h2>
        {tilopay.map((field) => (
          <SettingField key={field.name} {...field} dictionary={dictionary} />
        ))}
        <SecretField {...tilopayPassword} dictionary={dictionary} />
      </section>

      <SaveButton dictionary={dictionary} />
    </form>
  );
}
