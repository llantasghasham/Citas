import { consoleMailer } from './console';
import { smtpMailer } from './smtp';
import type { Mailer } from './types';

/**
 * `MAILER=smtp` sends for real; anything else prints to the log and is refused
 * in production, so a real access code can never be "delivered" to a log file.
 */
export function getMailer(): Mailer {
  return process.env['MAILER'] === 'smtp' ? smtpMailer : consoleMailer;
}

export type { Email, Mailer } from './types';
