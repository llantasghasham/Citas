/**
 * La referencia con la que se abre un cobro.
 *
 * La decide QUIEN ABRE el cobro, no el adaptador, y por una razón de dinero: la
 * fila del pago se escribe con ella ANTES de llamar al proveedor, de modo que el
 * índice único parcial —un cobro pendiente por pedido— para a la segunda
 * petición antes de que llegue a la pasarela. Generándola dentro del adaptador,
 * dos peticiones simultáneas abrían DOS cobranzas de verdad: solo una quedaba
 * guardada, y la otra se quedaba viva en Whish esperando a que alguien la
 * pagara.
 *
 * Tiene que ser NUMÉRICA: es lo que Whish devuelve en su aviso y lo único que
 * acepta su consulta de estado, y los identificadores de este proyecto son
 * cuids. Milisegundos desde la época más tres dígitos al azar: única por cobro,
 * ordenada en el tiempo y holgadamente dentro de un entero de 64 bits.
 */
export function newPaymentReference(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`;
}
