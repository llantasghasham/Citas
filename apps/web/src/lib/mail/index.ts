import { consoleMailer } from './console';
import type { Mailer } from './types';

/** `MAILER=console` in development. A real provider is added here when chosen. */
export function getMailer(): Mailer {
  return consoleMailer;
}

export type { Email, Mailer } from './types';
