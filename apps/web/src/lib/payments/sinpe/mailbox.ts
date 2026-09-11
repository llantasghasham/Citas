import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { decryptSecret } from '@/lib/secrets';

/**
 * El buzón del banco, leído por IMAP.
 *
 * Todo el protocolo vive AQUÍ, detrás de un puerto, como la pasarela de cobro y
 * el almacén de imágenes: el resto del sistema recibe «asunto y cuerpo» y no
 * sabe si vinieron de un servidor de correo, de una caja donde alguien los pegó
 * o de una prueba.
 *
 * Se abre en SOLO LECTURA a propósito. Es el buzón personal de quien cobra, no
 * uno de servicio: marcar como leídos sus correos, o moverlos de carpeta, es
 * revolverle el correo a una persona por una comodidad nuestra. Y no hace
 * falta: el comprobante es único por cuenta, así que releer los mismos correos
 * cada cinco minutos no cobra nada dos veces.
 */

export interface SinpeEmail {
  /** De quién viene. El banco a veces solo se nombra aquí. */
  from: string;
  subject: string;
  /** El cuerpo, ya sin MIME: texto si lo hay, y si no el HTML tal cual. */
  body: string;
  receivedAt: Date;
}

export interface SinpeMailboxConfig {
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPasswordEnc: string;
  folder: string;
  /**
   * Comprobar el certificado del servidor. Se apaga SOLO si el correo va en un
   * servidor con certificado propio y la conexión falla por eso; apagarlo abre
   * la puerta a que alguien en medio lea la contraseña y todo el correo, así
   * que viene encendido y quien lo apague tiene que saber por qué.
   */
  rejectUnauthorized?: boolean;
}

/** Un buzón que cualquiera puede implementar. Hoy hay uno: IMAP. */
export interface SinpeMailbox {
  fetchSince(since: Date, limit: number): Promise<SinpeEmail[]>;
  close(): Promise<void>;
}

/** Un correo que no se lee en veinte segundos no se va a leer. */
const TIMEOUT_MS = 20_000;

export async function openImapMailbox(config: SinpeMailboxConfig): Promise<SinpeMailbox> {
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapPort === 993,
    auth: { user: config.imapUser, pass: decryptSecret(config.imapPasswordEnc) },
    // Sin esto, la librería escribe en la consola el diálogo completo con el
    // servidor — la línea de LOGIN incluida. La contraseña acabaría en el
    // journal del sistema, que es justo lo que el cifrado viene a evitar.
    logger: false,
    ...(config.rejectUnauthorized === false ? { tls: { rejectUnauthorized: false } } : {}),
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
    connectionTimeout: TIMEOUT_MS,
  });

  await client.connect();
  // `true` es solo lectura: ni marca leído ni mueve nada.
  const lock = await client.getMailboxLock(config.folder, { readOnly: true });

  return {
    async fetchSince(since: Date, limit: number): Promise<SinpeEmail[]> {
      // IMAP busca por DÍA, no por hora: `SINCE` de ayer trae también los de
      // hoy. Se pide de más y se descarta aquí, que es más barato que perder
      // un correo por un redondeo de fecha.
      const uids = await client.search({ since: dayBefore(since) }, { uid: true });
      if (uids === undefined || uids === false || uids.length === 0) return [];

      const latest = uids.slice(-limit);
      const emails: SinpeEmail[] = [];
      for await (const message of client.fetch(latest, { source: true, envelope: true }, { uid: true })) {
        if (message.source === undefined) continue;
        const parsed = await simpleParser(message.source);
        // La fecha puede llegar como texto según de dónde salga; se normaliza
        // antes de compararla, o un correo con la cabecera rara se colaría o se
        // perdería según el humor del servidor.
        const receivedAt = asDate(parsed.date) ?? asDate(message.envelope?.date) ?? new Date();
        if (receivedAt.getTime() < since.getTime()) continue;

        emails.push({
          from: parsed.from?.text ?? '',
          subject: parsed.subject ?? '',
          // El texto plano cuando lo hay. Si el banco manda solo HTML —y hay
          // alguno—, el HTML entero: quien lo limpia es `text.ts`, y hacerlo
          // aquí con el limpiador de la librería perdería la tabla donde viene
          // el monto.
          body: parsed.text ?? (typeof parsed.html === 'string' ? parsed.html : ''),
          receivedAt,
        });
      }
      return emails;
    },

    async close(): Promise<void> {
      lock.release();
      await client.logout().catch(() => undefined);
    },
  };
}

/** Una fecha de verdad, venga como venga. Nula si no se entiende. */
function asDate(value: Date | string | undefined): Date | null {
  if (value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayBefore(date: Date): Date {
  return new Date(date.getTime() - 24 * 60 * 60 * 1000);
}
