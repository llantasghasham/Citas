import versesFile from '../../data/verses.json';

import { asArray, asEnum, asOptionalString, asRecord, asString } from './validate';
import { LOCALES, type Locale, type Quote } from './types';

export interface Verse extends Quote {
  id: string;
  locale: Locale;
  tradition: string;
  /**
   * Who checked this text against the edition it cites. Null means nobody has,
   * which is a fact about the file and never something to paper over: the rule
   * is that an entry is added only after a person verifies it.
   */
  verifiedBy: string | null;
}

/**
 * Religious texts are read from a fixed, human-verified list and never
 * generated, completed or corrected at runtime. A quote whose id is absent from
 * data/verses.json is simply not rendered — see the `_policy` note in that file.
 */
function parseVerses(): Map<string, Verse> {
  const root = asRecord(versesFile, 'verses.json');
  const entries = asArray(root['verses'], 'verses.json#/verses');
  const byId = new Map<string, Verse>();

  entries.forEach((entry, index) => {
    const path = `verses.json#/verses/${index}`;
    const record = asRecord(entry, path);
    const verse: Verse = {
      id: asString(record['id'], `${path}/id`),
      locale: asEnum(record['locale'], LOCALES, `${path}/locale`),
      tradition: asString(record['tradition'], `${path}/tradition`),
      text: asString(record['text'], `${path}/text`),
      source: asString(record['source'], `${path}/source`),
      verifiedBy: asOptionalString(record['verifiedBy'], `${path}/verifiedBy`) ?? null,
    };
    byId.set(verse.id, verse);
  });

  return byId;
}

const VERSES = parseVerses();

/**
 * Un versículo SIN verificar no existe para el resto del programa.
 *
 * La regla del proyecto siempre dijo que una entrada solo se añade tras
 * verificación humana contra la edición citada, anotando el nombre en
 * `verifiedBy`. Pero eso no lo aplicaba nadie: `unverifiedVerses()` los contaba
 * para la pantalla de salud y los marcaba en rojo, mientras `findVerse` y
 * `listVerses` los devolvían igual. O sea que se ofrecían al crear una
 * invitación y se imprimían en la de un invitado, con un aviso en una pantalla
 * que ve una sola persona.
 *
 * Un versículo coránico mal citado en la invitación de una boda no es una errata
 * que arregle el despliegue siguiente: ya se reenvió al grupo de WhatsApp de la
 * familia. Así que el filtro va aquí, en la puerta, y no en cada sitio que los
 * pinta — que es donde un día se olvidaría.
 *
 * La comprobación de `/panel/sistema` sigue viéndolos, porque para eso existe:
 * lee el mapa entero, no esta puerta.
 */
function isVerified(verse: Verse): boolean {
  return verse.verifiedBy !== null && verse.verifiedBy.trim().length > 0;
}

export function findVerse(id: string): Verse | undefined {
  const verse = VERSES.get(id);
  return verse !== undefined && isVerified(verse) ? verse : undefined;
}

/**
 * Los textos sagrados que nadie ha comprobado todavía.
 *
 * No se muestran —eso lo impide `findVerse`— pero la plataforma tiene que
 * decirlo en grande igualmente: mientras estén así, el proyecto tiene una lista
 * de versículos que no puede usar, y eso es una tarea pendiente de una persona,
 * no un estado en el que quedarse.
 */
export function unverifiedVerses(): Verse[] {
  return [...VERSES.values()].filter((verse) => !isVerified(verse));
}

/** The verses offered for a language. Nothing outside this list can be chosen. */
export function listVerses(locale: Locale): Verse[] {
  return [...VERSES.values()].filter((verse) => verse.locale === locale && isVerified(verse));
}
