import { controlDb } from '@/lib/db/client';
import { COUNTRIES } from '@citas/core';

/**
 * Con qué reloj lee las horas la persona que está mirando.
 *
 * El mismo orden en todas partes: la zona que eligió en su perfil, si no la del
 * país que maneja, si no la del servidor. Estaba escrito tres veces —en el
 * perfil, en la ficha del evento y en la acción de encolar— y tres copias de
 * una regla son tres sitios donde puede dejar de coincidir.
 */
export async function actorTimezone(session: {
  userId: string;
  country: string | null;
}): Promise<string> {
  const user = await controlDb().user.findUnique({
    where: { id: session.userId },
    select: { timezone: true },
  });
  if (user?.timezone != null && user.timezone.length > 0) return user.timezone;

  const country = COUNTRIES.find((entry) => entry.code === session.country);
  return country?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}
