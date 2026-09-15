import { secret, setting } from '@/lib/settings';

import { senderDomain } from './dns';
import { MAIL_FROM_FORMAT, mailFromProblem } from './from';
import { MailNotSentError, type Email, type Mailer, type MailReceipt } from './types';

/**
 * Envío por la API de Resend.
 *
 * POR QUÉ HAY UN SEGUNDO EMISOR, que es lo que hay que entender antes de tocar
 * esto. El SMTP de este proyecto funciona: el mensaje sale bien formado, con su
 * remitente, y el dominio publica SPF, DKIM y DMARC. Comprobado contra Gmail,
 * que lo pone en la bandeja de entrada. Lo que NO llega es a Hotmail y a
 * Outlook, y la causa no está en este repositorio: es la reputación que
 * Microsoft le tiene a las IP COMPARTIDAS del alojamiento desde el que se
 * manda. Esa IP no es nuestra y no se puede arreglar desde aquí — solo se puede
 * dejar de usar. Eso es todo lo que hace este archivo: manda por otra puerta,
 * con IP de quien se dedica a esto.
 *
 * NO SUSTITUYE al SMTP ni se enciende solo. Se elige en la pantalla, y a
 * propósito: un respaldo que saltara al primer tropiezo mandaría el MISMO
 * código de acceso dos veces por dos caminos —porque «no contestó» no es «no
 * salió»— y de paso escondería que el primero está roto. Un emisor a la vez.
 *
 * SIN DEPENDENCIA NUEVA. Es una petición HTTP con una clave; el paquete oficial
 * no aporta nada que `fetch` no haga, y este proyecto no instala paquetes sin
 * preguntar.
 */
const ENDPOINT = 'https://api.resend.com/emails';

/**
 * Lo mismo que los topes del SMTP y por la misma razón: quien manda el código
 * de acceso es la pantalla de entrar. Un proveedor que acepta la conexión y se
 * queda callado tendría a `/entrar` esperando lo que él quisiera, y no solo a
 * quien está entrando — a todos.
 */
const TIMEOUT_MS = 15_000;

/** Lo que contesta Resend cuando acepta: un identificador y nada más. */
interface ResendOk {
  id?: string;
}

/** Y cuando no: un nombre y un motivo, que es lo que hay que enseñar tal cual. */
interface ResendError {
  name?: string;
  message?: string;
}

export const resendMailer: Mailer = {
  id: 'resend',

  async send(email: Email): Promise<MailReceipt> {
    // El remitente se comprueba igual que en el SMTP, y no es una copia por
    // pereza: Resend TAMBIÉN exige una dirección, y además el dominio tiene que
    // estar verificado en su panel. Un nombre de marca a secas falla allí con
    // un error suyo que no explica nada; aquí falla con el motivo escrito.
    const from = (await setting('MAIL_FROM')) ?? '';
    const problem = mailFromProblem(from);
    if (problem !== null) {
      throw new MailNotSentError(
        `MAIL_FROM = «${from}» no lleva una dirección de correo (${problem}). ` +
          `Se escribe así: ${MAIL_FROM_FORMAT}`,
      );
    }

    const key = await secret('RESEND_API_KEY');
    if (key === undefined || key.length === 0) {
      throw new MailNotSentError(
        'Falta la clave de API de Resend. Se pone en Configuración → Correo. ' +
          `Y el dominio «${senderDomain(from) ?? '—'}» tiene que estar verificado en Resend.`,
      );
    }

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          // La clave va en la cabecera y NUNCA en la dirección: una URL se
          // escribe entera en el registro de cualquier proxy que haya en medio.
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // Que no se cuele la clave en el texto de un error: esto acaba en el
      // diario del servidor y en la pantalla del panel.
      const reason = error instanceof Error ? error.message : 'error desconocido';
      throw new Error(`Resend no contestó: ${reason.replace(key, '[…]')}`);
    }

    const cuerpo: unknown = await response.json().catch(() => ({}));

    if (!response.ok) {
      const fallo = cuerpo as ResendError;
      // Se enseña lo que dijo ÉL, que es lo que sirve para arreglarlo: el caso
      // corriente es «el dominio no está verificado», y eso no se adivina desde
      // un «error 403».
      throw new Error(
        `Resend rechazó el envío (${response.status}): ${fallo.message ?? fallo.name ?? 'sin motivo'}`,
      );
    }

    const ok = cuerpo as ResendOk;
    return {
      // Resend acepta el mensaje entero o no lo acepta: no hay destinatarios a
      // medias como en SMTP. Así que aceptado es el que se pidió.
      accepted: [email.to],
      rejected: [],
      // Su identificador es el equivalente al número de cola del SMTP: es con
      // lo que se busca un mensaje concreto en su panel cuando alguien dice que
      // no le llegó.
      response: ok.id === undefined ? 'aceptado' : `id=${ok.id}`,
      from,
    };
  },
};
