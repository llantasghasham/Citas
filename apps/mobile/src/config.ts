/**
 * Where the app talks to. `EXPO_PUBLIC_API_URL` is read at build time by Expo,
 * so a build for an office points at that office's own subdomain.
 */
export const API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';
