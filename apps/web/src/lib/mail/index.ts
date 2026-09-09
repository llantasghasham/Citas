import { consoleMailer } from './console';
import { smtpMailer } from './smtp';
import { setting } from '@/lib/settings';

import type { Mailer } from './types';

/**
 * `MAILER=smtp` sends for real; anything else prints to the log and is refused
 * in production, so a real access code can never be "delivered" to a log file.
 *
 * Se lee de la configuración del panel, con el entorno como respaldo.
 */
export async function getMailer(): Promise<Mailer> {
  return (await setting('MAILER')) === 'smtp' ? smtpMailer : consoleMailer;
}

export type { Email, Mailer } from './types';
