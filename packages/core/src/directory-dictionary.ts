import ar from '../directory/ar.json';
import en from '../directory/en.json';
import es from '../directory/es.json';
import fr from '../directory/fr.json';
import pt from '../directory/pt.json';

import type { DirectoryDictionary, DirectoryLocale } from './directory-types';

/**
 * La anotación explícita `Record<DirectoryLocale, DirectoryDictionary>` es lo que
 * hace que TypeScript compruebe los CINCO archivos contra el tipo: una clave
 * que falte o esté mal escrita en cualquiera de ellos tumba el `typecheck`.
 *
 * Que el francés esté aquí y no en el diccionario del producto es la razón de
 * que este archivo exista. Ver `directory-types.ts`.
 */
const DIRECTORY: Record<DirectoryLocale, DirectoryDictionary> = { ar, en, fr, es, pt };

export function getDirectoryDictionary(locale: DirectoryLocale): DirectoryDictionary {
  return DIRECTORY[locale];
}
