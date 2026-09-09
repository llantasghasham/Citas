'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getPrisma } from '@/lib/db/client';
import { getSession } from '@/lib/auth/session';
import { toE164 } from '@/lib/guests/phone';
import { COUNTRIES, LOCALES } from '@citas/core';

/**
 * Cada persona edita lo suyo, y solo lo suyo.
 *
 * El id NO viaja en el formulario: se toma de la sesión. Un campo oculto con el
 * id del usuario en una pantalla de perfil es cómo se edita el perfil de otro.
 *
 * Lo que aquí NO se toca: el rol, la oficina y si es superadministrador. Eso lo
 * decide quien administra, en otra pantalla, y dejarlo aquí sería dejar que
 * cualquiera se ascienda.
 */
export async function saveProfileAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const locale = LOCALES.find((candidate) => candidate === String(formData.get('locale')));
  const rawCountry = String(formData.get('country') ?? '');
  const country = COUNTRIES.find((candidate) => candidate.code === rawCountry)?.code ?? null;

  const rawPhone = String(formData.get('phone') ?? '').trim();
  const phone =
    rawPhone.length === 0 ? null : toE164(rawPhone, country === null ? '+961' : dialOf(country));

  const avatar = String(formData.get('avatarUrl') ?? '').trim();

  await getPrisma().user.update({
    where: { id: session.userId },
    data: {
      name: String(formData.get('name') ?? '').trim().slice(0, 120) || null,
      phone,
      country,
      avatarUrl: avatar.length === 0 ? null : avatar.slice(0, 500),
      ...(locale === undefined ? {} : { locale }),
    },
  });

  // El idioma y el país salen en la cabecera y en los formularios de todas las
  // pantallas: se refresca el panel entero, no solo esta.
  revalidatePath('/panel', 'layout');
  redirect('/panel/perfil?guardado=1');
}

function dialOf(code: string): string {
  return COUNTRIES.find((country) => country.code === code)?.dial ?? '+961';
}
