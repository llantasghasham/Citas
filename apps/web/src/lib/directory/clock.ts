/**
 * El reloj de las veinticuatro horas HÁBILES.
 *
 * La promesa de la moderación no se mide en horas de reloj: un perfil mandado
 * un viernes por la tarde no está atrasado el sábado por la mañana. Y medirlo
 * en horas de reloj tiene la consecuencia contraria a la que se busca — la
 * pantalla se llenaría de rojo cada lunes y el rojo dejaría de significar nada,
 * que es exactamente lo que le pasa a una alarma que salta siempre.
 *
 * LAS TRES DECISIONES, dichas aquí porque no son del código y alguien las tiene
 * que poder cambiar:
 *
 *   · La semana laboral es de LUNES A VIERNES. En Líbano el fin de semana es
 *     sábado y domingo.
 *   · La jornada va de las 9:00 a las 17:00, ocho horas.
 *   · Y no hay días festivos. Meter un calendario de fiestas del Líbano sería
 *     una lista que envejece sola y que nadie va a mantener; el efecto de no
 *     tenerla es que un perfil mandado la víspera de una fiesta se marca en rojo
 *     un día antes de lo justo, y eso se arregla mirándolo, que es lo que hay
 *     que hacer de todas formas.
 *
 * Así que veinticuatro horas hábiles son TRES jornadas. Todo se calcula en la
 * zona de la plataforma, no en la de quien mira: el plazo es una promesa de
 * quien modera, y quien modera está donde está.
 */

export const REVIEW_ZONE = 'Asia/Beirut';
export const DAY_STARTS = 9;
export const DAY_ENDS = 17;
export const REVIEW_BUDGET_HOURS = 24;

/** El día de la semana y la hora decimal que marca ese reloj en esa zona. */
function readClock(instant: Date, timeZone: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);

  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value('weekday'));
  const hour = Number(value('hour')) + Number(value('minute')) / 60;

  return { weekday, hour };
}

const HOUR = 60 * 60 * 1000;

/**
 * Cuántas horas hábiles han pasado entre dos instantes.
 *
 * Se cuenta a saltos de un cuarto de hora y no con una fórmula cerrada. La
 * fórmula existe —días completos por ocho, más los dos extremos— y es donde se
 * cuelan los errores de un día: el sábado, el cambio de hora y el caso de
 * empezar y terminar la misma tarde. Un bucle sobre un plazo que se mide en días
 * cuesta unos cientos de sumas y no se equivoca.
 */
export function businessHoursBetween(from: Date, to: Date, timeZone = REVIEW_ZONE): number {
  if (to.getTime() <= from.getTime()) return 0;

  // Un cuarto de hora: fino de sobra para un plazo que se mide en días, y
  // barato — tres jornadas son menos de trescientas vueltas.
  const step = HOUR / 4;
  let contadas = 0;
  for (let t = from.getTime(); t < to.getTime(); t += step) {
    const { weekday, hour } = readClock(new Date(t), timeZone);
    // Sábado y domingo no cuentan.
    if (weekday === 0 || weekday === 6) continue;
    if (hour < DAY_STARTS || hour >= DAY_ENDS) continue;
    contadas += step / HOUR;
  }
  return Math.round(contadas * 100) / 100;
}

/** ¿Se pasó del plazo? */
export function isOverdue(submittedAt: Date, now = new Date()): boolean {
  return businessHoursBetween(submittedAt, now) >= REVIEW_BUDGET_HOURS;
}

/** Lo que queda, en horas hábiles. Cero cuando ya se pasó. */
export function hoursLeft(submittedAt: Date, now = new Date()): number {
  const usadas = businessHoursBetween(submittedAt, now);
  return Math.max(0, Math.round((REVIEW_BUDGET_HOURS - usadas) * 10) / 10);
}
