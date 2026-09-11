import { cache } from 'react';

import { getPrisma } from '@/lib/db/client';
import { decryptSecret, encryptSecret } from '@/lib/secrets';

/**
 * La configuración del sistema, editable desde el panel.
 *
 * Nada de esto vive en el `.env`: quien administra la plataforma tiene que
 * poder cambiar el correo o la pasarela sin entrar al servidor por SSH. Lo que
 * no cambia es la regla de los secretos — una contraseña se guarda cifrada con
 * la llave de `CITAS_SECRET_KEY_FILE`, que sigue FUERA de la base de datos, así
 * que un volcado no revela ni el SMTP ni el cobro.
 *
 * El entorno se sigue leyendo como RESPALDO, y solo como respaldo: una
 * instalación que ya tenía sus variables puestas no se cae el día que se
 * despliega esto, y lo que se guarde en el panel manda a partir de entonces.
 */
export const SETTING_KEYS = [
  // Correo saliente
  'MAILER',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'MAIL_FROM',
  // Cobro. `PAYMENT_METHODS` es la lista separada por comas de lo que se
  // acepta; `PAYMENTS_PROVIDER` es la pasarela que atiende un cobro en línea.
  'PAYMENT_METHODS',
  'PAYMENTS_PROVIDER',
  'WHISH_BASE_URL',
  'WHISH_CHANNEL',
  'WHISH_WEBSITE_URL',
  'CASH_INSTRUCTIONS',
  // SINPE Móvil. No hay credenciales de pasarela —no hay pasarela— pero sí dos
  // cosas que no puede adivinar el código: a qué número se le hace el SINPE, y
  // a cuántos colones sale el dólar con el que están escritos los planes.
  'SINPE_PHONE',
  'CRC_PER_USD',
  'TILOPAY_BASE_URL',
  'TILOPAY_API_USER',
  'TILOPAY_API_KEY',
  // Marca: cómo se llama esto y con qué se ve.
  'BRAND_NAME',
  'BRAND_LOGO_URL',
  'BRAND_ICON_URL',
  'CONTACT_WHATSAPP',
  'CONTACT_EMAIL',
  // La portada: qué bloques salen y qué invitaciones enseña.
  'HOME_SECTIONS',
  'HOME_SHOWCASE',
  'HOME_DEFAULT_LOCALE',
  // WhatsApp. El TOKEN no está aquí: lo comparten dos procesos que arrancan
  // por separado, así que va por entorno en los dos.
  'WHATSAPP_GATEWAY_URL',
  // El freno. Se ajusta desde la pantalla porque es lo que el dueño va a querer
  // tocar cuando un número vaya apretado, y la regla es que eso no exija SSH.
  // El servicio los relee cada minuto, así que no hay que reiniciarlo.
  'WHATSAPP_DELAY_MIN',
  'WHATSAPP_DELAY_MAX',
  'WHATSAPP_WARMUP_CAP',
  // El sitio
  'NEXT_PUBLIC_SITE_URL',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** Las que son contraseñas. Se guardan cifradas y no se devuelven nunca. */
export const SECRET_KEYS = ['SMTP_PASSWORD', 'WHISH_SECRET', 'TILOPAY_PASSWORD'] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

/** Todo lo guardado, en una sola consulta por petición. */
const loadAll = cache(
  async (): Promise<Map<string, { value: string | null; valueEnc: string | null }>> => {
    try {
      const rows = await getPrisma().setting.findMany();
      return new Map(rows.map((row) => [row.key, { value: row.value, valueEnc: row.valueEnc }]));
    } catch {
      // Sin base de datos —durante un build, por ejemplo— el entorno responde.
      return new Map();
    }
  },
);

/** Un ajuste que no es secreto. La base manda; el entorno es el respaldo. */
export async function setting(key: SettingKey): Promise<string | undefined> {
  const stored = (await loadAll()).get(key)?.value;
  if (stored !== null && stored !== undefined && stored.length > 0) return stored;

  const fromEnv = process.env[key];
  return fromEnv === undefined || fromEnv.length === 0 ? undefined : fromEnv;
}

/**
 * Una contraseña de servicio, descifrada en el momento de usarla.
 *
 * Del entorno se acepta `<NOMBRE>_ENC`, y `<NOMBRE>` en claro solo fuera de
 * producción: la regla de que en claro no se guarda una contraseña sigue en pie.
 */
export async function secret(key: SecretKey): Promise<string | undefined> {
  const stored = (await loadAll()).get(key)?.valueEnc;
  if (stored !== null && stored !== undefined && stored.length > 0) return decryptSecret(stored);

  const encrypted = process.env[`${key}_ENC`];
  if (encrypted !== undefined && encrypted.length > 0) {
    if (!encrypted.startsWith('v1.')) {
      throw new Error(
        `${key}_ENC no contiene un valor cifrado (tiene que empezar por "v1."). ` +
          'Parece la contraseña pegada en claro.',
      );
    }
    return decryptSecret(encrypted);
  }

  const plain = process.env[key];
  if (plain === undefined || plain.length === 0) return undefined;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${key} en claro no se permite en producción.`);
  }
  return plain;
}

/** De dónde salió cada ajuste, para que la pantalla no mienta sobre su origen. */
export async function origin(key: SettingKey | SecretKey): Promise<'panel' | 'entorno' | 'nada'> {
  const row = (await loadAll()).get(key);
  if (((row?.value ?? '') + (row?.valueEnc ?? '')).length > 0) return 'panel';
  if (((process.env[key] ?? '') + (process.env[`${key}_ENC`] ?? '')).length > 0) return 'entorno';
  return 'nada';
}

export async function saveSetting(key: SettingKey, value: string, actorId: string): Promise<void> {
  const clean = value.trim();
  await getPrisma().setting.upsert({
    where: { key },
    update: { value: clean.length === 0 ? null : clean, updatedBy: actorId },
    create: { key, value: clean.length === 0 ? null : clean, updatedBy: actorId },
  });
}

/**
 * Guarda una contraseña, cifrada. El valor en claro no se escribe en ningún
 * sitio: ni en la base, ni en el registro de auditoría, ni en un mensaje.
 */
export async function saveSecret(key: SecretKey, value: string, actorId: string): Promise<void> {
  const clean = value.trim();
  await getPrisma().setting.upsert({
    where: { key },
    update: { valueEnc: clean.length === 0 ? null : encryptSecret(clean), updatedBy: actorId },
    create: { key, valueEnc: clean.length === 0 ? null : encryptSecret(clean), updatedBy: actorId },
  });
}


/**
 * Ajustes de clave libre, para lo que no cabe en una lista fija.
 *
 * Hoy son los textos de la portada, que son un texto por idioma y por sitio
 * donde aparece: `home.hero.subtitle.ar`. Inventar una columna por cada uno
 * sería inventar cien columnas, y una lista fija de cien nombres no es una
 * lista, es un formulario disfrazado.
 *
 * Lo que NO se permite es que esto sirva para guardar un secreto: estas claves
 * se leen y se devuelven a la pantalla tal cual. Un secreto va por `saveSecret`.
 */
const RAW_PREFIXES = ['home.'] as const;

function checkRawKey(key: string): void {
  if (!RAW_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    throw new Error(`Clave de ajuste no permitida: "${key}".`);
  }
}

/** Todas las claves guardadas que empiezan por este prefijo. */
export async function settingsWithPrefix(prefix: string): Promise<Map<string, string>> {
  const all = await loadAll();
  const found = new Map<string, string>();
  for (const [key, row] of all) {
    if (key.startsWith(prefix) && row.value !== null && row.value.length > 0) {
      found.set(key, row.value);
    }
  }
  return found;
}

export async function saveRawSetting(key: string, value: string, actorId: string): Promise<void> {
  checkRawKey(key);
  const clean = value.trim();
  const prisma = getPrisma();

  // Vacío significa «vuelve al valor por defecto», así que la fila se borra en
  // vez de guardarse en blanco: una fila vacía y una ausente tienen que
  // significar lo mismo.
  if (clean.length === 0) {
    await prisma.setting.deleteMany({ where: { key } });
    return;
  }
  await prisma.setting.upsert({
    where: { key },
    update: { value: clean, updatedBy: actorId },
    create: { key, value: clean, updatedBy: actorId },
  });
}
