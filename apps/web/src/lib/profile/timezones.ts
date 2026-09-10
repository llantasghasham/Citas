/**
 * Las zonas horarias que conoce este runtime.
 *
 * No hay lista escrita a mano: `Intl` ya trae la base de datos de zonas, y esa
 * se actualiza con Node. Una lista propia sería una copia que envejece cada vez
 * que un país mueve su horario de verano.
 *
 * Se calcula una vez por proceso: son cuatrocientas y pico y recorrerlas en
 * cada carga de pantalla no aporta nada.
 */
let zones: readonly string[] | null = null;

export function timezones(): readonly string[] {
  zones ??= Intl.supportedValuesOf('timeZone');
  return zones;
}

export function isTimezone(candidate: string): boolean {
  return timezones().includes(candidate);
}

/**
 * Lo que marca el reloj ahí ahora mismo, para que elegir no sea adivinar.
 *
 * «Asia/Beirut» no le dice nada a nadie; «Asia/Beirut · 14:05» sí.
 */
export function nowIn(zone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      // Los cuatro idiomas se leen mejor con la hora en cifras latinas: es un
      // reloj, no un texto.
      numberingSystem: 'latn',
    }).format(new Date());
  } catch {
    return '';
  }
}
