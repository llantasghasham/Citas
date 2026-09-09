'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { clientIp } from '@/lib/admin/context';
import { recordAudit } from '@/lib/audit';
import { getSession, sessionCan } from '@/lib/auth/session';
import { resetTransporter } from '@/lib/mail/smtp';
import {
  saveSecret,
  saveSetting,
  SECRET_KEYS,
  SETTING_KEYS,
  type SecretKey,
  type SettingKey,
} from '@/lib/settings';

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
  redirect('/panel/configuracion?guardado=1');
}
