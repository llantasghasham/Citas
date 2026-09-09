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

async function gatewayUrl(): Promise<string> {
  return (await setting('WHATSAPP_GATEWAY_URL')) ?? 'http://127.0.0.1:4100';
}

async function call(path: string, method: string): Promise<GatewayResult> {
  const token = process.env['WHATSAPP_GATEWAY_TOKEN'];
  if (token === undefined || token.length === 0) {
    // El token va por entorno y no por la tabla `Setting`: lo comparten dos
    // procesos que arrancan por separado, y guardarlo donde lo lee uno solo
    // sería guardarlo en el sitio equivocado.
    return { ok: false, reason: 'Falta WHATSAPP_GATEWAY_TOKEN en el servidor.' };
  }

  try {
    const response = await fetch(`${await gatewayUrl()}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
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

export function startConnection(id: string): Promise<GatewayResult> {
  return call(`/connections/${id}/start`, 'POST');
}

export function logoutConnection(id: string): Promise<GatewayResult> {
  return call(`/connections/${id}/logout`, 'POST');
}

/** Para `/panel/sistema`: si contesta, está vivo. */
export async function gatewayHealth(): Promise<{ up: boolean; detail: string }> {
  const token = process.env['WHATSAPP_GATEWAY_TOKEN'];
  if (token === undefined || token.length === 0) {
    return { up: false, detail: 'WHATSAPP_GATEWAY_TOKEN' };
  }

  try {
    const response = await fetch(`${await gatewayUrl()}/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return { up: false, detail: `HTTP ${response.status}` };

    const body = (await response.json()) as { total?: number; up?: number };
    return { up: true, detail: `${body.up ?? 0}/${body.total ?? 0}` };
  } catch {
    return { up: false, detail: 'no responde' };
  }
}
