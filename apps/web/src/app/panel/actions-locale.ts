'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/session';
import { controlDb } from '@/lib/db/client';
import { LOCALES } from '@/lib/types';

/**
 * Changes the language this person reads the panel in.
 *
 * Stored on the user, not on the office: two colleagues at the same desk read
 * it in different languages, and one of them switching must not flip the panel
 * for the whole team.
 */
export async function setPanelLocaleAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (session === null) redirect('/entrar');

  const locale = LOCALES.find((candidate) => candidate === String(formData.get('locale')));
  if (locale !== undefined && locale !== session.locale) {
    await controlDb().user.update({ where: { id: session.userId }, data: { locale } });
  }

  // The session is cached per request, so the next render has to be a new one.
  revalidatePath('/panel', 'layout');
  redirect(String(formData.get('back') ?? '/panel'));
}
