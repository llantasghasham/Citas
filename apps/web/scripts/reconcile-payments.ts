/**
 * Repasa los cobros que se quedaron en «pendiente» y le pregunta al proveedor.
 *
 * Se ejecuta sin nadie delante, cada pocos minutos, desde un temporizador del
 * sistema. Existe porque el callback de Whish no va firmado y en este proyecto
 * solo vale como aviso: quien decide es preguntar. Y un aviso se pierde — el
 * servidor reiniciando, la red caída, Whish reintentando tres veces y
 * rindiéndose. Sin esto, un cobro cuyo aviso se perdía se quedaba pendiente
 * hasta que alguien abriera una pantalla, o para siempre si nadie la abría.
 *
 *   npm run payments:reconcile
 *
 * El entorno lo pone quien lo llama, igual que en el resto de los scripts de
 * este proyecto: el temporizador del sistema lee `apps/web/.env` con
 * `EnvironmentFile`, exactamente como hace el servicio de WhatsApp.
 */
async function main(): Promise<void> {
  if (process.env['DATABASE_URL'] === undefined) {
    console.error('DATABASE_URL no está puesta.');
    process.exitCode = 1;
    return;
  }

  // En una instalación que todavía no cobra, el temporizador correría cada
  // cinco minutos llenando el registro de errores que no son errores.
  if (process.env['DATA_SOURCE'] !== 'database') {
    console.log('[conciliar] DATA_SOURCE no es «database»: no hay cobros que repasar.');
    return;
  }

  const { reconcilePending } = await import('../src/lib/billing/reconcile');
  const summary = await reconcilePending();

  if (summary.checked === 0) {
    console.log('[conciliar] no había ninguno pendiente.');
    return;
  }
  console.log(
    `[conciliar] mirados ${summary.checked}, cambiados ${summary.changed}, ` +
      `pagados ${summary.paid}, con error ${summary.errors}`,
  );

  // Un error suelto no tumba la pasada, pero sí tiene que verse desde fuera: el
  // temporizador marca la ejecución como fallida y queda en el diario, que es
  // donde se mira cuando un cobro no aparece.
  if (summary.errors > 0) process.exitCode = 1;
}

void main()
  .catch((error: unknown) => {
    console.error(`[conciliar] ${String(error)}`);
    process.exitCode = 1;
  })
  // Prisma deja el pool abierto y el proceso no terminaría solo.
  .finally(() => process.exit(process.exitCode ?? 0));
