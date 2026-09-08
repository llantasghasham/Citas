import type { Email, Mailer } from './types';

/**
 * Development mailer: prints the message to the server log instead of sending
 * it. It refuses to run in production so a real login code can never be
 * "delivered" to a log file nobody reads.
 */
export const consoleMailer: Mailer = {
  id: 'console',
  send(email: Email): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('The console mailer must never run in production.');
    }
    console.info(`\n--- email to ${email.to} ---\n${email.subject}\n\n${email.text}\n---\n`);
    return Promise.resolve();
  },
};
