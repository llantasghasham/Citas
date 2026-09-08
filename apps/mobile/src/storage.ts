import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'citas.session';

/**
 * Where the session token lives.
 *
 * On a phone it goes in the device keychain — it is the same credential a
 * browser keeps in an httpOnly cookie, and it must not sit in plain storage.
 * `expo-secure-store` has no web implementation, so the web build falls back to
 * `localStorage`; that is weaker (a script on the page can read it), which is
 * why on a desktop the browser panel with its httpOnly cookie stays the
 * recommended way in.
 */
const isWeb = Platform.OS === 'web';

export async function readToken(): Promise<string | null> {
  try {
    if (isWeb) return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function writeToken(token: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.removeItem(TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
