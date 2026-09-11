import { checkSinpeAccounts } from '../src/lib/payments/sinpe/check';
import { controlDb } from '../src/lib/db/client';

/**
 * Revisa los buzones de SINPE y cobra lo que case.
 *
 * Lo llama `citas-sinpe.timer` cada cinco minutos. No hay planificador dentro
 * de Next, y no puede haberlo: un `setInterval` en una aplicación web se
 * duplica con cada proceso y desaparece con cada despliegue.
 *
 *   npm run sinpe:check --workspace @citas/web
 */
async function main(): Promise<void> {
  const summary = await checkSinpeAccounts();
  console.log(
    `[sinpe] buzones ${summary.accounts} · correos ${summary.emails} · ` +
      `guardados ${summary.stored} · cobrados ${summary.applied} · fallos ${summary.errors}`,
  );
  if (summary.errors > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void controlDb().$disconnect();
  });
