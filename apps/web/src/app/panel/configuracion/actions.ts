'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { clientIp } from '@/lib/admin/context';
import {
  BRAND_KINDS,
  deleteBrandAsset,
  isBrandProblem,
  processBrandImage,
  saveBrandAsset,
} from '@/lib/brand/assets';
import { recordAudit } from '@/lib/audit';
import { getSession, sessionCan } from '@/lib/auth/session';
import { resetTransporter } from '@/lib/mail/smtp';
import {
  saveRawSetting,
  saveSecret,
  saveSetting,
  SECRET_KEYS,
  SETTING_KEYS,
  type SecretKey,
  type SettingKey,
} from '@/lib/settings';
import { HOME_PREFIX, homePaths, isLocale } from '@/lib/settings/home';
import { PAYMENT_METHODS } from '@citas/core';

/**
 * Guarda la configuración del sistema.
 *
 * Solo la cuenta de la plataforma: estos campos deciden a qué servidor de
 * correo se manda y —más serio— a qué cuenta de comercio va el dinero. Cada
 * cambio queda en el registro con quién lo hizo, y el VALOR de una contraseña
 * no se escribe nunca ahí: solo que cambió.
 */
export async function saveConfigAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'platform:manage')) redirect('/panel');

  const cambiados: string[] = [];
  const sector = String(formData.get('sector') ?? '');

  // Las casillas no viajan cuando están sin marcar, así que la lista de medios
  // se compone de lo marcado y solo se toca desde su propio sector: leerla en
  // otro guardaría «ninguno» cada vez que se guarda el correo.
  if (sector === 'payments') {
    const marcados = formData
      .getAll('method')
      .map(String)
      .filter((method) => PAYMENT_METHODS.some((candidate) => candidate === method));
    await saveSetting('PAYMENT_METHODS', marcados.join(','), session.userId);
    cambiados.push('PAYMENT_METHODS');
  }

  // El logo y el icono llegan como ARCHIVO. Van antes que las claves de texto
  // porque si el archivo no se puede abrir hay que rebotar sin haber guardado
  // nada: guardar la mitad de un formulario es peor que no guardar.
  if (sector === 'brand') {
    for (const kind of BRAND_KINDS) {
      if (formData.get(`remove-${kind}`) !== null) {
        await deleteBrandAsset(kind, session.userId);
        cambiados.push(`${kind} (quitado)`);
        continue;
      }

      const file = formData.get(kind);
      if (!(file instanceof File) || file.size === 0) continue;

      const result = await processBrandImage(file, kind);
      if (isBrandProblem(result)) {
        redirect(`/panel/configuracion?s=brand&imagen=${result.error}`);
      }
      await saveBrandAsset(kind, result, session.userId);
      cambiados.push(`${kind} (nuevo)`);
    }
  }

  for (const key of SETTING_KEYS) {
    const raw = formData.get(key);
    if (raw === null) continue;
    await saveSetting(key as SettingKey, String(raw), session.userId);
    cambiados.push(key);
  }

  for (const key of SECRET_KEYS) {
    const raw = String(formData.get(key) ?? '');
    // Vacío significa «déjala como está», no «bórrala»: el campo se muestra
    // vacío siempre, porque no se puede leer la que ya hay.
    if (raw.length === 0) continue;
    await saveSecret(key as SecretKey, raw, session.userId);
    cambiados.push(`${key} (nueva)`);
  }

  // El transporte de correo guarda la conexión abierta con la configuración
  // vieja: sin esto, cambiar el servidor no surtiría efecto hasta reiniciar.
  resetTransporter();

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'system.config.save',
    entity: 'User',
    entityId: session.userId,
    metadata: { cambiados: cambiados.join(', ') },
    ip: clientIp(await headers()),
  });

  revalidatePath('/panel', 'layout');
  // La portada es pública y se sirve dinámicamente, pero su metadata y su
  // cabecera cuelgan de la marca: se refresca también.
  revalidatePath('/', 'layout');
  redirect(`/panel/configuracion?s=${sector === '' ? 'mail' : sector}&guardado=1`);
}

/**
 * Guarda los textos de la portada, o los bloques que muestra.
 *
 * Aparte de `saveConfigAction` porque las claves son distintas: aquí no hay una
 * lista fija de nombres sino una ruta del diccionario por texto, y cada una se
 * comprueba contra las rutas que el diccionario de verdad tiene. Una ruta
 * inventada en el envío no escribe nada.
 */
export async function saveHomeTextsAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'platform:manage')) redirect('/panel');

  const sector = String(formData.get('sector') ?? '');

  if (sector === 'home-layout') {
    for (const key of ['HOME_SECTIONS', 'HOME_SHOWCASE', 'HOME_DEFAULT_LOCALE'] as const) {
      const raw = formData.get(key);
      if (raw !== null) await saveSetting(key, String(raw), session.userId);
    }
    await recordAudit({
      tenantId: session.tenantId,
      actorId: session.userId,
      action: 'system.config.save',
      entity: 'User',
      entityId: session.userId,
      metadata: { cambiados: 'portada: bloques' },
      ip: clientIp(await headers()),
    });
    revalidatePath('/', 'layout');
    redirect('/panel/configuracion?s=home&guardado=1');
  }

  const locale = String(formData.get('idioma') ?? '');
  if (!isLocale(locale)) redirect('/panel/configuracion?s=home');

  const allowed = new Set(homePaths());
  let escritos = 0;

  for (const [field, raw] of formData.entries()) {
    if (!field.startsWith('t:')) continue;
    const path = field.slice(2);
    // Solo rutas que el diccionario tiene de verdad: el envío no inventa
    // campos, y una fila que no lee nadie es una fila que confunde.
    if (!allowed.has(path)) continue;

    await saveRawSetting(`${HOME_PREFIX}${path}.${locale}`, String(raw), session.userId);
    escritos += 1;
  }

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'system.config.save',
    entity: 'User',
    entityId: session.userId,
    // Cuántos y en qué idioma. El texto en sí está en la portada; el historial
    // no es el sitio para guardar una copia de la página entera.
    metadata: { cambiados: `portada: ${escritos} textos en ${locale}` },
    ip: clientIp(await headers()),
  });

  revalidatePath('/', 'layout');
  redirect(`/panel/configuracion?s=home&idioma=${locale}&guardado=1`);
}
