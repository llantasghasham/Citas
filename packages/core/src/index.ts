/**
 * Everything the web app and the mobile app must agree on: the domain types,
 * the four locale dictionaries, and how dates and numerals are formatted.
 *
 * Anything that depends on the browser, on Next, or on Tailwind class names
 * stays out of here — that is what keeps this package usable from React Native.
 */
export * from './types';
export * from './dictionary';
export * from './numerals';
export * from './datetime';
export * from './presets';
export * from './plural';
export * from './countries';
// El portal público del directorio: su propio conjunto de idiomas —con
// francés— y su propio diccionario, para no obligar a traducir el producto
// entero. Ver `directory-types.ts`.
export * from './directory-types';
export * from './directory-dictionary';
