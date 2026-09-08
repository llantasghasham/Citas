import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';
import { PLAN_CATALOGUE } from '../src/lib/billing/plans';
import { getAllInvitations } from '../src/lib/invitations';

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
    const superadmin = await prisma.user.upsert({
      where: { email: superadminEmail },
      update: { isSuperadmin: true },
      create: {
        email: superadminEmail,
        name: 'Superadmin',
        isSuperadmin: true,
        locale: 'ar',
      },
    });
    console.log(`superadmin: ${superadmin.email}`);

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
