import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'citas.session';

/**
 * The session token lives in the device keychain, never in plain storage: it is
 * the same credential a browser keeps in an httpOnly cookie.
 */
export async function readToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function writeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
