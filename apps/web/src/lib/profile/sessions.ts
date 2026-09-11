import { controlDb } from '@/lib/db/client';

/**
 * Las sesiones abiertas de una persona, para que pueda cerrarlas.
 *
 * Esto no es un adorno de pantalla de perfil. Un token de sesión de este
 * sistema dura treinta días; si alguien entró desde el ordenador de un locutorio
 * o desde un teléfono que ya no tiene, la única forma de echarlo era esperar un
 * mes o abrir la base de datos. Poder verlas y cerrarlas es lo que convierte un
 * «creo que dejé la sesión abierta» en algo que se arregla en dos segundos.
 */
export interface SessionRow {
  id: string;
  /** El aparato, tal como se puede adivinar del `User-Agent`. */
  device: string;
  ip: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  /** Esta es la sesión desde la que se está mirando la pantalla. */
  current: boolean;
}

export async function listSessions(
  userId: string,
  currentSessionId: string,
): Promise<SessionRow[]> {
  const rows = await controlDb().session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, userAgent: true, ip: true, createdAt: true, lastSeenAt: true },
    orderBy: { lastSeenAt: 'desc' },
  });

  return rows.map((row) => ({
    id: row.id,
    device: describeDevice(row.userAgent),
    ip: row.ip,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    current: row.id === currentSessionId,
  }));
}

/** Cierra una, y solo si es de esta persona. El id viene del formulario. */
export async function closeSession(userId: string, sessionId: string): Promise<void> {
  await controlDb().session.deleteMany({ where: { id: sessionId, userId } });
}

/** Cierra TODAS menos esta. Lo que se pulsa cuando algo huele mal. */
export async function closeOtherSessions(
  userId: string,
  keepSessionId: string,
): Promise<number> {
  const { count } = await controlDb().session.deleteMany({
    where: { userId, id: { not: keepSessionId } },
  });
  return count;
}

/**
 * Un nombre legible del aparato.
 *
 * A propósito corto y a propósito aproximado: aquí no se persigue identificar
 * un navegador, sino que quien mira la lista reconozca cuál de las filas es su
 * teléfono. La cadena entera no se enseña nunca — es ruido, y es larga.
 */
function describeDevice(userAgent: string | null): string {
  if (userAgent === null || userAgent.trim().length === 0) return '—';

  const ua = userAgent;
  // La app móvil se presenta ella misma; no hay que adivinar nada.
  if (/citas/i.test(ua)) return 'Citas · app';

  const system =
    /iPhone/i.test(ua) ? 'iPhone'
    : /iPad/i.test(ua) ? 'iPad'
    : /Android/i.test(ua) ? 'Android'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'Mac'
    : /Linux/i.test(ua) ? 'Linux'
    : null;

  // El orden importa: Edge y Chrome se declaran Safari, y Chrome se declara
  // Edge no; mirar primero al más mentiroso da la respuesta correcta.
  const browser =
    /Edg\//i.test(ua) ? 'Edge'
    : /OPR\//i.test(ua) ? 'Opera'
    : /Chrome\//i.test(ua) ? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Safari\//i.test(ua) ? 'Safari'
    : null;

  const parts = [system, browser].filter((part): part is string => part !== null);
  return parts.length === 0 ? '—' : parts.join(' · ');
}
