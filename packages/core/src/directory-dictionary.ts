import ar from '../directory/ar.json';
import en from '../directory/en.json';
import es from '../directory/es.json';
import pt from '../directory/pt.json';

import type { DirectoryDictionary, DirectoryLocale } from './directory-types';

/**
 * La anotación explícita `Record<DirectoryLocale, DirectoryDictionary>` es lo que
 * hace que TypeScript compruebe los CUATRO archivos contra el tipo: una clave
 * que falte o esté mal escrita en cualquiera de ellos tumba el `typecheck`.
 *
 * El diccionario del portal es OTRO que el del producto —lleva solo sus frases—
 * y por eso este archivo existe. Ver `directory-types.ts`.
 */
const DIRECTORY: Record<DirectoryLocale, DirectoryDictionary> = { ar, en, es, pt };

export function getDirectoryDictionary(locale: DirectoryLocale): DirectoryDictionary {
  return DIRECTORY[locale];
}
