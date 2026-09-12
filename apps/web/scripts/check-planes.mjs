#!/usr/bin/env node
/**
 * Guarda la frontera entre los dos planos. Se ejecuta con `npm run lint:planes`.
 *
 * Cada oficina tiene su propia base de datos. Lo que impide que una vea a otra
 * es que están en bases distintas del servidor — pero eso solo vale si cada
 * consulta va a la base que le toca. Una consulta de negocio escrita contra
 * `controlDb()` no da error: escribe en la base del arrendador, donde están
 * todas las oficinas, y ahí el aislamiento vuelve a depender de que nadie se
 * olvide un `where`. Que es exactamente de lo que veníamos.
 *
 * Así que la regla se comprueba sola, como la del CSS lógico:
 *
 *   - Lo que es trabajo de una oficina  →  db(scope)
 *   - Lo que es del arrendador          →  controlDb()
 *
 * No es un análisis de tipos: sigue las variables que salen de `db(...)` y de
 * `controlDb()` dentro de cada archivo, y las de `$transaction`, que heredan el
 * plano de quien la abre. Es tosco a propósito — atrapa el descuido de escribir
 * `controlDb().event`, que es el que de verdad pasa.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOTS = ['src', 'scripts'];
const EXTENSIONS = new Set(['.ts', '.tsx']);

/** Lo del arrendador: el registro, las personas, el dinero y la configuración. */
const CONTROL = new Set([
  'tenant', 'user', 'membership', 'session', 'loginCode',
  'plan', 'subscription', 'order', 'payment', 'paymentEvent',
  'sinpeAccount', 'sinpeMovement', 'setting', 'brandAsset', 'auditLog',
  'publicSlug', 'guestToken',
  // El directorio. Va en CONTROL porque es global —se busca por región, no por
  // oficina— y con una base por oficina ninguna de ellas podría servir un
  // listado que las cruza a todas.
  'provider', 'providerTranslation', 'providerMembership', 'providerCategoryLink',
  'providerContact', 'providerMedia', 'providerReview', 'providerReport',
]);

/** Lo de la oficina: su trabajo. */
const TENANT = new Set([
  'event', 'eventHost', 'eventHonoree', 'invitationVersion', 'render',
  'guest', 'table', 'rsvp', 'whatsappConnection', 'whatsappMessage',
  'eventAct', 'actTranslation', 'audienceSegment', 'guestSegment',
  'actAudience', 'guestActInvite', 'guestActRsvp',
  'consent', 'optOut', 'messageCampaign', 'messageRecipient',
  'checkIn', 'guestPreference', 'invitationVisit',
]);

/**
 * Los dos sitios que cruzan la frontera a propósito, y por qué.
 *
 * Se nombran uno a uno: una lista de excepciones que crece sin que nadie tenga
 * que justificarlas deja de ser una lista de excepciones.
 */
const CROSSES_ON_PURPOSE = new Map([
  [
    'src/lib/db/directory.ts',
    'el respaldo del directorio mientras el reparto sea «shared»: sin entrada apuntada, ' +
      'busca donde se buscaba, que entonces es la misma base',
  ],
  [
    'scripts/split.ts',
    'es el guion que MUEVE las filas: tiene que leer de la común lo que va a escribir en la propia',
  ],
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'generated' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (EXTENSIONS.has(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

/** Qué plano tiene cada variable de este archivo. */
function planesOf(source) {
  const planes = new Map();

  // const X = controlDb()  /  const X = db(scope)
  for (const match of source.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*(controlDb|db)\s*\(/g)) {
    planes.set(match[1], match[2] === 'controlDb' ? 'control' : 'tenant');
  }
  // X.$transaction(async (tx) => …  — la transacción es del mismo cliente
  for (const match of source.matchAll(/\b(\w+)\.\$transaction\(\s*async\s*\(\s*(\w+)/g)) {
    const plane = planes.get(match[1]);
    if (plane !== undefined) planes.set(match[2], plane);
  }
  return planes;
}

function check(file) {
  const source = readFileSync(file, 'utf8');
  const relativePath = relative(process.cwd(), file).replaceAll('\\', '/');
  if (CROSSES_ON_PURPOSE.has(relativePath)) return [];

  const planes = planesOf(source);
  const problems = [];
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    // Directo: controlDb().event  /  db(scope).order
    for (const match of line.matchAll(/\b(controlDb|db)\s*\([^)]*\)\.(\w+)\b/g)) {
      const plane = match[1] === 'controlDb' ? 'control' : 'tenant';
      problems.push(...verdict(plane, match[2], relativePath, index + 1, line));
    }
    // Por variable: prisma.event, tx.order…
    for (const match of line.matchAll(/\b(\w+)\.(\w+)\b/g)) {
      const plane = planes.get(match[1]);
      if (plane === undefined) continue;
      problems.push(...verdict(plane, match[2], relativePath, index + 1, line));
    }
  });

  return problems;
}

function verdict(plane, model, file, lineNumber, line) {
  if (plane === 'control' && TENANT.has(model)) {
    return [
      {
        file,
        lineNumber,
        line: line.trim(),
        why: `«${model}» es trabajo de la oficina y va en SU base: use db(scope), no controlDb()`,
      },
    ];
  }
  if (plane === 'tenant' && CONTROL.has(model)) {
    return [
      {
        file,
        lineNumber,
        line: line.trim(),
        why: `«${model}» es del arrendador y vive en la base de control: use controlDb(), no db(scope)`,
      },
    ];
  }
  return [];
}

const files = ROOTS.flatMap((root) => walk(root));
const problems = files.flatMap((file) => check(file));

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`${problem.file}:${problem.lineNumber}  ${problem.why}`);
    console.error(`    ${problem.line}`);
  }
  console.error(`\nlint:planes — ${problems.length} consulta(s) en la base equivocada.`);
  process.exit(1);
}

console.log(
  `lint:planes — ${files.length} archivos, cada consulta en su base ` +
    `(${CROSSES_ON_PURPOSE.size} excepciones, nombradas y justificadas).`,
);
