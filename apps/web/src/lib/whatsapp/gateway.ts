import { setting } from '@/lib/settings';

/**
 * La web hablándole al servicio de WhatsApp.
 *
 * Solo dos órdenes: abre la sesión, ciérrala. Mandar mensajes NO está aquí a
 * propósito — la web encola filas y el servicio las suelta con su freno. Un
 * extremo que manda al momento es un extremo con el que se vacía el cupo de un
 * número en un bucle, y el número que se pierde sería el del cliente.
 *
 * Si el servicio no está levantado, esto falla claro y la pantalla lo dice. No
 * pasa nada grave: `wa.me` sigue funcionando y es lo que se usaba antes.
 */
export interface GatewayResult {
  ok: boolean;
  /** Lo que se le enseña a quien mira la pantalla cuando falla. */
  reason?: string;
}

const DEFAULT_URL = 'http://127.0.0.1:4100';

/**
 * Direcciones a las que se puede llamar. La del bucle local, siempre.
 *
 * Esto existe porque el token que viaja en la cabecera controla TODOS los
 * números de TODAS las oficinas, y la dirección se edita desde el panel. Sin
 * este filtro, cambiar un campo de texto convertía el servidor en un ariete:
 * una petición saliente a donde quisiera el atacante, con el token dentro.
 *
 * Quien de verdad tenga el servicio en otra máquina lo declara en el ENTORNO,
 * que es un archivo en el disco con permisos, no una fila de la base. Dicho
 * corto: el panel puede cambiar el puerto, no la máquina.
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function allowedHosts(): Set<string> {
  const extra = (process.env['WHATSAPP_GATEWAY_HOST'] ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return new Set([...LOOPBACK, ...extra]);
}

/** La dirección guardada, si pasa el filtro. Si no, la de fábrica. */
export async function gatewayUrl(): Promise<{ url: string; refused?: string }> {
  const raw = (await setting('WHATSAPP_GATEWAY_URL'))?.trim();
  if (raw === undefined || raw.length === 0) return { url: DEFAULT_URL };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { url: DEFAULT_URL, refused: raw };
  }

  // Solo http/https —`file:` y demás no tienen nada que hacer aquí— y solo un
  // destino permitido.
  const scheme = parsed.protocol === 'http:' || parsed.protocol === 'https:';
  if (!scheme || !allowedHosts().has(parsed.hostname.toLowerCase())) {
    return { url: DEFAULT_URL, refused: raw };
  }
  return { url: parsed.origin };
}

async function call(path: string, method: string): Promise<GatewayResult> {
  const token = process.env['WHATSAPP_GATEWAY_TOKEN'];
  if (token === undefined || token.length === 0) {
    // El token va por entorno y no por la tabla `Setting`: lo comparten dos
    // procesos que arrancan por separado, y guardarlo donde lo lee uno solo
    // sería guardarlo en el sitio equivocado.
    return { ok: false, reason: 'Falta WHATSAPP_GATEWAY_TOKEN en el servidor.' };
  }

  const target = await gatewayUrl();
  if (target.refused !== undefined) {
    return {
      ok: false,
      reason:
        'La dirección del servicio de WhatsApp no está permitida. Solo el bucle local, ' +
        'o lo que declare WHATSAPP_GATEWAY_HOST en el entorno.',
    };
  }

  try {
    const response = await fetch(`${target.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
      // Una redirección se la llevaría el token a donde apunte el `Location`,
      // que es el mismo problema por otra puerta.
      redirect: 'error',
      // El servicio abre un socket contra WhatsApp: puede tardar unos segundos.
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      // El servicio explica por qué cuando puede; se le hace caso antes que al
      // código de estado, que solo dice que algo fue mal.
      const body = (await response.json().catch(() => ({}))) as { reason?: string };
      return {
        ok: false,
        reason: body.reason ?? `El servicio respondió ${response.status}.`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'El servicio de WhatsApp no respondió a tiempo.'
          : 'No se pudo hablar con el servicio de WhatsApp. ¿Está levantado?',
    };
  }
}

// El id se codifica: viaja dentro de la ruta, y uno con `../` dentro llamaría
// a un extremo distinto del que dice este código.
export function startConnection(id: string): Promise<GatewayResult> {
  return call(`/connections/${encodeURIComponent(id)}/start`, 'POST');
}

export function logoutConnection(id: string): Promise<GatewayResult> {
  return call(`/connections/${encodeURIComponent(id)}/logout`, 'POST');
}

/** Para `/panel/sistema`: si contesta, está vivo. */
export async function gatewayHealth(): Promise<{ up: boolean; detail: string }> {
  const token = process.env['WHATSAPP_GATEWAY_TOKEN'];
  if (token === undefined || token.length === 0) {
    return { up: false, detail: 'WHATSAPP_GATEWAY_TOKEN' };
  }

  const target = await gatewayUrl();
  if (target.refused !== undefined) return { up: false, detail: 'dirección no permitida' };

  try {
    const response = await fetch(`${target.url}/health`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return { up: false, detail: `HTTP ${response.status}` };

    const body = (await response.json()) as { total?: number; up?: number };
    return { up: true, detail: `${body.up ?? 0}/${body.total ?? 0}` };
  } catch {
    return { up: false, detail: 'no responde' };
  }
}
