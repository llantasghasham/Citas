import { redirect } from 'next/navigation';

import { saveConfigAction } from '@/app/panel/configuracion/actions';
import { probePaymentsAction, sendTestMailAction } from '@/app/panel/sistema/actions';
import { BrandSection } from '@/components/panel/config/BrandSection';
import { ConfigNav } from '@/components/panel/config/ConfigNav';
import { HomeSection } from '@/components/panel/config/HomeSection';
import { MailSection } from '@/components/panel/config/MailSection';
import { PaymentsSection } from '@/components/panel/config/PaymentsSection';
import { SiteSection } from '@/components/panel/config/SiteSection';
import { getAdminContext } from '@/lib/admin/context';
import { getSession, sessionCan } from '@/lib/auth/session';
import { loadSite } from '@/lib/home/site';
import { origin, secret, setting, type SecretKey, type SettingKey } from '@/lib/settings';
import { homeTexts, isLocale } from '@/lib/settings/home';
import { displayFont } from '@/lib/typography';
import { CONFIG_SECTIONS, type ConfigSection } from '@citas/core';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    s?: string;
    idioma?: string;
    guardado?: string;
    pago?: string;
    motivo?: string;
    mail?: string;
    reason?: string;
  }>;
}

const BOTON_SUAVE = 'border border-[#23201a] px-5 py-2.5 text-sm text-[#23201a] hover:opacity-70';

/**
 * La configuración del sistema, por sectores.
 *
 * Un solo formulario con veinte campos obliga a leerlos todos para cambiar uno.
 * Cada sector es su propia pantalla y su propio formulario, y guardar uno no
 * toca los demás: la acción solo escribe las claves que vienen en el envío.
 *
 * Restringida a la cuenta de la plataforma, y con razón: estos campos deciden a
 * qué servidor de correo se manda y a qué cuenta de comercio va el dinero. Cada
 * cambio queda registrado con su autor, y jamás con el valor de una contraseña.
 */
export default async function ConfigPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'platform:manage')) redirect('/panel');

  const params = await searchParams;
  const { dictionary, locale } = await getAdminContext(session.tenantId);
  const copy = dictionary.admin.config;

  const section: ConfigSection =
    CONFIG_SECTIONS.find((candidate) => candidate === params.s) ?? 'mail';

  // Un campo, con su valor de hoy y de dónde salió.
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

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className={`${displayFont(locale)} text-3xl`}>{copy.title}</h1>
        <p className="max-w-2xl text-sm text-[#6a6456]">{copy.intro}</p>
      </header>

      <ConfigNav current={section} dictionary={dictionary} locale={locale} />

      <p className="max-w-2xl text-sm text-[#6a6456]">{copy.sectionIntros[section]}</p>
      {params.guardado === '1' ? <p className="text-sm text-[#2f6b3a]">{copy.saved}</p> : null}

      {section === 'mail' ? (
        <MailSection
          action={saveConfigAction}
          fields={await Promise.all([
            campo('MAILER'),
            campo('SMTP_HOST'),
            campo('SMTP_PORT'),
            campo('SMTP_USER'),
            campo('MAIL_FROM'),
          ])}
          password={await clave('SMTP_PASSWORD')}
          dictionary={dictionary}
        />
      ) : null}

      {section === 'payments' ? (
        <PaymentsSection
          action={saveConfigAction}
          enabled={(await setting('PAYMENT_METHODS')) ?? 'whish'}
          whish={await Promise.all([
            campo('PAYMENTS_PROVIDER'),
            campo('WHISH_BASE_URL'),
            campo('WHISH_CHANNEL'),
            campo('WHISH_WEBSITE_URL'),
          ])}
          whishSecret={await clave('WHISH_SECRET')}
          cash={await campo('CASH_INSTRUCTIONS')}
          tilopay={await Promise.all([
            campo('TILOPAY_BASE_URL'),
            campo('TILOPAY_API_USER'),
            campo('TILOPAY_API_KEY'),
          ])}
          tilopayPassword={await clave('TILOPAY_PASSWORD')}
          dictionary={dictionary}
          locale={locale}
        />
      ) : null}

      {section === 'brand' ? (
        <BrandSection
          action={saveConfigAction}
          fields={await Promise.all([
            campo('BRAND_NAME'),
            campo('BRAND_LOGO_URL'),
            campo('BRAND_ICON_URL'),
          ])}
          site={await loadSite()}
          dictionary={dictionary}
          locale={locale}
        />
      ) : null}

      {section === 'home' ? (
        <HomeSection
          editing={isLocale(params.idioma ?? '') ? (params.idioma as never) : locale}
          texts={await homeTexts(isLocale(params.idioma ?? '') ? (params.idioma as never) : locale)}
          sections={await campo('HOME_SECTIONS')}
          showcase={await campo('HOME_SHOWCASE')}
          defaultLocale={await campo('HOME_DEFAULT_LOCALE')}
          dictionary={dictionary}
          locale={locale}
        />
      ) : null}

      {section === 'site' ? (
        <SiteSection
          action={saveConfigAction}
          fields={await Promise.all([
            campo('NEXT_PUBLIC_SITE_URL'),
            campo('CONTACT_WHATSAPP'),
            campo('CONTACT_EMAIL'),
          ])}
          dictionary={dictionary}
        />
      ) : null}

      {/* Comprobar es parte de configurar: guardar unas credenciales sin poder
          saber si valen deja el mismo silencio que había antes. */}
      {section === 'mail' || section === 'payments' ? (
        <section className="flex max-w-2xl flex-col gap-4 border-t border-[#ddd6c6] pt-6">
          {params.mail === 'ok' || params.mail === 'failed' ? (
            <p className={`text-sm ${params.mail === 'ok' ? 'text-[#2f6b3a]' : 'text-[#8c2f1e]'}`}>
              {params.mail === 'ok'
                ? dictionary.admin.system.mail.ok
                : dictionary.admin.system.mail.failed}{' '}
              <span className="font-mono text-xs" dir="ltr">
                {params.reason ?? ''}
              </span>
            </p>
          ) : null}
          {params.pago === 'ok' || params.pago === 'failed' ? (
            <p className={`text-sm ${params.pago === 'ok' ? 'text-[#2f6b3a]' : 'text-[#8c2f1e]'}`}>
              {params.pago === 'ok' ? copy.probeOk : copy.probeFailed}{' '}
              <span className="font-mono text-xs" dir="ltr">
                {params.motivo ?? ''}
              </span>
            </p>
          ) : null}

          <form action={section === 'mail' ? sendTestMailAction : probePaymentsAction}>
            <button type="submit" className={BOTON_SUAVE}>
              {section === 'mail' ? copy.testMail : copy.testPayments}
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
