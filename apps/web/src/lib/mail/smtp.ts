import { createTransport, type Transporter } from 'nodemailer';

import { secret, setting } from '@/lib/settings';

import { senderDomain } from './dns';
import { MAIL_FROM_FORMAT, mailFromProblem } from './from';
import { MailNotSentError, type Email, type Mailer, type MailReceipt } from './types';

/**
 * SMTP delivery.
 *
 * The password is read from `SMTP_PASSWORD_ENC`, encrypted with the key in
 * `CITAS_SECRET_KEY_FILE`, so the `.env` alone does not reveal it.
 * `SMTP_PASSWORD` in the clear is still accepted — some hosts leave no choice —
 * but it is refused in production, where there is no excuse for it.
 */
let transporter: Transporter | undefined;

/**
 * Lee un ajuste obligatorio, y señala el nombre parecido cuando lo encuentra
 * puesto: escribir `SMTP_FROM` donde el código lee `MAIL_FROM` ya costó un
 * despliegue, y «MAIL_FROM no está» es inútil para quien mira una línea que
 * parece ponerlo.
 */
async function required(name: 'SMTP_HOST' | 'SMTP_USER' | 'MAIL_FROM'): Promise<string> {
  const value = await setting(name);
  if (value !== undefined && value.length > 0) return value;

  const confuso = name === 'MAIL_FROM' && (process.env['SMTP_FROM'] ?? '').length > 0;
  throw new Error(
    `${name} no está configurado.${confuso ? ' SMTP_FROM sí, pero ese no es el nombre que se lee.' : ''}`,
  );
}

async function getTransporter(): Promise<Transporter> {
  if (transporter !== undefined) return transporter;

  const port = Number.parseInt((await setting('SMTP_PORT')) ?? '587', 10);
  const password = await secret('SMTP_PASSWORD');
  if (password === undefined) {
    throw new Error('No hay contraseña de SMTP. Póngala en el panel, en Configuración.');
  }

  // CÓMO SE PRESENTA este cliente al servidor (el `EHLO`).
  //
  // Sin esto nodemailer usa `os.hostname()`, que en un VPS es lo que pusiera el
  // instalador: `vm`, `localhost`, `srv1`. Y eso no se queda entre nosotros y
  // Bluehost — el servidor lo escribe en la cabecera `Received:` y esa cabecera
  // VIAJA con el mensaje hasta Hotmail y Gmail, que leen ahí un nombre que no
  // es un dominio, junto a la IP suelta de una máquina cualquiera. Un correo
  // escrito en el webmail no lleva esa línea, y es la diferencia que queda
  // entre uno que llega y uno que no.
  //
  // Se usa el dominio DEL REMITENTE, que es un nombre que existe y resuelve, y
  // es además lo que este servidor dice ser. Si el remitente no tuviera
  // dominio no se llega hasta aquí: `send` lo rechaza antes.
  const helo = senderDomain(await required('MAIL_FROM'));

  transporter = createTransport({
    host: await required('SMTP_HOST'),
    port,
    // `name` es el EHLO. Sin dominio en el remitente se deja lo que haya, que
    // es exactamente el comportamiento de antes.
    ...(helo === null ? {} : { name: helo }),
    // 587 is STARTTLS: the connection opens in the clear and is upgraded.
    // Only 465 is TLS from the first byte.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: await required('SMTP_USER'), pass: password },
    // A mail server that accepts the connection and then says nothing would
    // otherwise hold the sign-in request open for as long as it liked, and
    // /entrar would hang for everybody, not just for the one signing in.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return transporter;
}

/** El transporte guarda la conexión: al cambiar la configuración hay que soltarla. */
export function resetTransporter(): void {
  transporter = undefined;
}

export const smtpMailer: Mailer = {
  id: 'smtp',

  async send(email: Email): Promise<MailReceipt> {
    // El remitente se comprueba AQUÍ y no solo al guardarlo en el panel: en el
    // `.env` se escribe a mano y ahí no pasa por ninguna pantalla. Sin
    // dirección, lo que sale es un mensaje sin cabecera `From:` que el servidor
    // acepta con un «250 OK» y el destinatario tira en silencio — el fallo más
    // caro de diagnosticar que tiene esto, porque desde aquí se ve como un
    // envío correcto.
    const from = await required('MAIL_FROM');
    const problem = mailFromProblem(from);
    if (problem !== null) {
      // Marcado: esto lo decidimos AQUÍ, sin abrir la conexión. La pantalla lo
      // distingue de lo que contesta el proveedor, que es otra avería y se
      // arregla en otro sitio.
      throw new MailNotSentError(
        `MAIL_FROM = «${from}» no lleva una dirección de correo (${problem}). ` +
          `Se escribe así: ${MAIL_FROM_FORMAT}`,
      );
    }

    try {
      const info = await (await getTransporter()).sendMail({
        from,
        to: email.to,
        subject: email.subject,
        text: email.text,
      });

      // Kept because `verify()` never reaches this far: it stops after the
      // login, so a server that authenticates happily and then refuses the
      // recipient looks identical to one that works.
      return {
        accepted: (info.accepted ?? []).map(String),
        rejected: (info.rejected ?? []).map(String),
        response: info.response ?? '',
        from,
      };
    } catch (error) {
      // Never let the credentials travel in an error: nodemailer's messages can
      // carry the auth line, and this ends up in the journal.
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw new Error(`SMTP delivery failed: ${reason.replace(/AUTH\s+\S+/gi, 'AUTH […]')}`);
    }
  },
};
