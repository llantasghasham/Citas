'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { Role } from '@/generated/prisma/enums';
import { recordAudit } from '@/lib/audit';
import { getSession, scopeOf, sessionCan } from '@/lib/auth/session';
import { updateMember } from '@/lib/repositories/tenants';
import { COUNTRIES, LOCALES } from '@citas/core';

/** Los tres que se pueden repartir. SUPERADMIN no sale de una membresía. */
const ASSIGNABLE = ['TENANT_ADMIN', 'OPERATOR', 'ORGANIZER'] as const;

/**
 * Cambia el rol, el idioma o el país de alguien del equipo.
 *
 * Pide `tenant:staff`, y la pertenencia se resuelve con el `TenantScope` dentro
 * de `updateMember`: el id viaja en el formulario, así que la comprobación no
 * puede quedarse en que la pantalla no enseñe el botón.
 */
export async function updateMemberAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null || !sessionCan(session, 'tenant:staff') || session.tenantId === null) {
    redirect('/panel');
  }

  const userId = String(formData.get('userId') ?? '');
  const role = ASSIGNABLE.find((candidate) => candidate === String(formData.get('role')));
  const locale = LOCALES.find((candidate) => candidate === String(formData.get('locale')));
  const rawCountry = String(formData.get('country') ?? '');
  const country = COUNTRIES.find((candidate) => candidate.code === rawCountry)?.code ?? null;

  const ok = await updateMember(scopeOf(session), userId, {
    ...(role === undefined ? {} : { role: role as Role }),
    ...(locale === undefined ? {} : { locale }),
    country,
  });
  if (!ok) redirect('/panel/equipo');

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.userId,
    action: 'tenant.member.update',
    entity: 'User',
    entityId: userId,
    metadata: { role: role ?? '—', locale: locale ?? '—', country: country ?? '—' },
  });

  revalidatePath('/panel', 'layout');
  redirect('/panel/equipo?guardado=1');
}
