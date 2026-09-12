import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Encryption at rest for the few secrets that a running service must be able to
 * read back — today the SMTP password.
 *
 * Be clear about what this does and does not buy. Sending mail needs the
 * password in the clear at that moment, so the key has to live on the same
 * machine: anyone who can read both files can read the password. What it does
 * protect against is the `.env` leaking *on its own* — copied into a backup,
 * pasted into a chat, read by another process — because the key is kept
 * somewhere else, with its own permissions.
 *
 * Real protection is still: mode 600, never in the repository, and rotation.
 */
const FORMAT = 'v1';

function readKey(): Buffer {
  const inline = process.env['CITAS_SECRET_KEY'];
  const path = process.env['CITAS_SECRET_KEY_FILE'];

  const material =
    inline !== undefined && inline.length > 0
      ? inline
      : path !== undefined && path.length > 0
        ? readFileSync(path, 'utf8')
        : undefined;

  if (material === undefined) {
    throw new Error(
      'No encryption key. Set CITAS_SECRET_KEY_FILE (preferred) or CITAS_SECRET_KEY.',
    );
  }

  const key = Buffer.from(material.trim(), 'base64');
  if (key.length !== 32) {
    throw new Error('The encryption key must be 32 bytes, base64 encoded (openssl rand -base64 32).');
  }
  return key;
}

/**
 * Firma con la MISMA llave que cifra los secretos, separando por PROPÓSITO.
 *
 * Existe para poder derivar un código verificable —el del QR de la puerta— de
 * algo que ya existe, en vez de inventar otra tabla de tokens que caduquen mal
 * y que haya que purgar. Quien no tenga la llave no puede fabricar uno.
 *
 * La llave NO sale de este módulo: se entra el propósito y el dato y se sale
 * con la firma. Devolverla en crudo sería repartir por el código la única cosa
 * que hay que guardar en un sitio.
 *
 * El `purpose` va DENTRO del mensaje y con un separador que no puede aparecer
 * en él: sin eso, dos usos distintos de la misma llave firman el mismo texto y
 * una firma hecha para una cosa vale para la otra.
 */
export function signWithSecretKey(purpose: string, payload: string): string {
  if (purpose.includes('\u0000')) throw new Error('El propósito de una firma no lleva NUL.');
  return createHmac('sha256', readKey())
    .update(`${purpose}\u0000${payload}`, 'utf8')
    .digest('base64url');
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', readKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    FORMAT,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  const [format, iv, tag, ciphertext] = payload.split('.');
  if (format !== FORMAT || iv === undefined || tag === undefined || ciphertext === undefined) {
    throw new Error('Malformed encrypted secret. Expected v1.<iv>.<tag>.<ciphertext>.');
  }

  const decipher = createDecipheriv('aes-256-gcm', readKey(), Buffer.from(iv, 'base64'));
  // GCM verifies the tag on final(): a tampered value throws instead of
  // decrypting into something else.
  decipher.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Lee la contraseña de un servicio del entorno, cifrada.
 *
 * La regla del proyecto es que las contraseñas de servicios van cifradas en el
 * `.env`, con la llave fuera del proyecto. Estaba escrita para el SMTP y se
 * cumplía solo ahí; Whish leía su `secret` en claro. Ahora la regla vive en un
 * sitio y la cumplen todos.
 *
 * `<NOMBRE>_ENC` es el valor cifrado. `<NOMBRE>` en claro se acepta fuera de
 * producción —hay proveedores que no dejan otra— y se rechaza dentro.
 */
export function readServiceSecret(name: string): string | undefined {
  const encrypted = process.env[`${name}_ENC`];
  if (encrypted !== undefined && encrypted.length > 0) {
    // El error que ya ocurrió una vez: pegar la contraseña en claro en el campo
    // cifrado. Descifrarla solo diría «secreto mal formado», que no le dice a
    // nadie lo que hizo.
    if (!encrypted.startsWith(`${FORMAT}.`)) {
      throw new Error(
        `${name}_ENC no contiene un valor cifrado (tiene que empezar por "${FORMAT}."). ` +
          'Parece la contraseña pegada en claro. Cífrela antes: ' +
          'npm run secret:encrypt --workspace @citas/web',
      );
    }
    return decryptSecret(encrypted);
  }

  const plain = process.env[name];
  if (plain === undefined || plain.length === 0) return undefined;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} en claro no se permite en producción. Use ${name}_ENC.`);
  }
  return plain;
}
