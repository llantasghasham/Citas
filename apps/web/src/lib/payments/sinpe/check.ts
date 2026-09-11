import { getPrisma } from '@/lib/db/client';
import { openImapMailbox, type SinpeMailbox } from '@/lib/payments/sinpe/mailbox';
import { ingestSinpeEmail } from '@/lib/payments/sinpe/service';

/**
 * El repaso de los buzones. Lo llama un temporizador de systemd cada cinco
 * minutos, porque en Citas no hay planificador.
 *
 * Es IDEMPOTENTE por construcción y no por cuidado: el comprobante es único por
 * cuenta, así que releer los mismos correos —que es lo que pasa en cada
 * pasada— no puede cobrar nada dos veces. Por eso el buzón se abre en solo
 * lectura y no se marca nada: no hace falta, y es el correo personal de alguien.
 *
 * Un fallo de IMAP se guarda en `lastError` de la cuenta y se sigue con la
 * siguiente. Un buzón que dejó de conectar es plata que deja de entrar sin que
 * nadie se entere, así que el error se ve en el panel — no en un registro que
 * nadie abre.
 */

/** Cuánto se mira hacia atrás cuando la cuenta no se ha revisado nunca. */
const FIRST_LOOK_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Solape al releer. El reloj del servidor de correo no es el nuestro, y un
 * correo que llegue justo en el borde se perdería para siempre: releerlo no
 * cuesta nada, perderlo cuesta un cobro.
 */
const OVERLAP_MS = 10 * 60 * 1000;
/** Cuántos correos se traen de una pasada. Un buzón personal tiene de todo. */
const BATCH = 60;

export interface SinpeCheckSummary {
  accounts: number;
  emails: number;
  stored: number;
  applied: number;
  errors: number;
}

/** Para poder probar esto sin un servidor de correo delante. */
type MailboxOpener = (config: {
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPasswordEnc: string;
  folder: string;
  rejectUnauthorized?: boolean;
}) => Promise<SinpeMailbox>;

export async function checkSinpeAccounts(
  open: MailboxOpener = openImapMailbox,
): Promise<SinpeCheckSummary> {
  const prisma = getPrisma();
  const accounts = await prisma.sinpeAccount.findMany({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
  });

  const summary: SinpeCheckSummary = { accounts: 0, emails: 0, stored: 0, applied: 0, errors: 0 };

  for (const account of accounts) {
    summary.accounts += 1;
    const since = new Date(
      (account.lastCheckedAt?.getTime() ?? Date.now() - FIRST_LOOK_MS) - OVERLAP_MS,
    );

    let mailbox: SinpeMailbox | null = null;
    try {
      mailbox = await open({ ...account, rejectUnauthorized: account.verifyCertificate });
      const emails = await mailbox.fetchSince(since, BATCH);
      summary.emails += emails.length;

      for (const email of emails) {
        const outcome = await ingestSinpeEmail(account, email.subject, email.body, email.from);
        if (outcome.kind === 'stored') {
          summary.stored += 1;
          if (outcome.applied) summary.applied += 1;
        }
      }

      // Solo se adelanta el reloj cuando la pasada TERMINÓ. Si se cayó a la
      // mitad, la siguiente vuelve a mirar desde donde estaba: repetir es
      // gratis, saltarse un correo no.
      await prisma.sinpeAccount.update({
        where: { id: account.id },
        data: { lastCheckedAt: new Date(), lastError: null },
      });
    } catch (error) {
      summary.errors += 1;
      const reason = error instanceof Error ? error.message : 'error desconocido';
      // Nunca la contraseña: los errores de IMAP pueden traer la línea de
      // LOGIN entera, y esto acaba en una pantalla y en el journal.
      await prisma.sinpeAccount.update({
        where: { id: account.id },
        data: { lastError: reason.replace(/LOGIN\s+\S+\s+\S+/gi, 'LOGIN […]').slice(0, 300) },
      });
    } finally {
      await mailbox?.close().catch(() => undefined);
    }
  }

  return summary;
}
