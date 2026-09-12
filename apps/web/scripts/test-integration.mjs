/**
 * La suite ENTERA, y que no pueda pasar en silencio sin base de datos.
 *
 * `npm test` se salta lo que necesita PostgreSQL cuando no hay `DATABASE_URL`,
 * y eso está bien para quien solo quiere comprobar que el código compila. Pero
 * en integración continua ese mismo comportamiento es una trampa: el trabajo
 * sale verde, nadie mira, y lo que protege el dinero y el aislamiento entre
 * oficinas no llegó a correr. Ya pasó — una revisión externa contó ochenta y
 * tres pruebas donde hay casi trescientas, y la diferencia era exactamente esa.
 *
 * Así que esto es lo mismo que `npm test` con una condición: sin base, no
 * corre. Falla, y dice por qué.
 */
import { spawnSync } from 'node:child_process';

if ((process.env['DATABASE_URL'] ?? '').length === 0) {
  console.error(
    '\n' +
      '  ╭──────────────────────────────────────────────────────────────────╮\n' +
      '  │  ESTA SUITE EXIGE PostgreSQL                                     │\n' +
      '  │                                                                  │\n' +
      '  │  `npm run test:integration` NO se salta nada: o corre contra una │\n' +
      '  │  base de verdad, o falla. Ponga DATABASE_URL.                    │\n' +
      '  │                                                                  │\n' +
      '  │  Para lo que no necesita base: npm run test:unit                 │\n' +
      '  ╰──────────────────────────────────────────────────────────────────╯\n',
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', '--test-concurrency=1', 'tests/*.test.ts'],
  { stdio: 'inherit', shell: false, cwd: process.cwd() },
);
process.exit(result.status ?? 1);
