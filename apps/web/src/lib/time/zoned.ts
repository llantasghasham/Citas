/**
 * Pasar de la hora de un reloj a un instante, y al revés.
 *
 * Aquí no hay ninguna biblioteca de fechas, y no hace falta: `Intl` ya trae la
 * base de datos de zonas del sistema, que es la misma que usaría cualquier
 * biblioteca y que se actualiza con Node. Lo que no trae es esta operación
 * concreta —«las nueve de la mañana en Beirut, ¿qué instante es?»— porque el
 * navegador solo sabe hacer la contraria.
 *
 * Por qué importa en este proyecto: una oficina en Costa Rica programa el envío
 * de una boda que se celebra en Beirut. Si «las 9:00» se interpretara con el
 * reloj del servidor, las invitaciones saldrían de madrugada. Y no vale restar
 * un número fijo de horas: el Líbano cambia la hora en verano y Costa Rica no.
 */

/**
 * Cuánto adelanta o atrasa una zona respecto a UTC en ESE instante.
 *
 * Se calcula preguntándole a `Intl` qué hora marca allí y comparándola con la
 * misma lectura tomada como si fuera UTC. Es el truco de siempre, y es exacto
 * porque quien conoce el horario de verano es la base de datos de zonas.
 */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    // `h23` y no `hour12: false`: con este último, algunos runtimes escriben la
    // medianoche como «24», y sumar 24 horas al calcular el desfase lo dejaría
    // un día entero desplazado.
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));

  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);

  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return asIfUtc - instant;
}

/**
 * «2026-03-03T09:00» en Asia/Beirut → el instante que es.
 *
 * Devuelve `null` si la cadena no es una hora de reloj o la zona no existe: un
 * envío programado a una fecha inventada tiene que rechazarse, no acabar en una
 * fila con `Invalid Date` que el servicio intente mandar para siempre.
 *
 * Las dos pasadas son por los cambios de hora. La primera corrige con el desfase
 * del instante equivocado; si al llegar al correcto el desfase es otro —porque
 * la fecha cae justo en el cambio de horario— se rehace con el bueno.
 */
export function zonedToUtc(wallClock: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(wallClock)) return null;

  const normalised = wallClock.replace(' ', 'T');
  const withSeconds = normalised.length === 16 ? `${normalised}:00` : normalised;
  const asUtc = Date.parse(`${withSeconds}Z`);
  if (Number.isNaN(asUtc)) return null;

  // Que la fecha EXISTA. `Date.parse` no rechaza un 30 de febrero: lo corre al
  // 2 de marzo y devuelve un número tan válido como cualquier otro. Un envío
  // programado saldría otro día distinto del que se escribió, sin un aviso.
  //
  // Se comprueba haciendo el camino de vuelta: si el día que sale no es el que
  // se pidió, es que no existía.
  const back = new Date(asUtc);
  const [datePart = '', timePart = ''] = withSeconds.split('T');
  const sameDay = back.toISOString().slice(0, 10) === datePart;
  const sameTime = back.toISOString().slice(11, 19) === timePart;
  if (!sameDay || !sameTime) return null;

  let offset: number;
  try {
    offset = offsetMs(asUtc, timeZone);
  } catch {
    return null;
  }

  const first = asUtc - offset;
  const second = offsetMs(first, timeZone);
  const instant = second === offset ? first : asUtc - second;

  return new Date(instant);
}

/**
 * Lo contrario, para volver a poner en el formulario lo que ya había guardado:
 * un instante en la cadena `YYYY-MM-DDTHH:mm` que entiende `datetime-local`.
 */
export function utcToZoned(instant: Date, timeZone: string): string {
  const offset = offsetMs(instant.getTime(), timeZone);
  return new Date(instant.getTime() + offset).toISOString().slice(0, 16);
}

/**
 * Que la fecha EXISTA en el calendario, no solo que tenga la forma.
 *
 * `^\d{4}-\d{2}-\d{2}$` deja pasar el 30 de febrero, el 31 de abril y el 29
 * de febrero de un año que no es bisiesto. Y lo que viene después no protesta:
 * `new Date('2026-02-30')` devuelve el 2 de marzo, así que la invitación se
 * publicaba con una fecha, el `.ics` llevaba otra y nadie veía el salto.
 *
 * La comprobación es el camino de vuelta: se arma la fecha y se mira si los
 * tres números siguen siendo los mismos. Si el mes se corrió, no existía.
 */
export function isCalendarDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const built = new Date(Date.UTC(year, month - 1, day));
  return (
    built.getUTCFullYear() === year &&
    built.getUTCMonth() === month - 1 &&
    built.getUTCDate() === day
  );
}

/** Una hora de reloj de veinticuatro horas: `19:00`, nunca `25:61`. */
export function isClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
