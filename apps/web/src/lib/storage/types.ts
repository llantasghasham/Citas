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
 *   · **No entrega NINGUNA dirección, ni de escritura ni de lectura.** La de
 *     escritura, porque una subida firmada en el navegador significa que el
 *     servidor no ve los bytes y entonces no puede quitar el EXIF, ni
 *     recodificar, ni comprobar que lo que llegó es una imagen: quedaría
 *     guardada la foto del móvil tal cual, con las coordenadas de una casa
 *     dentro. Y la de LECTURA, porque una dirección firmada que ya se entregó
 *     sigue valiendo hasta que caduque — así que una imagen retirada por una
 *     reclamación de derechos seguiría viéndose, y la retirada inmediata es un
 *     requisito, no una preferencia.
 *
 *     Todo se sirve por `/api/d/media/[mediaId]`, que mira el estado antes de
 *     devolver un byte. El día que el tráfico pida un CDN se añadirán las dos
 *     funciones, con purga explícita y la ventana residual escrita donde se vea.
 *     Mientras tanto: no se puede usar mal lo que no existe, y esto lo prueba
 *     `tests/almacen.test.ts`.
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

}
