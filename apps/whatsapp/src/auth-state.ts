import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';

import { decrypt, encrypt } from './crypto.js';
import { getConnection, saveAuth } from './db.js';

/**
 * Dónde vive la sesión de WhatsApp.
 *
 * Baileys trae `useMultiFileAuthState`, que la escribe en una carpeta. Aquí no
 * sirve por dos razones, y las dos importan:
 *
 * 1. Son CREDENCIALES: quien las tiene escribe desde el WhatsApp del cliente.
 *    En una carpeta están en claro. Aquí van cifradas con AES-256-GCM y la
 *    llave fuera de la base, igual que la contraseña del SMTP.
 * 2. El servidor se despliega copiando código. Una carpeta de sesiones se
 *    pierde en el primer despliegue y el cliente tiene que volver a escanear.
 *    En la base sobrevive.
 *
 * Se guarda TODO el estado en una fila y de una vez. Baileys escribe muchas
 * claves pequeñas y muy seguido, así que la escritura se agrupa: sin eso serían
 * decenas de UPDATE por minuto por número.
 */
type KeyStore = Record<string, Record<string, unknown>>;

interface StoredState {
  creds: AuthenticationCreds;
  keys: KeyStore;
}

export interface PersistentAuth {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

export async function useDatabaseAuthState(connectionId: string): Promise<PersistentAuth> {
  const row = await getConnection(connectionId);

  let stored: StoredState;
  try {
    stored =
      row?.authEnc === null || row?.authEnc === undefined
        ? { creds: initAuthCreds(), keys: {} }
        : (JSON.parse(decrypt(row.authEnc), BufferJSON.reviver) as StoredState);
  } catch {
    // Una sesión que no se puede descifrar es una sesión perdida: se empieza de
    // cero y el cliente vuelve a escanear. Es molesto; quedarse colgado lo es
    // más, y callarlo lo es todavía más.
    console.error(`[wa] la sesión de ${connectionId} no se pudo leer; se empieza de cero`);
    stored = { creds: initAuthCreds(), keys: {} };
  }

  const keys: KeyStore = stored.keys ?? {};

  // Agrupa las escrituras: muchas llegan seguidas y todas quieren guardar lo
  // mismo, la fila entera.
  let pending: Promise<void> | null = null;
  let again = false;

  const flush = async (): Promise<void> => {
    if (pending !== null) {
      again = true;
      return pending;
    }
    pending = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      do {
        again = false;
        await saveAuth(
          connectionId,
          encrypt(JSON.stringify({ creds: stored.creds, keys }, BufferJSON.replacer)),
        );
      } while (again);
    })().finally(() => {
      pending = null;
    });
    return pending;
  };

  return {
    state: {
      creds: stored.creds,
      keys: {
        get: (type, ids) => {
          const bucket = keys[type] ?? {};
          const found: { [id: string]: SignalDataTypeMap[typeof type] } = {};

          for (const id of ids) {
            let value = bucket[id];
            if (type === 'app-state-sync-key' && value !== undefined) {
              value = proto.Message.AppStateSyncKeyData.fromObject(
                value as Record<string, unknown>,
              );
            }
            if (value !== undefined) {
              found[id] = value as SignalDataTypeMap[typeof type];
            }
          }
          return found;
        },
        set: (data) => {
          for (const [type, entries] of Object.entries(data)) {
            keys[type] ??= {};
            for (const [id, value] of Object.entries(entries ?? {})) {
              // `null` significa borrar, no guardar un nulo.
              if (value === null || value === undefined) delete keys[type][id];
              else keys[type][id] = value;
            }
          }
          void flush();
        },
      },
    },
    saveCreds: flush,
  };
}
