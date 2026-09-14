/**
 * El REMITENTE, y por qué tiene su propio archivo.
 *
 * `MAIL_FROM` es el único ajuste del correo que se puede rellenar con algo que
 * parece razonable y no lo es. Escribir ahí el nombre de la marca a secas
 * —«POSFactura»— se lee bien, se guarda bien, y lo que sale por el cable es un
 * mensaje SIN CABECERA `From:` y con el sobre vacío, porque no hay ninguna
 * dirección que poner. Comprobado con el propio nodemailer:
 *
 *   from: 'POSFactura'                    → sin From:, envelope.from = false,
 *                                           Message-ID: <…@localhost>
 *   from: 'POSFactura <info@midominio.com>' → From: POSFactura <info@…>
 *
 * Un mensaje sin `From:` viola el estándar. El servidor de salida lo ACEPTA
 * igualmente y contesta «250 OK» con su número de cola —eso es lo que se ve
 * desde aquí—, y quien lo tira es el que lo recibe: Hotmail y Gmail lo
 * descartan EN SILENCIO, sin rebote. Desde este lado se ve exactamente igual
 * que si hubiera llegado.
 *
 * Así que la dirección se exige ANTES de guardar y OTRA VEZ antes de mandar.
 * Dos veces y no una: en el `.env` se puede escribir a mano, y ahí no pasa por
 * la pantalla que la comprueba.
 */

export type MailFromProblem = 'missing' | 'noAddress' | 'badAddress';

/**
 * Una dirección de correo con la forma mínima que exige el estándar y que
 * miran los servidores: algo, arroba, dominio con punto.
 *
 * No se intenta validar más. La lista completa de lo que RFC 5322 permite
 * incluye comillas, comentarios y direcciones IP literales, y una expresión que
 * las cubra todas rechaza direcciones válidas más a menudo que acepta falsas.
 */
const ADDRESS = /^[^\s@<>,;]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * Si eso es una dirección de correo. Vale para el remitente y para cualquier
 * destinatario: es la MISMA forma mínima, y escrita dos veces son dos
 * expresiones que un día dejan de decir lo mismo.
 */
export function isEmailAddress(value: string): boolean {
  return ADDRESS.test(value.trim());
}

/** La dirección que hay dentro, venga sola o entre ángulos. */
export function mailFromAddress(value: string | undefined): string | null {
  if (value === undefined) return null;
  const inside = value.match(/<([^>]+)>/)?.[1] ?? value;
  const bare = inside.trim();
  return ADDRESS.test(bare) ? bare : null;
}

/**
 * Qué le pasa al remitente, o `null` si está bien.
 *
 *   · `missing`    — vacío.
 *   · `noAddress`  — hay texto pero ninguna arroba: el caso de «POSFactura».
 *   · `badAddress` — hay algo con forma de dirección y no lo es.
 */
export function mailFromProblem(value: string | undefined): MailFromProblem | null {
  const raw = (value ?? '').trim();
  if (raw.length === 0) return 'missing';
  if (mailFromAddress(raw) !== null) return null;
  return raw.includes('@') ? 'badAddress' : 'noAddress';
}

/** Cómo se escribe, para decirlo en el mismo sitio donde se rechaza. */
export const MAIL_FROM_FORMAT = 'Su Marca <info@su-dominio.com>';
