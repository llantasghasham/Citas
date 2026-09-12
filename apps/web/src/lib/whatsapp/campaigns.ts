import { recordAudit } from '@/lib/audit';
import { authorizes } from '@/lib/acts/access';
import { mayContactMany, type ContactDecision } from '@/lib/consent/service';
import { db } from '@/lib/db/client';
import { scopedWhere, type TenantScope } from '@/lib/db/tenant';
import type { CampaignStatus, ConsentPurpose, RecipientStatus } from '@/generated/prisma/enums';
import { toE164 } from '@/lib/guests/phone';
import { setting } from '@/lib/settings';
import { getDictionary, interpolate, LOCALES, type Locale } from '@citas/core';

/**
 * Las campañas: mandar «las invitaciones de la henna a la familia de la novia»
 * como UNA cosa con nombre, autor, fecha y resultado.
 *
 * Lo que aporta sobre el botón de siempre no es comodidad, son dos cosas que
 * hoy no se pueden contestar:
 *
 *   1. **A quién NO le llegó, y por qué.** Una pantalla que solo enseña los
 *      ciento veinte que salieron esconde los ochenta que se quedaron fuera —y
 *      esos ochenta son el trabajo que queda por hacer: pedirles el teléfono,
 *      pedirles permiso, o meterlos en el grupo del acto. `MessageRecipient`
 *      guarda a los excluidos CON su motivo, no solo a los encolados.
 *   2. **Que nadie sin permiso entre en la cola.** Es la regla que hace que
 *      esto valga para un canal oficial: tener el teléfono de alguien en un
 *      Excel no es un permiso, y sin esta comprobación un canal con mejor
 *      letra automatizaría exactamente el mismo problema. El filtro va ANTES
 *      de escribir la fila, no después: una fila en la cola ya es un mensaje
 *      que el repartidor puede soltar.
 *
 * Lo que NO hace: mandar. Aquí se escriben filas, igual que en el botón y en
 * los recordatorios. Quien manda sigue siendo el servicio de `apps/whatsapp`,
 * de uno en uno y con su freno.
 */

// ──────────────────────────────────────────────────────────────── el contrato

/**
 * Por qué alguien se queda fuera.
 *
 * Están en el orden en el que se comprueban, y el orden se eligió por lo que le
 * sirve a quien mira la pantalla:
 *
 *   1. `not_authorized` — no entra a ese acto. No es que falte un dato suyo: es
 *      que no está invitado, y eso se arregla en los grupos, no aquí.
 *   2. `no_phone` — no hay a dónde escribir. Va antes que el permiso porque el
 *      permiso se guarda POR CONTACTO: sin teléfono no hay nada que consultar.
 *   3. `opted_out` — se dio de baja. Gana sobre cualquier permiso.
 *   4. `no_consent` — no consta que haya dado permiso.
 *   5. `already_sent` — ya se le mandó (o está en la cola) esta misma cosa.
 *
 * El permiso se comprueba ANTES que «ya se le mandó» a propósito: a quien no ha
 * dado permiso hay que ir a pedírselo, y eso es más urgente que saber que un
 * mensaje suyo ya salió.
 */
export type ExclusionReason =
  | 'not_authorized'
  | 'no_phone'
  | 'opted_out'
  | 'no_consent'
  | 'already_sent';

export const EXCLUSION_REASONS: readonly ExclusionReason[] = [
  'not_authorized',
  'no_phone',
  'opted_out',
  'no_consent',
  'already_sent',
] as const;

/**
 * Qué se manda, por `kind`.
 *
 * `kind` no es un campo libre: es lo que distingue la invitación del
 * recordatorio en el índice que impide encolar dos veces al mismo invitado, y
 * es además el propósito con el que se le pidió permiso. Un `kind` inventado
 * rompería las dos cosas a la vez.
 */
export const CAMPAIGN_KINDS = ['invitation', 'reminder'] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

/**
 * Las plantillas, y de qué frase del diccionario sale cada una.
 *
 * El texto vive en los cuatro diccionarios y se resuelve en el idioma DEL
 * INVITADO, nunca en el de la oficina: quien recibe el mensaje es él.
 */
export const CAMPAIGN_TEMPLATES = {
  invitation: 'whatsappMessage',
  reminder: 'reminderMessage',
} as const;
export type CampaignTemplate = keyof typeof CAMPAIGN_TEMPLATES;

export interface CampaignInput {
  eventId: string;
  /** A qué acto. Nulo = a la celebración entera (el acto principal). */
  actId: string | null;
  /** A quién. Nulo = a todos los invitados autorizados a ese acto. */
  segmentId: string | null;
  kind: CampaignKind;
  template: CampaignTemplate;
  /** Cambiar el texto es una plantilla NUEVA: la versión entra en la clave. */
  version: string;
  connectionId: string;
}

/** Un invitado de la campaña, ya resuelto. Sin token: eso no sale de aquí. */
export interface CampaignTarget {
  guestId: string;
  name: string;
  locale: Locale;
  /** En E.164, o nulo cuando no hay teléfono que valga. */
  phone: string | null;
}

export interface CampaignExclusion {
  guest: CampaignTarget;
  reason: ExclusionReason;
}

export interface CampaignPreview {
  eventId: string;
  actId: string | null;
  /** A quién le tocaría, si se lanzara ahora. */
  included: CampaignTarget[];
  /** Y a quién no, con su motivo. Esto es lo que hay que mirar. */
  excluded: CampaignExclusion[];
  /** Cuántos por motivo, para la cabecera de la pantalla. */
  excludedBy: Record<ExclusionReason, number>;
}

/** Cuando el evento, el acto, el grupo o el número no son de esta oficina. */
export type CampaignError = { error: 'notFound' };

// ───────────────────────────────────────────────────────────── la vista previa

/**
 * A quién le tocaría y a quién no, SIN escribir nada.
 *
 * Es la misma función que usa `runCampaign` por dentro, y eso no es una
 * casualidad ni un ahorro: una vista previa que calculara por su cuenta se
 * desviaría el día que alguien tocara una regla, y el único que se enteraría
 * sería el invitado. La misma razón por la que la vista de «qué ve este
 * invitado» llama a `agendaFor` y no a una maqueta.
 */
export async function previewCampaign(
  scope: TenantScope,
  input: CampaignInput,
): Promise<CampaignPreview | CampaignError> {
  const resolved = await resolveTargets(scope, input);
  if ('error' in resolved) return resolved;

  return {
    eventId: input.eventId,
    actId: input.actId,
    included: resolved.included.map(publicTarget),
    excluded: resolved.excluded.map((row) => ({ guest: publicTarget(row.guest), reason: row.reason })),
    excludedBy: tallyReasons(resolved.excluded.map((row) => row.reason)),
  };
}

// ────────────────────────────────────────────────────────────────── el lanzado

export interface CampaignOutcome {
  campaignId: string;
  /** Filas escritas en la cola DE VERDAD, no las que se intentaron. */
  queued: number;
  excluded: number;
  excludedBy: Record<ExclusionReason, number>;
}

/**
 * Crea la campaña, apunta a todos sus destinatarios —incluidos los excluidos,
 * con su motivo— y encola lo que toque. Todo en UNA transacción.
 *
 * ── Por qué en una transacción ──────────────────────────────────────────────
 *
 * Porque morir en medio deja lo peor de las dos cosas: filas en la cola que
 * nadie sabe de dónde salieron, o una campaña que dice haber mandado doscientos
 * mensajes que no existen. Es la misma lección de `applySettlement`.
 *
 * ── Por qué no se puede leer antes y escribir después ───────────────────────
 *
 * La vista previa dice qué NO hace falta escribir, pero entre leerla y escribir
 * cabe otra petición: dos operadores pulsando «Lanzar» a la vez —o un doble
 * clic— leen los dos una cola vacía y escriben los dos, y cada invitado recibe
 * DOS mensajes. Quien lo impide de verdad es el índice único PARCIAL de la base
 * sobre `(eventId, guestId, kind, actId)` mientras el mensaje está `queued` o
 * `processing`. `skipDuplicates` hace que el segundo no dé error; que no se
 * escriba lo hace PostgreSQL.
 *
 * Y `createManyAndReturn` devuelve las filas que se escribieron de verdad, así
 * que el perdedor de la carrera sabe QUIÉNES se le escaparon y los apunta como
 * `already_sent`. Sin eso, su campaña diría haber encolado doscientos mensajes
 * que escribió el otro.
 */
export async function runCampaign(
  scope: TenantScope,
  input: CampaignInput,
  actorId: string,
): Promise<CampaignOutcome | CampaignError> {
  const resolved = await resolveTargets(scope, input);
  if ('error' in resolved) return resolved;

  // El enlace personal se escribe con la dirección GUARDADA, nunca con la
  // cabecera de la petición: un enlace hacia un dominio ajeno metido en el
  // WhatsApp de doscientos invitados no se puede retirar.
  const origin = (await setting('NEXT_PUBLIC_SITE_URL'))?.replace(/\/$/, '');
  if (origin === undefined || origin.length === 0) {
    throw new Error('Falta la dirección del sitio: el enlace del invitado no se puede escribir.');
  }

  const phrase = CAMPAIGN_TEMPLATES[input.template];
  const prisma = db(scope);

  const outcome = await prisma.$transaction(async (tx) => {
    const campaign = await tx.messageCampaign.create({
      data: {
        ...scopedWhere(scope),
        eventId: input.eventId,
        actId: input.actId,
        segmentId: input.segmentId,
        kind: input.kind,
        template: input.template,
        version: input.version,
        connectionId: input.connectionId,
        actorId,
        status: 'sending',
      },
      select: { id: true },
    });

    const rows = resolved.included.map((guest) => ({
      ...scopedWhere(scope),
      connectionId: input.connectionId,
      eventId: input.eventId,
      guestId: guest.id,
      actId: input.actId,
      campaignId: campaign.id,
      kind: input.kind,
      // `phone` ya está normalizado a E.164: quien no lo tenía se quedó fuera
      // con `no_phone` antes de llegar aquí.
      toPhone: guest.phone ?? '',
      // En el idioma DEL INVITADO. Que la oficina trabaje en español no
      // convierte en español la invitación de una tía que lee árabe.
      body: interpolate(getDictionary(guest.locale)['share'][phrase], {
        name: guest.name,
        link: `${origin}/g/${guest.token}`,
      }),
    }));

    const written =
      rows.length === 0
        ? []
        : await tx.whatsappMessage.createManyAndReturn({
            data: rows,
            skipDuplicates: true,
            select: { id: true, guestId: true },
          });

    const messageOf = new Map<string, string>();
    for (const row of written) {
      if (row.guestId !== null) messageOf.set(row.guestId, row.id);
    }

    // Los que se escaparon: otra petición los encoló entre nuestra lectura y
    // nuestra escritura. No es un error —el invitado tiene su mensaje— pero
    // esta campaña no lo mandó, y decir lo contrario sería mentir en el único
    // sitio donde alguien va a mirar para averiguar qué pasó.
    const recipients = [
      ...resolved.included.map((guest) => {
        const messageId = messageOf.get(guest.id);
        return messageId === undefined
          ? {
              campaignId: campaign.id,
              guestId: guest.id,
              eventId: input.eventId,
              status: 'excluded' as RecipientStatus,
              reason: 'already_sent' satisfies ExclusionReason as string,
              messageId: null,
            }
          : {
              campaignId: campaign.id,
              guestId: guest.id,
              eventId: input.eventId,
              status: 'queued' as RecipientStatus,
              reason: null,
              messageId,
            };
      }),
      ...resolved.excluded.map((row) => ({
        campaignId: campaign.id,
        guestId: row.guest.id,
        eventId: input.eventId,
        status: 'excluded' as RecipientStatus,
        reason: row.reason as string,
        messageId: null,
      })),
    ];

    if (recipients.length > 0) {
      await tx.messageRecipient.createMany({ data: recipients });
    }

    // `done` cuando no queda nada por salir: una campaña que no encoló nada
    // sigue siendo una campaña —con sus doscientos excluidos y sus motivos—,
    // pero dejarla en `sending` para siempre sería prometer un envío que no va
    // a ocurrir.
    const queued = messageOf.size;
    const status: CampaignStatus = queued === 0 ? 'done' : 'queued';
    await tx.messageCampaign.update({ where: { id: campaign.id }, data: { status } });

    const reasons: ExclusionReason[] = [
      ...resolved.excluded.map((row) => row.reason),
      ...Array.from({ length: resolved.included.length - queued }, () => 'already_sent' as const),
    ];

    return {
      campaignId: campaign.id,
      queued,
      excluded: reasons.length,
      excludedBy: tallyReasons(reasons),
    };
  });

  // Fuera de la transacción porque el historial vive en la base de CONTROL y
  // la campaña en la de la oficina: son dos bases distintas y no hay una
  // transacción que las abarque.
  //
  // Recuentos y NUNCA teléfonos ni nombres: el historial lo lee quien
  // administra la plataforma, y no tiene por qué ver la lista de invitados de
  // una boda ajena para saber que se lanzó una campaña.
  await recordAudit({
    tenantId: scope.tenantId,
    actorId,
    action: 'whatsapp.campaign.run',
    entity: 'MessageCampaign',
    entityId: outcome.campaignId,
    metadata: {
      eventId: input.eventId,
      actId: input.actId,
      segmentId: input.segmentId,
      kind: input.kind,
      template: input.template,
      version: input.version,
      queued: outcome.queued,
      excluded: outcome.excluded,
      ...Object.fromEntries(
        EXCLUSION_REASONS.map((reason) => [`excluded_${reason}`, outcome.excludedBy[reason]]),
      ),
    },
  });

  return outcome;
}

// ────────────────────────────────────────────────────────────── el resultado

export interface CampaignResults {
  campaignId: string;
  status: CampaignStatus;
  total: number;
  /** Lo que se decidió al lanzar: a quién le tocaba y a quién no. */
  byStatus: Record<RecipientStatus, number>;
  /** Y por qué se quedaron fuera los que se quedaron fuera. */
  excludedBy: Record<ExclusionReason, number>;
  /**
   * Lo que dice la COLA hoy de los que sí se encolaron.
   *
   * Va aparte de `byStatus` y no mezclado con él porque son dos preguntas
   * distintas: «a quién le tocaba» no cambia nunca, y «qué ha pasado con su
   * mensaje» cambia cada minuto. Se lee de `WhatsappMessage`, que es quien lo
   * sabe: copiarlo a `MessageRecipient` sería tener el mismo dato en dos sitios
   * y un día dirían cosas distintas.
   */
  delivery: Record<string, number>;
}

/** Cuántos por estado, con los motivos de exclusión agrupados. */
export async function campaignResults(
  scope: TenantScope,
  campaignId: string,
): Promise<CampaignResults | null> {
  const prisma = db(scope);

  const campaign = await prisma.messageCampaign.findFirst({
    where: { id: campaignId, ...scopedWhere(scope) },
    select: { id: true, status: true },
  });
  // La misma respuesta que cuando no existe: decir «esa campaña no es suya» le
  // contaría a una oficina qué ids hay en otra.
  if (campaign === null) return null;

  const [recipients, messages] = await Promise.all([
    prisma.messageRecipient.findMany({
      where: { campaignId },
      select: { status: true, reason: true },
    }),
    prisma.whatsappMessage.findMany({
      where: { campaignId, ...scopedWhere(scope) },
      select: { status: true },
    }),
  ]);

  const byStatus: Record<RecipientStatus, number> = {
    excluded: 0,
    queued: 0,
    sent: 0,
    failed: 0,
  };
  const reasons: ExclusionReason[] = [];
  for (const row of recipients) {
    byStatus[row.status] += 1;
    const reason = EXCLUSION_REASONS.find((candidate) => candidate === row.reason);
    if (reason !== undefined) reasons.push(reason);
  }

  const delivery: Record<string, number> = {};
  for (const row of messages) {
    delivery[row.status] = (delivery[row.status] ?? 0) + 1;
  }

  return {
    campaignId: campaign.id,
    status: campaign.status,
    total: recipients.length,
    byStatus,
    excludedBy: tallyReasons(reasons),
    delivery,
  };
}

// ──────────────────────────────────────────────────────────────── por dentro

/** Un invitado con todo lo que hace falta para escribirle. `token` no sale. */
interface ResolvedGuest {
  id: string;
  name: string;
  locale: Locale;
  token: string;
  phone: string | null;
}

interface ResolvedTargets {
  included: ResolvedGuest[];
  excluded: { guest: ResolvedGuest; reason: ExclusionReason }[];
}

function publicTarget(guest: ResolvedGuest): CampaignTarget {
  return { guestId: guest.id, name: guest.name, locale: guest.locale, phone: guest.phone };
}

function tallyReasons(reasons: readonly ExclusionReason[]): Record<ExclusionReason, number> {
  const tally: Record<ExclusionReason, number> = {
    not_authorized: 0,
    no_phone: 0,
    opted_out: 0,
    no_consent: 0,
    already_sent: 0,
  };
  for (const reason of reasons) tally[reason] += 1;
  return tally;
}

/**
 * El cálculo entero, y el único sitio donde vive.
 *
 * Un número FIJO de consultas, como los recuentos por acto: las mismas para una
 * boda de veinte invitados que para una de cuatrocientos. Preguntar por invitado
 * serían cinco consultas por fila — dos mil para pintar una pantalla.
 */
async function resolveTargets(
  scope: TenantScope,
  input: CampaignInput,
): Promise<ResolvedTargets | CampaignError> {
  const prisma = db(scope);

  // Todo lo que viene del navegador se resuelve CONTRA la oficina antes de
  // tocarlo: el id del evento, el del acto, el del grupo y el del número viajan
  // en campos ocultos de un formulario, así que son datos del cliente. Un id de
  // otra boda no encuentra fila en vez de encontrarla y escribirla.
  const [event, connection] = await Promise.all([
    prisma.event.findFirst({
      where: { id: input.eventId, ...scopedWhere(scope) },
      select: { id: true },
    }),
    prisma.whatsappConnection.findFirst({
      where: { id: input.connectionId, ...scopedWhere(scope) },
      select: { id: true },
    }),
  ]);
  if (event === null || connection === null) return { error: 'notFound' };

  const acts = await prisma.eventAct.findMany({
    where: { eventId: input.eventId, event: scopedWhere(scope) },
    select: { id: true, isMain: true, visibility: true, audiences: { select: { segmentId: true, mode: true } } },
  });

  // `actId` nulo es «la celebración entera», que es el acto PRINCIPAL: es el
  // que contesta el formulario abierto y el que llevaba la fecha antes de que
  // existieran los actos.
  const act = input.actId === null
    ? (acts.find((candidate) => candidate.isMain) ?? null)
    : (acts.find((candidate) => candidate.id === input.actId) ?? null);
  // Un acto pedido por id que no es de este evento no se trata como «a todos»:
  // eso convertiría un id equivocado en un envío a la boda entera.
  if (input.actId !== null && act === null) return { error: 'notFound' };

  if (input.segmentId !== null) {
    const segment = await prisma.audienceSegment.findFirst({
      where: { id: input.segmentId, eventId: input.eventId, event: scopedWhere(scope) },
      select: { id: true },
    });
    if (segment === null) return { error: 'notFound' };
  }

  const guests = await prisma.guest.findMany({
    // El grupo ACOTA a quién se le escribe; no es un motivo de exclusión. Quien
    // no está en el grupo de la familia de la novia no «se quedó fuera» de nada:
    // esta campaña no iba con él, y listarlo como excluido enterraría los
    // motivos que sí hay que mirar bajo trescientos nombres que sobran.
    where: {
      eventId: input.eventId,
      event: scopedWhere(scope),
      ...(input.segmentId === null ? {} : { segments: { some: { segmentId: input.segmentId } } }),
    },
    // En orden alfabético, y no por casualidad: dos peticiones simultáneas
    // insertan en el MISMO orden, y dos transacciones que toman los mismos
    // candados en el mismo orden se esperan en vez de trabarse.
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      locale: true,
      token: true,
      phone: true,
      segments: { select: { segmentId: true } },
      actInvites: { select: { actId: true, excluded: true } },
    },
  });

  // Quién está autorizado, con la MISMA regla que decide lo que ve en su
  // enlace. Importada, no copiada: estuvo escrita dos veces —idénticas— y así
  // es como empiezan a decir cosas distintas.
  const authorized = new Set<string>();
  for (const guest of guests) {
    if (act === null) {
      // No hay acto contra el que decidir. Si la boda no tiene actos, la
      // invitación es a la celebración entera y no hay nada que autorizar; si
      // los tiene pero ninguno es principal, vale entrar a alguno.
      if (acts.length === 0) {
        authorized.add(guest.id);
        continue;
      }
      const mine = new Set(guest.segments.map((row) => row.segmentId));
      const inviteOf = new Map(guest.actInvites.map((row) => [row.actId, row]));
      if (acts.some((candidate) => authorizes(candidate, inviteOf.get(candidate.id), mine))) {
        authorized.add(guest.id);
      }
      continue;
    }

    const mine = new Set(guest.segments.map((row) => row.segmentId));
    const invite = guest.actInvites.find((row) => row.actId === act.id);
    if (authorizes(act, invite, mine)) authorized.add(guest.id);
  }

  // El teléfono, normalizado. El prefijo por defecto es el del mercado inicial,
  // igual que en el resto de la cola.
  const resolved: ResolvedGuest[] = guests.map((guest) => ({
    id: guest.id,
    name: guest.name,
    locale: LOCALES.find((candidate) => candidate === guest.locale) ?? 'ar',
    token: guest.token,
    phone: guest.phone === null ? null : toE164(guest.phone, '+961'),
  }));

  // El permiso, de todos los que tienen teléfono, de una vez. El propósito sale
  // del `kind`: quien aceptó recibir su invitación no ha aceptado nada más.
  const purpose: ConsentPurpose = input.kind === 'reminder' ? 'reminder' : 'invitation';
  const decisions = await mayContactMany(
    scope,
    'whatsapp',
    purpose,
    resolved.flatMap((guest) => (guest.phone === null ? [] : [guest.phone])),
  );

  // Lo ya escrito o en cola para esta misma cosa.
  //
  // `already_sent` mira la MISMA clave que el índice de la base —evento,
  // invitado, `kind` y acto— y además la plantilla con su versión: un texto
  // nuevo es una plantilla nueva, y volver a escribirle a alguien con el texto
  // corregido es una decisión legítima. Un mensaje que NO salió de una campaña
  // —el botón de siempre— no dice de qué plantilla era, así que cuenta como
  // bloqueante: ante la duda, no se manda dos veces.
  // En dos consultas y no en un `OR` con un `some`: `WhatsappMessage.campaignId`
  // no lleva relación declarada —es un campo suelto a propósito, porque el
  // mensaje sobrevive a que se borre la campaña— así que la plantilla se
  // resuelve primero y se filtra por id después.
  const sameTemplate = await prisma.messageCampaign.findMany({
    where: {
      ...scopedWhere(scope),
      eventId: input.eventId,
      template: input.template,
      version: input.version,
    },
    select: { id: true },
  });
  const live = await prisma.whatsappMessage.findMany({
    where: {
      ...scopedWhere(scope),
      eventId: input.eventId,
      actId: input.actId,
      kind: input.kind,
      status: { in: ['queued', 'processing', 'sent', 'sent_unknown'] },
      OR: [
        { campaignId: null },
        { campaignId: { in: sameTemplate.map((row) => row.id) } },
      ],
    },
    select: { guestId: true },
  });
  const already = new Set(live.flatMap((row) => (row.guestId === null ? [] : [row.guestId])));

  const included: ResolvedGuest[] = [];
  const excluded: { guest: ResolvedGuest; reason: ExclusionReason }[] = [];
  for (const guest of resolved) {
    const reason = reasonFor(guest, authorized, decisions, already);
    if (reason === null) included.push(guest);
    else excluded.push({ guest, reason });
  }
  return { included, excluded };
}

/** El orden de decisión, en un sitio. Nulo significa «a este se le escribe». */
function reasonFor(
  guest: ResolvedGuest,
  authorized: ReadonlySet<string>,
  decisions: ReadonlyMap<string, ContactDecision>,
  already: ReadonlySet<string>,
): ExclusionReason | null {
  if (!authorized.has(guest.id)) return 'not_authorized';
  if (guest.phone === null) return 'no_phone';

  // Falla CERRADO: un teléfono del que no se sabe nada no se considera
  // permitido. `mayContactMany` devuelve una entrada por contacto, y si algún
  // día no la devolviera, lo que corresponde es no escribir.
  const decision = decisions.get(guest.phone) ?? { ok: false as const, reason: 'no_consent' as const };
  if (!decision.ok) {
    // `bad_contact` es un número que ni siquiera se puede normalizar: no hay a
    // dónde escribir, que es exactamente lo que dice `no_phone`. Inventarle un
    // motivo propio daría dos nombres al mismo agujero — y quien mire la
    // pantalla tiene que ir a lo mismo: a pedirle el teléfono bueno.
    return decision.reason === 'bad_contact' ? 'no_phone' : decision.reason;
  }

  if (already.has(guest.id)) return 'already_sent';
  return null;
}
