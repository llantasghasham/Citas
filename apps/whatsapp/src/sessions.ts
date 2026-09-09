import { Boom } from '@hapi/boom';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

import { useDatabaseAuthState } from './auth-state.js';
import { readConfig } from './config.js';
import { clearQr, forgetAuth, getConnection, setStatus } from './db.js';

/**
 * Las sesiones vivas, una por número.
 *
 * MULTI-NÚMERO de verdad: cada conexión es su propio socket, su propio estado y
 * su propio cupo. Nada se comparte entre dos números, y menos entre dos
 * oficinas: la única forma de tocar una sesión es por su id, que sale de una
 * consulta ya filtrada por oficina en la web.
 *
 * Un socket de WhatsApp es una conexión larga, así que esto NO puede vivir
 * dentro de Next: una petición termina, un socket no. Por eso este proceso.
 */
const sockets = new Map<string, WASocket>();
/** Cuántas veces seguidas se ha reintentado, para no reconectar en bucle. */
const retries = new Map<string, number>();

export function socketFor(connectionId: string): WASocket | undefined {
  return sockets.get(connectionId);
}

export function isUp(connectionId: string): boolean {
  return sockets.has(connectionId);
}

/**
 * Abre (o reabre) la sesión de un número.
 *
 * Si hay credenciales guardadas se reconecta solo y nadie escanea nada. Si no
 * las hay, WhatsApp manda un QR y se guarda en la fila para que la pantalla lo
 * enseñe: es lo que el cliente escanea desde su teléfono.
 */
export async function startSession(connectionId: string): Promise<void> {
  if (sockets.has(connectionId)) return;

  const row = await getConnection(connectionId);
  if (row === undefined) throw new Error(`No existe la conexión ${connectionId}.`);

  const { state, saveCreds } = await useDatabaseAuthState(connectionId);

  // Preguntar la versión sale a la red. Si esa salida está cerrada —un servidor
  // sin permiso para hablar con WhatsApp es el caso más común de todos— NO se
  // puede fallar en silencio: la oficina pulsa «conectar», no pasa nada, y no
  // hay forma de saber por qué. Se anota y se sigue con la última conocida.
  let version: [number, number, number] | undefined;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch (error) {
    await setStatus(connectionId, 'disconnected', {
      lastError: `No se pudo hablar con WhatsApp: ${describe(error)}`,
    });
    throw error;
  }

  const socket = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      // La caché delante del almacén: sin ella, cada mensaje son varias
      // lecturas de la base.
      keys: makeCacheableSignalKeyStore(state.keys),
    },
    // El QR se enseña en la pantalla del panel, no en una terminal que nadie
    // mira: este proceso corre como servicio.
    printQRInTerminal: false,
    browser: Browsers.appropriate('Desktop'),
    markOnlineOnConnect: false,
    // Estar «en línea» todo el día en un número que también usa una persona le
    // roba las notificaciones al teléfono. Esto no es un bot de atención.
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
  });

  sockets.set(connectionId, socket);
  socket.ev.on('creds.update', () => void saveCreds());

  socket.ev.on('connection.update', (update) => {
    // Lo que reviente aquí dentro se traga la promesa si no se recoge, y lo que
    // queda es una pantalla que no dice nada.
    void handleUpdate(connectionId, socket, update).catch(async (error: unknown) => {
      console.error(`[wa] ${connectionId}: ${describe(error)}`);
      await setStatus(connectionId, 'disconnected', { lastError: describe(error) });
    });
  });

  // WhatsApp manda el código en los primeros segundos. Si no llega ninguno y
  // tampoco se conecta, algo está cortado por en medio y hay que decirlo.
  setTimeout(() => {
    void (async () => {
      const now = await getConnection(connectionId);
      if (now?.status === 'pending' || now?.status === 'disconnected') {
        await setStatus(connectionId, 'disconnected', {
          lastError:
            'WhatsApp no respondió. Compruebe que el servidor puede salir a web.whatsapp.com.',
        });
      }
    })();
  }, 25_000);
}

/** El mensaje de un error, sea lo que sea lo que se lanzó. */
function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

/** Lo que Baileys manda en `connection.update`, con lo que aquí se mira. */
type ConnectionUpdate = Partial<{
  connection: string;
  lastDisconnect: { error?: Error | undefined } | undefined;
  qr: string;
}>;

async function handleUpdate(
  connectionId: string,
  socket: WASocket,
  update: ConnectionUpdate,
): Promise<void> {
  const { connection, lastDisconnect, qr } = update;

  if (qr !== undefined) {
    // Se guarda ya dibujado, como data URI: la pantalla del panel no lleva
    // JavaScript de cliente, así que no puede dibujarlo ella.
    const image = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
    await setStatus(connectionId, 'qr', { qrCode: image });
    return;
  }

  if (connection === 'open') {
    retries.delete(connectionId);
    // El número real, tal como lo dice WhatsApp: no se le pide a nadie que lo
    // escriba, porque escribirlo mal es escribirle a otra persona.
    const jid = socket.user?.id ?? '';
    const phone = jid.split(':')[0]?.split('@')[0] ?? null;

    await setStatus(connectionId, 'connected', { phone, lastError: null });
    await clearQr(connectionId);
    console.log(`[wa] ${connectionId} conectado como ${phone ?? '?'}`);
    return;
  }

  if (connection !== 'close') return;

  sockets.delete(connectionId);
  const status = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;

  if (status === DisconnectReason.loggedOut) {
    // Cerraron sesión desde el teléfono. Las credenciales ya no valen y
    // reintentar con ellas es pedirle a WhatsApp que bloquee el número.
    await forgetAuth(connectionId);
    console.log(`[wa] ${connectionId}: cerraron la sesión desde el teléfono`);
    return;
  }

  const attempt = (retries.get(connectionId) ?? 0) + 1;
  retries.set(connectionId, attempt);

  if (attempt > 5) {
    await setStatus(connectionId, 'disconnected', {
      lastError: `No se pudo reconectar tras ${attempt - 1} intentos (código ${status ?? '?'}).`,
    });
    console.error(`[wa] ${connectionId}: se deja de reintentar`);
    return;
  }

  await setStatus(connectionId, 'disconnected', {
    lastError: `Desconectado (código ${status ?? '?'}). Reintento ${attempt}.`,
  });

  // Espera creciente: reconectar a lo loco es lo que hace que WhatsApp cierre
  // la puerta del todo.
  const wait = Math.min(60, 2 ** attempt) * 1000;
  setTimeout(() => void startSession(connectionId).catch(() => undefined), wait);
}

/** Cierra la sesión y olvida las credenciales. Habrá que volver a escanear. */
export async function logoutSession(connectionId: string): Promise<void> {
  const socket = sockets.get(connectionId);
  sockets.delete(connectionId);
  retries.delete(connectionId);

  try {
    await socket?.logout();
  } catch {
    // Puede estar ya caída. Lo que importa es olvidar las credenciales.
  }
  await forgetAuth(connectionId);
}

/**
 * Reabre al arrancar todas las que tenían sesión.
 *
 * Sin esto, cada reinicio del servidor obligaría a cada oficina a volver a
 * escanear, que es justo lo que la sesión guardada evita.
 */
export async function resumeAll(rows: { id: string; authEnc: string | null }[]): Promise<void> {
  const withSession = rows.filter((row) => row.authEnc !== null);
  console.log(`[wa] reanudando ${withSession.length} sesiones`);

  for (const row of withSession) {
    try {
      await startSession(row.id);
    } catch (error) {
      console.error(`[wa] no se pudo reanudar ${row.id}: ${String(error)}`);
    }
    // De una en una y con pausa: veinte sockets a la vez contra WhatsApp
    // parecen exactamente lo que no queremos parecer.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

/** El destino tal y como lo quiere WhatsApp, desde un E.164. */
export function toJid(e164: string): string {
  return `${e164.replace(/\D/g, '')}@s.whatsapp.net`;
}

export { readConfig };
