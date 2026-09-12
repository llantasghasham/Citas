'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { clientIp } from '@/lib/admin/context';
import { fileReport } from '@/lib/directory/reports';
import { isDirectoryLocale } from '@citas/core';

/**
 * Mandar una denuncia. PÚBLICO, sin cuenta.
 *
 * Nada de lo que llega decide nada por sí solo: el servicio busca la ficha por
 * su slug —y solo si está publicada—, comprueba que la imagen señalada sea de
 * esa ficha, y lo único que hace sin que lo mire una persona es ocultar
 * imágenes por derechos.
 */
export async function fileReportAction(formData: FormData): Promise<void> {
  const locale = String(formData.get('locale') ?? '');
  const slug = String(formData.get('slug') ?? '');
  if (!isDirectoryLocale(locale) || slug.length === 0) redirect('/d');

  const destino = `/d/${locale}/p/${encodeURIComponent(slug)}/denunciar`;

  const result = await fileReport({
    slug,
    reason: String(formData.get('reason') ?? ''),
    message: String(formData.get('message') ?? ''),
    reporterEmail: String(formData.get('reporterEmail') ?? ''),
    mediaId: String(formData.get('mediaId') ?? ''),
    ip: clientIp(await headers()),
  });

  redirect(result.ok ? `${destino}?gracias=1` : `${destino}?error=${result.problems.join(',')}`);
}
