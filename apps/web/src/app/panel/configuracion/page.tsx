import { redirect } from 'next/navigation';

import { saveConfigAction } from '@/app/panel/configuracion/actions';
import { probePaymentsAction, sendTestMailAction } from '@/app/panel/sistema/actions';
import { SecretField, SettingField } from '@/components/panel/SettingField';
import { getAdminContext } from '@/lib/admin/context';
import { getSession, sessionCan } from '@/lib/auth/session';
import { origin, secret, setting, type SecretKey, type SettingKey } from '@/lib/settings';
import { displayFont } from '@/lib/typography';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ guardado?: string; pago?: string; motivo?: string; mail?: string; reason?: string }>;
}

const BOTON = 'bg-[#23201a] px-6 py-3 text-base text-[#f4efe6] hover:opacity-90';
const BOTON_SUAVE = 'border border-[#23201a] px-5 py-2.5 text-sm text-[#23201a] hover:opacity-70';

/**
 * La configuración del sistema, sin tocar el servidor.
 *
 * Restringida a la cuenta de la plataforma, y con razón: estos campos deciden a
 * qué servidor de correo se manda y a qué cuenta de comercio va el dinero. Cada
 * cambio queda registrado con su autor.
 *
 * Las contraseñas se guardan cifradas con una llave que NO está en la base de
 * datos, y esta pantalla no las devuelve nunca: se reemplazan, no se leen.
 */
export default async function ConfigPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'platform:manage')) redirect('/panel');

  const { guardado, pago, motivo, mail, reason } = await searchParams;
  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.config;

  const campo = async (key: SettingKey) => ({
    name: key,
    label: copy.labels[key],
    value: (await setting(key)) ?? '',
    origin: await origin(key),
  });
  const clave = async (key: SecretKey) => ({
    name: key,
    label: copy.labels[key],
    isSet: (await secret(key).catch(() => undefined)) !== undefined,
  });

  const [mailer, host, port, user, from, provider, base, channel, website, siteUrl] =
    await Promise.all([
      campo('MAILER'),
      campo('SMTP_HOST'),
      campo('SMTP_PORT'),
      campo('SMTP_USER'),
      campo('MAIL_FROM'),
      campo('PAYMENTS_PROVIDER'),
      campo('WHISH_BASE_URL'),
      campo('WHISH_CHANNEL'),
      campo('WHISH_WEBSITE_URL'),
      campo('NEXT_PUBLIC_SITE_URL'),
    ]);
  const [smtpPass, whishSecret] = await Promise.all([clave('SMTP_PASSWORD'), clave('WHISH_SECRET')]);

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className={`${displayFont(locale)} text-3xl`}>{copy.title}</h1>
        <p className="max-w-2xl text-sm text-[#6a6456]">{copy.intro}</p>
      </header>

      {guardado === '1' ? <p className="text-sm text-[#2f6b3a]">{copy.saved}</p> : null}

      <form action={saveConfigAction} className="flex max-w-2xl flex-col gap-8">
        <section className="flex flex-col gap-4">
          <h2 className={`${displayFont(locale)} text-xl`}>{copy.mail}</h2>
          <SettingField {...mailer} dictionary={dictionary} />
          <SettingField {...host} dictionary={dictionary} />
          <SettingField {...port} dictionary={dictionary} />
          <SettingField {...user} dictionary={dictionary} />
          <SettingField {...from} dictionary={dictionary} />
          <SecretField {...smtpPass} dictionary={dictionary} />
        </section>

        <section className="flex flex-col gap-4 border-t border-[#ddd6c6] pt-6">
          <h2 className={`${displayFont(locale)} text-xl`}>{copy.payments}</h2>
          <SettingField {...provider} dictionary={dictionary} />
          <SettingField {...base} dictionary={dictionary} />
          <SettingField {...channel} dictionary={dictionary} />
          <SettingField {...website} dictionary={dictionary} />
          <SecretField {...whishSecret} dictionary={dictionary} />
        </section>

        <section className="flex flex-col gap-4 border-t border-[#ddd6c6] pt-6">
          <h2 className={`${displayFont(locale)} text-xl`}>{copy.site}</h2>
          <SettingField {...siteUrl} dictionary={dictionary} />
        </section>

        <button type="submit" className={BOTON}>
          {copy.save}
        </button>
      </form>

      <section className="flex max-w-2xl flex-col gap-4 border-t border-[#ddd6c6] pt-6">
        {/* Comprobar es parte de configurar: guardar unas credenciales sin poder
            saber si valen deja el mismo silencio que habia antes. */}
        {mail === 'ok' || mail === 'failed' ? (
          <p className={`text-sm ${mail === 'ok' ? 'text-[#2f6b3a]' : 'text-[#8c2f1e]'}`}>
            {mail === 'ok' ? dictionary.admin.system.mail.ok : dictionary.admin.system.mail.failed}{' '}
            <span className="font-mono text-xs" dir="ltr">
              {reason ?? ''}
            </span>
          </p>
        ) : null}
        {pago === 'ok' || pago === 'failed' ? (
          <p className={`text-sm ${pago === 'ok' ? 'text-[#2f6b3a]' : 'text-[#8c2f1e]'}`}>
            {pago === 'ok' ? copy.probeOk : copy.probeFailed}{' '}
            <span className="font-mono text-xs" dir="ltr">
              {motivo ?? ''}
            </span>
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <form action={sendTestMailAction}>
            <button type="submit" className={BOTON_SUAVE}>
              {copy.testMail}
            </button>
          </form>
          <form action={probePaymentsAction}>
            <button type="submit" className={BOTON_SUAVE}>
              {copy.testPayments}
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
