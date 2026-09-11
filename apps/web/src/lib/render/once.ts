/**
 * Que N peticiones de la MISMA imagen abran un solo Chromium.
 *
 * El caso no es teórico ni raro: es el normal. Una invitación se reenvía a un
 * grupo de WhatsApp y doscientas personas la abren en el mismo minuto — y la
 * primera vez ninguna está en caché todavía. Sin esto, cada una arrancaba su
 * propia página: doscientos Chromium a la vez en una máquina que tiene dos
 * gigas.
 *
 * La llave es la versión y su huella, así que dos invitaciones distintas —o la
 * misma después de editarla— no se estorban entre ellas.
 *
 * Esto vale DENTRO de un proceso. Con varios, cada uno haría el suyo y la tabla
 * `Render` los iguala después; para que no se pisaran entre procesos haría falta
 * un cerrojo en la base, y eso es maquinaria para un problema que con una sola
 * máquina no existe.
 */
const inFlight = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

/** Cuántas páginas se dibujan a la vez. Cada una es un Chromium abierto. */
const MAX_AT_ONCE = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function takeSlot(): Promise<void> {
  if (running < MAX_AT_ONCE) {
    running += 1;
    return;
  }
  // Se hace cola en vez de rechazar: quien pide una invitación prefiere
  // esperar dos segundos a recibir un error.
  await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
}

function releaseSlot(): void {
  running -= 1;
  waiting.shift()?.();
}

export async function renderOnce(
  key: string,
  render: () => Promise<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array<ArrayBuffer>> {
  const already = inFlight.get(key);
  if (already !== undefined) return already;

  const work = (async () => {
    await takeSlot();
    try {
      return await render();
    } finally {
      releaseSlot();
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, work);
  return work;
}

/** Para las pruebas: cuántas se están dibujando ahora mismo. */
export function renderingNow(): { inFlight: number; running: number } {
  return { inFlight: inFlight.size, running };
}
