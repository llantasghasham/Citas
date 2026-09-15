import { consoleMailer } from './console';
import { resendMailer } from './resend';
import { smtpMailer } from './smtp';
import { setting } from '@/lib/settings';

import type { Mailer } from './types';

/**
 * Quién manda el correo. `smtp` y `resend` mandan de verdad; cualquier otra
 * cosa lo imprime en el diario y se NIEGA a correr en producción, para que un
 * código de acceso de verdad no se «entregue» en un archivo que nadie lee.
 *
 * Son dos puertas al mismo sitio y se elige UNA. No hay respaldo automático a
 * propósito: saltar de una a otra al primer tropiezo mandaría el mismo código
 * dos veces —«no contestó» no es «no salió»— y escondería que la primera está
 * rota. El porqué de que exista la segunda está en `resend.ts`.
 *
 * Se lee de la configuración del panel, con el entorno como respaldo.
 */
export async function getMailer(): Promise<Mailer> {
  switch (await setting('MAILER')) {
    case 'smtp':
      return smtpMailer;
    case 'resend':
      return resendMailer;
    default:
      return consoleMailer;
  }
}

export type { Email, Mailer } from './types';
