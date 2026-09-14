export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * What the provider said when it took the message.
 *
 * Handing the message over is not the same as delivering it: a server can
 * accept one and then drop it, and the sender is never told. This is the last
 * thing the application can actually witness, so it is worth keeping — without
 * it, "sent" is a claim rather than evidence.
 */
export interface MailReceipt {
  /** Recipients the server took responsibility for. */
  accepted: string[];
  /** Recipients it refused outright. */
  rejected: string[];
  /** The server's own last line, e.g. "250 OK id=1abcd-…". */
  response: string;
  /**
   * El remitente con el que salió. Se devuelve para poder ENSEÑARLO: «no llega»
   * casi siempre se explica mirando de quién venía, y sin esto hay que ir a
   * buscarlo a otra pantalla.
   */
  from?: string;
}

/**
 * Sending email is a provider decision that has not been made yet, so the
 * application only knows this port. Picking Resend, SES or anything else later
 * adds one file and touches nothing.
 */
export interface Mailer {
  readonly id: string;
  send(email: Email): Promise<MailReceipt>;
}

/**
 * El mensaje NO llegó a salir de esta máquina.
 *
 * Existe para no mentir sobre quién dijo que no. La pantalla de prueba pinta
 * todo fallo como «El servidor de correo lo rechazó. Su respuesta, tal cual:» y
 * a continuación el texto del error — y cuando el que se negó fuimos nosotros,
 * antes de abrir la conexión, eso manda a alguien a revisar su Bluehost por un
 * campo mal escrito en su propio panel. Un error del programa disfrazado de
 * respuesta del proveedor cuesta el día entero que iba a ahorrar.
 *
 * Lo que sí viene del servidor sigue siendo un `Error` corriente.
 */
export class MailNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailNotSentError';
  }
}
