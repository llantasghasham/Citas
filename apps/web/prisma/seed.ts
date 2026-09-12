import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';
import { PLAN_CATALOGUE } from '../src/lib/billing/plans';
import { getAllInvitations } from '../src/lib/invitations';

/**
 * Las direcciones que escribe un instalador porque tiene que escribir algo.
 *
 * Ninguna de estas manda sobre nada. La lista es corta y explícita a propósito:
 * adivinar cuáles son de relleno («¿lleva "test"? ¿"admin"?») acabaría negándole
 * la cuenta a alguien que se llama así de verdad.
 */
const PLACEHOLDER_EMAILS = new Set([
  'cambiame@ejemplo.com',
  'admin@citas.local',
  'admin@example.com',
  'cambiame@example.com',
  'changeme@example.com',
]);

/**
 * Loads data/invitations.json into PostgreSQL, through the same validation the
 * JSON data source uses — so anything the seed writes was already proven valid.
 *
 * Idempotent: it upserts by slug, so running it twice changes nothing.
 */
const ROOT_TENANT_SLUG = 'citas';

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined) throw new Error('DATABASE_URL is not set.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    // The root tenant is the platform itself: self-service and concierge events
    // hang off it. Licensed offices are separate tenants created later.
    const tenant = await prisma.tenant.upsert({
      where: { slug: ROOT_TENANT_SLUG },
      update: {},
      create: {
        slug: ROOT_TENANT_SLUG,
        name: 'Citas',
        isRoot: true,
        status: 'active',
        subdomain: 'app',
        defaultLocale: 'ar',
      },
    });

    for (const plan of PLAN_CATALOGUE) {
      await prisma.plan.upsert({
        where: { tier: plan.tier },
        update: {
          name: plan.name,
          priceMonthly: plan.priceMonthly,
          pricePerEvent: plan.pricePerEvent,
          maxEvents: plan.maxEvents,
          maxGuests: plan.maxGuests,
          whiteLabel: plan.whiteLabel,
        },
        create: plan,
      });
    }
    console.log(`plans: ${PLAN_CATALOGUE.length}`);

    // La plataforma misma va en el plan sin límites.
    const officePlan = await prisma.plan.findUnique({ where: { tier: 'office' } });
    if (officePlan !== null) {
      await prisma.subscription.upsert({
        where: { tenantId: tenant.id },
        update: { planId: officePlan.id },
        create: { tenantId: tenant.id, planId: officePlan.id },
      });
    }

    // Sin registro público todavía: el superadmin se crea aquí y es el único
    // que puede entrar hasta que exista el alta de clientes.
    const superadminEmail = (process.env['SUPERADMIN_EMAIL'] ?? 'admin@citas.local')
      .trim()
      .toLowerCase();

    // Una dirección de RELLENO no se convierte en superadministrador.
    //
    // El instalador escribe `cambiame@ejemplo.com` en el `.env` porque tiene que
    // escribir algo, y este guion la convertía en la cuenta que manda sobre
    // todas las oficinas, sobre el cobro y sobre la configuración. Después el
    // dueño pone la suya de verdad y la de relleno SE QUEDA: con todo el mando,
    // en un dominio que no es suyo. Así llevaba meses una instalación en
    // producción, marcada en ámbar en una pantalla y sin nada que pulsar.
    //
    // Se para aquí y no más adelante porque aquí es donde nace. Y no falla el
    // sembrado entero: los ejemplos y los planes sí se cargan — lo que no se
    // hace es repartir el mando a una dirección que nadie lee.
    const placeholder = PLACEHOLDER_EMAILS.has(superadminEmail);
    if (placeholder) {
      console.error(
        `\n  SUPERADMIN_EMAIL sigue siendo de relleno (${superadminEmail}).\n` +
          '  NO se ha creado ningún superadministrador. Ponga la dirección de\n' +
          '  verdad en apps/web/.env y vuelva a ejecutar `npm run db:seed`.\n',
      );
    }
    // Y el resto del sembrado sigue: los planes, la oficina y los ejemplos no
    // tienen la culpa de que falte una dirección, y dejar la base a medias haría
    // que el siguiente intento empezara peor.
    const superadmin = placeholder ? null : await prisma.user.upsert({
      where: { email: superadminEmail },
      update: { isSuperadmin: true },
      create: {
        email: superadminEmail,
        // Sin nombre a propósito: «Superadmin» es la etiqueta de un puesto, no
        // el nombre de nadie, y acababa saludando al dueño por su cargo en su
        // propio panel. Quien entre lo escribe en su perfil.
        name: null,
        isSuperadmin: true,
        locale: 'ar',
      },
    });
    if (superadmin !== null) console.log(`superadmin: ${superadmin.email}`);

    for (const invitation of getAllInvitations()) {
      const existing = await prisma.invitationVersion.findUnique({
        where: { slug: invitation.slug },
        select: { eventId: true },
      });

      if (existing !== null) {
        await prisma.event.delete({ where: { id: existing.eventId } });
      }

      await prisma.event.create({
        data: {
          tenantId: tenant.id,
          type: invitation.eventType,
          status: 'published',
          channel: 'concierge',
          date: invitation.date,
          time: invitation.time,
          hijriDate: invitation.hijriDate ?? null,
          venueName: invitation.venue.name,
          venueAddress: invitation.venue.address,
          venueMapUrl: invitation.venue.mapUrl,
          venueLat: invitation.venue.lat,
          venueLng: invitation.venue.lng,
          rsvpEnabled: invitation.rsvp.enabled,
          rsvpDeadline:
            invitation.rsvp.deadline === null
              ? null
              : new Date(`${invitation.rsvp.deadline}T00:00:00Z`),
          hosts: {
            create: invitation.hosts.map((host, order) => ({
              name: host.name,
              role: host.role,
              order,
            })),
          },
          honorees: {
            create: invitation.honorees.map((honoree, order) => ({
              name: honoree.name,
              order,
            })),
          },
          versions: {
            create: [
              {
                slug: invitation.slug,
                locale: invitation.locale,
                direction: invitation.direction,
                numeralSystem: invitation.numeralSystem,
                templateId: invitation.templateId,
                message: invitation.message,
                quoteId: invitation.quoteId ?? null,
                themePrimary: invitation.theme.primary,
                themeAccent: invitation.theme.accent,
                themeBackground: invitation.theme.background,
                publishedAt: new Date(),
              },
            ],
          },
        },
      });

      console.log(`seeded ${invitation.slug} (${invitation.locale})`);
    }

    const versions = await prisma.invitationVersion.count();
    console.log(`done — tenant "${tenant.slug}", ${versions} invitation versions`);
    await prisma.$disconnect();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

// Not top-level await: the seed runs outside Next, where this file is loaded
// as CommonJS.
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
