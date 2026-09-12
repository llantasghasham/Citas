import { recordAudit } from '@/lib/audit';
import { controlDb } from '@/lib/db/client';

import { purgeMedia } from './moderation';

/**
 * Las denuncias.
 *
 * Un formulario PÚBLICO y sin cuenta —quien ve un número equivocado en la ficha
 * de un salón no se va a abrir una— y por eso todo lo que llega es texto de
 * fuera y nada de lo que dice decide nada por sí solo. Lo único que una denuncia
 * hace sola es OCULTAR imágenes por derechos, que es la que no puede esperar; el
 * resto lo mira una persona.
 *
 * Y una regla que no se negocia: **no se cierra el negocio de nadie con un
 * formulario anónimo**. Una denuncia de la ficha entera oculta sus IMÁGENES, no
 * la ficha. Suspender un negocio lo decide quien modera, con su nombre escrito
 * al lado.
 */

export const REPORT_REASONS = [
  'false_info',
  'scam',
  'offensive',
  'wrong_number',
  'closed',
  'copyright',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export function isReportReason(value: string): value is ReportReason {
  return (REPORT_REASONS as readonly string[]).includes(value);
}

export type ReportProblem = 'reason' | 'email' | 'notFound' | 'tooMany';

/** Cuántas admite una misma dirección en una hora. */
const PER_IP_PER_HOUR = 5;

/**
 * Guarda una denuncia.
 *
 * El freno va por dirección y por hora, y es de los que valen lo que valga el
 * proxy — por eso no es el único freno, sino el que evita que llamar mil veces
 * cueste mil filas. Lo que de verdad impide el sabotaje es que una denuncia no
 * decida nada sola, salvo ocultar imágenes.
 */
export async function fileReport(input: {
  slug: string;
  reason: string;
  message: string;
  reporterEmail: string;
  mediaId?: string;
  ip?: string | null;
}): Promise<{ ok: true; hiddenImages: number } | { ok: false; problems: ReportProblem[] }> {
  if (!isReportReason(input.reason)) return { ok: false, problems: ['reason'] };

  const email = input.reporterEmail.trim().toLowerCase().slice(0, 200);
  // El correo es OBLIGATORIO en una reclamación de derechos: sin alguien a quien
  // responder no hay reclamación, hay un botón anónimo para tumbar las fotos de
  // un competidor. Lo exige también la base.
  if (input.reason === 'copyright' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, problems: ['email'] };
  }

  const prisma = controlDb();

  // La ficha se busca por su SLUG y solo si está publicada: no se puede denunciar
  // —ni averiguar la existencia de— algo que todavía no ha salido.
  const provider = await prisma.provider.findFirst({
    where: { slug: input.slug, status: 'approved' },
    select: { id: true },
  });
  if (provider === null) return { ok: false, problems: ['notFound'] };

  if (input.ip !== undefined && input.ip !== null && input.ip.length > 0) {
    const desde = new Date(Date.now() - 60 * 60 * 1000);
    const recientes = await prisma.providerReport.count({
      where: { ip: input.ip, createdAt: { gte: desde } },
    });
    if (recientes >= PER_IP_PER_HOUR) return { ok: false, problems: ['tooMany'] };
  }

  // Una imagen señalada solo cuenta si es de ESTA ficha: un `mediaId` de otro
  // negocio metido en el formulario no puede tumbar sus fotos.
  const mediaId =
    input.mediaId === undefined || input.mediaId.length === 0
      ? null
      : ((
          await prisma.providerMedia.findFirst({
            where: { id: input.mediaId, providerId: provider.id },
            select: { id: true },
          })
        )?.id ?? null);

  let hiddenImages = 0;

  await prisma.$transaction(async (tx) => {
    await tx.providerReport.create({
      data: {
        providerId: provider.id,
        mediaId,
        reason: input.reason as ReportReason,
        message: input.message.trim().slice(0, 2000) || null,
        reporterEmail: email.length === 0 ? null : email,
        ip: input.ip ?? null,
        status: 'new',
      },
    });

    // LO ÚNICO que una denuncia hace sola. Una foto reclamada por derechos deja
    // de verse AHORA y se mira después: al revés, «lo revisamos en 24 horas» es
    // un día entero publicando lo de otro.
    if (input.reason === 'copyright') {
      const done = await tx.providerMedia.updateMany({
        where: {
          providerId: provider.id,
          kind: 'image',
          status: 'approved',
          ...(mediaId === null ? {} : { id: mediaId }),
        },
        data: { status: 'hidden', hiddenReason: 'copyright' },
      });
      hiddenImages = done.count;

      await tx.providerReview.create({
        data: {
          providerId: provider.id,
          mediaId,
          action: 'media_hidden',
          // Sin actor: no lo hizo una persona de la casa, lo disparó una
          // denuncia. Poner aquí a quien la puso sería escribir su identidad en
          // el historial que ve el proveedor.
          actorId: null,
          note: 'copyright',
        },
      });
    }
  });

  await recordAudit({
    tenantId: null,
    actorId: null,
    action: 'directory.report.filed',
    entity: 'Provider',
    entityId: provider.id,
    // El motivo y cuántas fotos se ocultaron. NUNCA el correo de quien denuncia
    // ni el texto: el historial no es una copia del contenido, y aquí además hay
    // un dato personal de alguien que no tiene cuenta.
    metadata: { reason: input.reason, hiddenImages, aboutMedia: mediaId !== null },
  });

  return { ok: true, hiddenImages };
}

export interface ReportRow {
  id: string;
  providerId: string;
  legalName: string;
  slug: string;
  mediaId: string | null;
  reason: string;
  message: string | null;
  reporterEmail: string | null;
  status: string;
  createdAt: Date;
}

/** Las que esperan, lo más viejo primero. */
export async function openReports(): Promise<ReportRow[]> {
  const rows = await controlDb().providerReport.findMany({
    where: { status: { in: ['new', 'reviewing'] } },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: {
      id: true,
      providerId: true,
      mediaId: true,
      reason: true,
      message: true,
      reporterEmail: true,
      status: true,
      createdAt: true,
      provider: { select: { legalName: true, slug: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    providerId: row.providerId,
    legalName: row.provider.legalName,
    slug: row.provider.slug,
    mediaId: row.mediaId,
    reason: row.reason,
    message: row.message,
    reporterEmail: row.reporterEmail,
    status: row.status,
    createdAt: row.createdAt,
  }));
}

/**
 * Resolver una denuncia.
 *
 *   · `upheld` — se le da la razón. Si señalaba una imagen, esa imagen se BORRA
 *     de verdad, bytes incluidos: «la retiramos» tiene que querer decir que ya
 *     no está.
 *   · `dismissed` — no. Lo que se ocultó por la denuncia vuelve a `approved`,
 *     porque si no una reclamación falsa deja la galería escondida para siempre.
 */
export async function resolveReport(
  reportId: string,
  actorId: string,
  outcome: 'upheld' | 'dismissed',
  note: string,
): Promise<{ ok: true } | { ok: false; problems: ReportProblem[] }> {
  const prisma = controlDb();

  const report = await prisma.providerReport.findUnique({
    where: { id: reportId },
    select: { providerId: true, mediaId: true, reason: true, status: true },
  });
  if (report === null) return { ok: false, problems: ['notFound'] };

  const limpio = note.trim().slice(0, 1000);

  if (outcome === 'upheld' && report.mediaId !== null) {
    // Fuera de la transacción a propósito: borra bytes en otro sistema, y una
    // transacción abierta esperando a la red es una transacción que bloquea
    // filas mientras tanto.
    await purgeMedia(report.mediaId, actorId);
  }

  await prisma.$transaction(async (tx) => {
    await tx.providerReport.update({
      where: { id: reportId },
      data: {
        status: outcome,
        resolution: limpio.length === 0 ? null : limpio,
        resolvedAt: new Date(),
        resolvedBy: actorId,
      },
    });

    // Desestimada: lo que ocultó ESTA denuncia vuelve. Solo lo oculto POR
    // derechos — lo que escondió quien modera por otra razón sigue escondido.
    if (outcome === 'dismissed' && report.reason === 'copyright') {
      await tx.providerMedia.updateMany({
        where: {
          providerId: report.providerId,
          status: 'hidden',
          hiddenReason: 'copyright',
          ...(report.mediaId === null ? {} : { id: report.mediaId }),
        },
        data: { status: 'approved', hiddenReason: null },
      });
    }

    await tx.providerReview.create({
      data: {
        providerId: report.providerId,
        mediaId: report.mediaId,
        action: `report_${outcome}`,
        actorId,
        note: limpio.length === 0 ? null : limpio,
      },
    });
  });

  await recordAudit({
    tenantId: null,
    actorId,
    action: `directory.report.${outcome}`,
    entity: 'Provider',
    entityId: report.providerId,
    metadata: { reportId, reason: report.reason },
  });
  return { ok: true };
}

/**
 * La dirección de quien denuncia se guarda para el freno y se BORRA a los
 * treinta días. Pasado ese plazo ya no sirve para frenar nada y lo único que
 * sigue haciendo es guardar desde dónde se conectó una persona — la misma regla
 * que las sesiones caducadas.
 */
export async function purgeReportIps(now = new Date()): Promise<number> {
  const limite = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const done = await controlDb().providerReport.updateMany({
    where: { ip: { not: null }, createdAt: { lt: limite } },
    data: { ip: null },
  });
  return done.count;
}
