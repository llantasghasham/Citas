import { createHash, createHmac } from 'node:crypto';

/**
 * Firma de peticiones para un almacén compatible con S3 (AWS Signature V4).
 *
 * Escrita a mano con `node:crypto`, y no con el SDK de AWS, por dos razones
 * concretas y ninguna de purismo: el SDK son decenas de megas y docenas de
 * paquetes en una imagen de producción que hoy no los tiene, y esto es un
 * algoritmo cerrado y publicado que se puede comprobar contra el vector de
 * prueba oficial —cosa que `tests/almacen.test.ts` hace—.
 *
 * Solo se firma de UNA manera: metiendo la firma en la dirección
 * (`X-Amz-Signature`), lo que se llama una URL prefirmada. Con eso se puede
 * hacer todo lo que este proyecto necesita —leer, escribir, borrar y preguntar—
 * así que no hace falta el segundo modo, el de la cabecera `Authorization`. Un
 * camino menos es un camino menos donde equivocarse.
 *
 * La llave secreta NO sale de este módulo y NUNCA viaja a un navegador: lo que
 * sale es una dirección que caduca.
 */
export interface SignInput {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  /** `https://<cuenta>.r2.cloudflarestorage.com`, sin barra final. */
  endpoint: string;
  region: string;
  /**
   * El bucket, que va en la RUTA.
   *
   * Ausente significa el estilo de subdominio —el bucket ya está en el host— y
   * eso solo lo usan las pruebas: es como está escrito el vector oficial de AWS
   * contra el que se comprueba esta firma. En producción va siempre puesto.
   */
  bucket?: string;
  /** La llave del objeto, sin barra inicial. */
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Cuántos segundos vale. Máximo de S3: siete días. */
  expiresIn: number;
  /** El momento de la firma. Se pasa para poder probarlo. */
  now?: Date;
  /** Para un `PUT`: el tipo que se va a escribir. Va firmado. */
  contentType?: string;
}

const ALGORITHM = 'AWS4-HMAC-SHA256';
/** Siete días, el tope que acepta S3 para una dirección prefirmada. */
const MAX_EXPIRES = 7 * 24 * 60 * 60;

/**
 * El escapado de S3, que NO es el de `encodeURIComponent`.
 *
 * Dos diferencias, y las dos rompen la firma si se olvidan: `encodeURIComponent`
 * deja pasar `!'()*`, que aquí sí se escapan; y la barra de la llave NO se
 * escapa cuando va en la ruta, pero SÍ cuando va en un parámetro.
 */
function encode(value: string, keepSlash = false): string {
  const escaped = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return keepSlash ? escaped.replace(/%2F/g, '/') : escaped;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/** `20130524T000000Z`, que es lo que S3 quiere y no lo que da `toISOString()`. */
function amzDate(now: Date): { stamp: string; day: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, day: stamp.slice(0, 8) };
}

/**
 * Una dirección firmada que caduca.
 *
 * `UNSIGNED-PAYLOAD` a propósito: firmar el contenido obligaría a tenerlo entero
 * en memoria y a calcularle el hash antes de empezar a enviarlo, y lo que
 * protege de que alguien cambie los bytes por el camino es TLS. Es lo que hace
 * el propio SDK de AWS para las direcciones prefirmadas.
 */
export function presignS3Url(input: SignInput): string {
  if (input.expiresIn <= 0 || input.expiresIn > MAX_EXPIRES) {
    throw new Error('Una dirección firmada vale entre un segundo y siete días.');
  }

  const { stamp, day } = amzDate(input.now ?? new Date());
  const host = new URL(input.endpoint).host;
  const scope = `${day}/${input.region}/s3/aws4_request`;

  // Los parámetros van ORDENADOS por nombre, y ese orden es parte de la firma.
  const canonicalQuery = [
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${input.accessKeyId}/${scope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(input.expiresIn)],
    ['X-Amz-SignedHeaders', 'host'],
  ]
    .map(([name, value]) => `${encode(name ?? '')}=${encode(value ?? '')}`)
    .sort()
    .join('&');

  // Con bucket, va en la RUTA: es lo que aceptan R2 y MinIO, y el estilo de
  // subdominio obligaría a un certificado por bucket. Sin bucket —solo desde
  // las pruebas— sale el estilo de subdominio, que es como está escrito el
  // vector oficial de AWS contra el que se comprueba esto.
  const path =
    input.bucket === undefined
      ? `/${encode(input.key, true)}`
      : `/${encode(input.bucket, true)}/${encode(input.key, true)}`;

  const canonicalRequest = [
    input.method,
    path,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [ALGORITHM, stamp, scope, sha256(canonicalRequest)].join('\n');

  const signature = hmac(
    hmac(
      hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), 's3'),
      'aws4_request',
    ),
    stringToSign,
  ).toString('hex');

  return `${input.endpoint}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
