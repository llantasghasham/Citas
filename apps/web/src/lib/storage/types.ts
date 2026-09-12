import type { ObjectKey } from './key';

export interface StoredObject {
  body: Uint8Array;
  contentType: string;
}

/**
 * El almacén de objetos: un puerto, como `Mailer`, `PaymentProvider` y
 * `RenderStore`. La aplicación no sabe qué hay detrás.
 *
 * Lo que este puerto NO hace, y es a propósito:
 *
 *   · **No sabe de proveedores ni de permisos.** Es un almacén de bytes. Quién
 *     puede escribir qué lo decide la capa de arriba con su ámbito resuelto. Un
 *     puerto que además autoriza es un puerto donde un día se autoriza distinto
 *     que en el resto del programa.
 *   · **No tiene `list()`.** No hace falta para nada de lo que se construye, y
 *     es la llamada que se paga caro el día que alguien la mete en un bucle.
 *   · **No firma subidas PARA EL NAVEGADOR.** Una subida firmada en el navegador
 *     significa que el servidor no ve los bytes, y entonces no puede quitar el
 *     EXIF, ni recodificar, ni comprobar que lo que llegó es una imagen. Lo que
 *     quedaría guardado es la foto del móvil tal cual, con las coordenadas de
 *     una casa dentro. No se puede usar mal lo que no existe.
 */
export interface ObjectStore {
  readonly id: 's3' | 'memory';

  /** Escribe. El `contentType` es el REAL, decidido por el servidor. */
  put(key: ObjectKey, body: Uint8Array, contentType: string): Promise<void>;

  /** Lee. `null` si no está: un objeto que falta no es una excepción. */
  get(key: ObjectKey): Promise<StoredObject | null>;

  /** Borra. IDEMPOTENTE: borrar lo que ya no está no falla. */
  remove(key: ObjectKey): Promise<void>;

  /** ¿Está, y cuánto mide? Para conciliar la base con el almacén. */
  head(key: ObjectKey): Promise<{ bytes: number; contentType: string } | null>;

  /**
   * Una dirección de LECTURA que caduca, para lo que no pasa por nuestra ruta:
   * la descarga que pide quien modera, y el CDN del día que haya tráfico.
   */
  signedReadUrl(key: ObjectKey, seconds: number): Promise<string>;

  /**
   * La dirección pública de un objeto YA aprobado, si esta instalación tiene
   * una configurada. `null` cuando no la hay — y entonces se sirve por nuestra
   * ruta, que mira el estado antes de devolver un byte.
   */
  publicUrl(key: ObjectKey): string | null;
}
