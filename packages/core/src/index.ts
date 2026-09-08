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
