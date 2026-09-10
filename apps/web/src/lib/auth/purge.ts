import { getPrisma } from '@/lib/db/client';

/**
 * Tira las sesiones caducadas y los códigos gastados.
 *
 * No es limpieza por gusto. Una fila de `Session` guarda la IP y el navegador
 * de quien entró, y una sesión dura treinta días: pasado ese plazo la fila ya
 * no sirve para nada y lo único que sigue haciendo es guardar desde dónde se
 * conectó una persona. Un dato que ya no hace falta y que nadie borra es un
 * dato que solo puede filtrarse.
 *
 * `resolveSession` ya borra la caducada que se encuentra por el camino, pero
 * solo esa: la de alguien que no vuelve a entrar se queda para siempre.
 */
export interface PurgeSummary {
  sessions: number;
  codes: number;
}

/** Margen tras la caducidad, para no borrar mientras alguien la está usando. */
const GRACE_DAYS = 1;

export async function purgeExpired(): Promise<PurgeSummary> {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000);

  const [sessions, codes] = await Promise.all([
    prisma.session.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    // Un código vive diez minutos; guardarlos es guardar quién pidió entrar y
    // cuándo, y para eso ya está el historial.
    prisma.loginCode.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
  ]);

  return { sessions: sessions.count, codes: codes.count };
}
