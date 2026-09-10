/**
 * Encola los recordatorios que ya tocan.
 *
 * Se ejecuta sin nadie delante, cada cuarto de hora, desde un temporizador del
 * sistema. ENCOLA y nada más: quien manda sigue siendo el servicio de WhatsApp,
 * de uno en uno y con su freno. Un trabajo automático que mandara directamente
 * es un trabajo que vacía el cupo de un número mientras nadie mira.
 *
 *   npm run whatsapp:reminders
 *
 * El entorno lo pone quien lo llama, igual que el resto de los scripts: el
 * temporizador lee `apps/web/.env` con `EnvironmentFile`.
 */

// Sin esto TypeScript trata el archivo como un guion suelto y no como un
// módulo, y dos guiones con una función `main` chocan entre sí.
export {};

async function main(): Promise<void> {
  if (process.env['DATABASE_URL'] === undefined) {
    console.error('DATABASE_URL no está puesta.');
    process.exitCode = 1;
    return;
  }
  if (process.env['DATA_SOURCE'] !== 'database') {
    console.log('[recordatorios] DATA_SOURCE no es «database»: no hay eventos que mirar.');
    return;
  }

  // De paso, la limpieza: una sesión caducada guarda la IP de quien entró, y un
  // dato que ya no hace falta y que nadie borra es un dato que solo puede
  // filtrarse. Va aquí y no en su propio temporizador porque es una consulta
  // cada cuarto de hora, no un trabajo.
  const { purgeExpired } = await import('../src/lib/auth/purge');
  const purged = await purgeExpired();
  if (purged.sessions > 0 || purged.codes > 0) {
    console.log(`[limpieza] ${purged.sessions} sesión(es) y ${purged.codes} código(s) caducados`);
  }

  const { queueDueReminders } = await import('../src/lib/whatsapp/reminders');
  const outcome = await queueDueReminders();

  console.log(
    outcome.queued === 0
      ? '[recordatorios] no tocaba ninguno.'
      : `[recordatorios] ${outcome.queued} encolados en ${outcome.events} evento(s)`,
  );
}

void main()
  .catch((error: unknown) => {
    console.error(`[recordatorios] ${String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
